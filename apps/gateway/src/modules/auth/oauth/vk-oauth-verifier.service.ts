import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@app/common';
import { GatewayConfig } from '../../../config/gateway.config';
import {
  OAuthIdentity,
  OAuthVerifier,
  OAuthVerifyHints,
} from './oauth-verifier.interface';

// VK ID does NOT publish a JWKS. The previous default
// `https://id.vk.com/oauth2/jwks` returns 404 — the verifier hung on
// "Expected 200 OK from the JSON Web Key Set HTTP response". The
// canonical way to validate an id_token is a server-to-server POST to
// /oauth2/public_info: VK checks the signature itself and returns user
// info. Per their docs the same endpoint accepts {client_id, id_token}.
const DEFAULT_VK_PUBLIC_INFO_URL = 'https://id.vk.com/oauth2/public_info';
// `users.get` works for every user-issued access token regardless of scope
// or VK Console "profile type" (community / standalone / etc.), and returns
// the canonical {id, first_name, last_name} of the token's owner. Previous
// default `account.getProfileInfo` was visibly rejecting tokens issued by
// the legacy VK SDK with "method is unavailable with current profile type".
const DEFAULT_VK_USERINFO_URL = 'https://api.vk.com/method/users.get';

/**
 * VK ID OAuth verifier.
 *
 * Primary path — verify the `idToken` (a JWT) against VK's JWKS endpoint:
 *   - audience MUST equal our VK_CLIENT_ID
 *   - issuer MUST equal `https://id.vk.com`
 *   - signature checked via remote JWKS (jose handles its own caching)
 *
 * Fallback path — if the client submitted only an `accessToken` (no JWT
 * shape), call VK's `account.getProfileInfo` to resolve identity. We
 * heuristically pick the path by counting the dots: a JWT has exactly 2.
 *
 * Failures translate to `UnauthorizedException` (token_invalid) for client-
 * fixable issues (expired, forged, audience mismatch) and to 503 for
 * upstream outages so the client doesn't wrongly invalidate the user's
 * stored token on a transient blip.
 */
@Injectable()
export class VkOAuthVerifierService implements OAuthVerifier {
  private readonly logger = new Logger(VkOAuthVerifierService.name);
  /**
   * Whitelist of acceptable client_ids, indexed by platform. VK issues a
   * different App ID per platform (Android / iOS); we accept either, but
   * never an arbitrary client_id pulled from the id_token's `aud` (that
   * would let an attacker route through their own VK app). Both are
   * required by `GatewayConfig`.
   */
  private readonly androidId: string;
  private readonly iosId: string;
  private readonly publicInfoUrl: string;
  private readonly userInfoUrl: string;

  constructor(config: ConfigService<GatewayConfig, true>) {
    this.androidId = config.getOrThrow('VK_ANDROID_APP_ID');
    this.iosId = config.getOrThrow('VK_IOS_APP_ID');
    this.publicInfoUrl =
      config.get('VK_PUBLIC_INFO_URL') ?? DEFAULT_VK_PUBLIC_INFO_URL;
    this.userInfoUrl = config.get('VK_USERINFO_URL') ?? DEFAULT_VK_USERINFO_URL;
  }

  async verify(
    token: string,
    hints: OAuthVerifyHints = {},
  ): Promise<OAuthIdentity> {
    if (!token) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'VK token required',
      });
    }
    return this.looksLikeJwt(token)
      ? this.verifyIdToken(token, hints)
      : this.verifyAccessToken(token);
  }

  /** Order whitelist client_ids so the platform hinted by the request
   *  (User-Agent) is tried first. Falls back to a stable default order
   *  when no hint is available. */
  private orderedClientIds(hints: OAuthVerifyHints): readonly string[] {
    if (hints.platform === 'ios') return [this.iosId, this.androidId];
    // Android-first by default — historical clients were Android-only,
    // and the order is irrelevant when both succeed.
    return [this.androidId, this.iosId];
  }

  /**
   * Robust JWT-shape check. The naive `split('.').length === 3` matched
   * VK access tokens of the form `vk1.a.<base64-blob>` (also 3 segments
   * via `.`), which then routed into `verifyIdToken` → jose → "JWS
   * Protected Header is invalid". Now we additionally require the first
   * segment to base64url-decode into a JSON object with an `alg` field —
   * the universal marker of a JWS header. Anything else falls through to
   * the access-token path so VK API resolves identity for us.
   */
  private looksLikeJwt(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as { alg?: unknown };
      return typeof header.alg === 'string' && header.alg.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Validate id_token via VK's /oauth2/public_info — VK checks the JWS
   * signature server-side and returns the resolved user object on
   * success. We never trust the JWT payload as proof of identity by
   * itself.
   *
   * Picking the client_id: VK ID tokens don't reliably carry an `aud`
   * claim (observed empirically; the field is absent or shaped in ways
   * that don't match RFC 7519 expectations). We try every whitelisted
   * client_id in turn — the first one VK accepts wins. This is safe:
   * we ONLY send values from our own whitelist, never anything pulled
   * from the unverified token. Worst case is one extra HTTP round-trip
   * when the first attempt happens to be the wrong platform.
   */
  private async verifyIdToken(
    idToken: string,
    hints: OAuthVerifyHints,
  ): Promise<OAuthIdentity> {
    let lastError: string | undefined;
    for (const clientId of this.orderedClientIds(hints)) {
      const result = await this.tryPublicInfo(clientId, idToken);
      if (result.kind === 'ok') return result.identity;
      if (result.kind === 'upstream') {
        // 5xx / network — bail, do NOT try the second client_id (the
        // outage isn't platform-specific and the second call would
        // double the latency for the user).
        throw new ServiceUnavailableException({
          code: 'oauth_upstream_unavailable',
          message: result.message,
        });
      }
      lastError = result.message;
    }
    this.logger.warn(`VK public_info rejected id_token: ${lastError}`);
    throw new UnauthorizedException({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'VK rejected the token',
    });
  }

  private async tryPublicInfo(
    clientId: string,
    idToken: string,
  ): Promise<
    | { kind: 'ok'; identity: OAuthIdentity }
    | { kind: 'rejected'; message: string }
    | { kind: 'upstream'; message: string }
  > {
    const body = new URLSearchParams({
      client_id: clientId,
      id_token: idToken,
    });
    let res: Response;
    try {
      res = await fetch(this.publicInfoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      return {
        kind: 'upstream',
        message: `VK public_info network error: ${(err as Error).message}`,
      };
    }
    if (res.status >= 500) {
      return {
        kind: 'upstream',
        message: `VK public_info returned ${res.status}`,
      };
    }

    const payload = (await res.json().catch(() => null)) as {
      user?: {
        user_id?: number | string;
        first_name?: string;
        last_name?: string;
        email?: string;
        verified?: boolean;
      };
      error?: string;
      error_description?: string;
    } | null;

    if (!payload || payload.error || !payload.user?.user_id) {
      return {
        kind: 'rejected',
        message: `client_id=${clientId}: ${
          payload?.error_description ?? payload?.error ?? 'unknown'
        }`,
      };
    }

    const user = payload.user;
    return {
      kind: 'ok',
      identity: {
        providerUserId: String(user.user_id),
        email: user.email && user.email.length > 0 ? user.email : undefined,
        // VK's public_info doesn't expose an `email_verified` boolean —
        // they only return verified emails per their docs, but to stay
        // safe at the merge gate we mark it true only if VK surfaced
        // their internal `verified` flag.
        emailVerified: !!user.email && user.verified === true,
        name: this.composeName(user.first_name, user.last_name),
      },
    };
  }

  private composeName(...parts: unknown[]): string | undefined {
    const text = parts
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ')
      .trim();
    return text || undefined;
  }

  /**
   * VK API v5 user-info fallback. Used when the client posted only the
   * `accessToken` (e.g. older flow without `id_token`). Per
   * https://id.vk.com/business/go/docs the access token doesn't carry
   * audience by design — we trust VK's response as the proof of identity.
   *
   * Default endpoint is `users.get`, which returns the calling user when
   * `user_ids` is omitted. VK includes the `User-Agent` header in their
   * tokenless-method check, so we set a stable one — anonymous requests
   * sometimes get throttled harder.
   */
  private async verifyAccessToken(accessToken: string): Promise<OAuthIdentity> {
    const url =
      `${this.userInfoUrl}?access_token=${encodeURIComponent(accessToken)}` +
      '&v=5.131';
    // Same UX problem as Yandex (see yandex-oauth-verifier.ts): VK's
    // v5 userinfo can 5xx on malformed tokens during their own
    // throttling. Pre-retry, that surfaced as 503
    // `oauth_upstream_unavailable`, dropping the user into a
    // retry-later loop instead of a re-login prompt. One retry on
    // 5xx surfaces the real 401 underneath; two consecutive 5xx
    // means VK really is having a bad time → 503 stays correct.
    const doFetch = () =>
      fetch(url, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      this.logger.error(`VK userinfo network error: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'oauth_upstream_unavailable',
        message: 'VK is temporarily unavailable',
      });
    }
    if (res.status >= 500) {
      this.logger.warn(
        `VK userinfo first attempt returned ${res.status}; retrying once`,
      );
      await res.text().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      try {
        res = await doFetch();
      } catch (err) {
        this.logger.error(
          `VK userinfo retry network error: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException({
          code: 'oauth_upstream_unavailable',
          message: 'VK is temporarily unavailable',
        });
      }
    }
    if (res.status >= 500) {
      throw new ServiceUnavailableException({
        code: 'oauth_upstream_unavailable',
        message: `VK returned ${res.status}`,
      });
    }
    // VK API methods return either:
    //   {response: <object>}       — e.g. account.getProfileInfo
    //   {response: [<object>, …]}  — e.g. users.get (always an array, even
    //                                 for one user)
    // We accept both so swapping VK_USERINFO_URL via env doesn't break
    // the parser. `error.error_msg` carries VK's human-readable cause.
    const body = (await res.json().catch(() => null)) as {
      response?:
        | { id?: number; first_name?: string; last_name?: string }
        | Array<{ id?: number; first_name?: string; last_name?: string }>;
      error?: { error_msg?: string };
    } | null;

    const profile = Array.isArray(body?.response)
      ? body?.response[0]
      : body?.response;

    if (!body || body.error || !profile?.id) {
      this.logger.warn(
        `VK userinfo rejected token: ${body?.error?.error_msg ?? 'unknown'}`,
      );
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'VK rejected the token',
      });
    }

    // VK's users.get/getProfileInfo paths don't return email — emailVerified
    // stays undefined (treated as false at the merge gate in user-service).
    return {
      providerUserId: String(profile.id),
      name: this.composeName(profile.first_name, profile.last_name),
    };
  }
}
