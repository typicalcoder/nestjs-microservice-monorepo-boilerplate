import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@app/common';
import { GatewayConfig } from '../../../config/gateway.config';
import { OAuthIdentity, OAuthVerifier } from './oauth-verifier.interface';

const DEFAULT_YANDEX_USERINFO_URL = 'https://login.yandex.ru/info';

/**
 * Yandex ID OAuth verifier.
 *
 * Uses Yandex's user-info endpoint as the verification mechanism — the
 * presented OAuth token is itself the credential, and a successful 200
 * from `https://login.yandex.ru/info` confirms the token is valid AND
 * tells us who the user is. No JWKS / audience setup needed because
 * Yandex doesn't issue an OIDC-style id_token in the consumer flow we
 * use.
 *
 * Docs: https://yandex.ru/dev/id/doc/ru/user-information
 */
@Injectable()
export class YandexOAuthVerifierService implements OAuthVerifier {
  private readonly logger = new Logger(YandexOAuthVerifierService.name);
  private readonly userInfoUrl: string;

  constructor(config: ConfigService<GatewayConfig, true>) {
    this.userInfoUrl =
      config.get('YANDEX_USERINFO_URL') ?? DEFAULT_YANDEX_USERINFO_URL;
  }

  async verify(token: string): Promise<OAuthIdentity> {
    if (!token) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Yandex token required',
      });
    }
    // Yandex's userinfo endpoint is observably flaky for malformed
    // tokens — sometimes 401 (clean), sometimes 5xx (their input
    // validator hiccups). Pre-retry, we mapped 5xx → 503
    // "oauth_upstream_unavailable", so the user with a genuinely
    // bad token got a "service down, retry" loop instead of a
    // re-login prompt. Now we retry once on 5xx with a small
    // backoff: the second response usually surfaces the real 401,
    // which gives the client an actionable error. If both attempts
    // 5xx, Yandex really is having a bad time and we still return
    // 503 (correct UX in that branch — valid users should retry,
    // not be logged out).
    const res = await this.fetchWithRetry(token);
    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Yandex rejected the token',
      });
    }
    if (res.status >= 500) {
      throw new ServiceUnavailableException({
        code: 'oauth_upstream_unavailable',
        message: `Yandex returned ${res.status}`,
      });
    }
    if (!res.ok) {
      // Other 4xx — treat as bad token rather than infra problem.
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: `Yandex returned ${res.status}`,
      });
    }

    const body = (await res.json().catch(() => null)) as {
      id?: string;
      default_email?: string;
      real_name?: string;
      first_name?: string;
      last_name?: string;
      login?: string;
    } | null;

    if (!body || !body.id) {
      this.logger.warn('Yandex userinfo response missing `id`');
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Yandex returned an unexpected payload',
      });
    }

    const composed = [body.first_name, body.last_name]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join(' ');
    const name = body.real_name || composed || body.login;

    // Yandex requires email verification at signup
    // and `default_email` is the address the user has explicitly chosen
    // as primary (https://yandex.ru/dev/id/doc/ru/user-information). It
    // is implicitly verified by Yandex policy, so we mark it verified
    // when present. There is no public `email_verified` claim in the
    // userinfo response.
    return {
      providerUserId: body.id,
      email: body.default_email,
      emailVerified:
        typeof body.default_email === 'string' && !!body.default_email,
      name: name || undefined,
    };
  }

  /**
   * Hit Yandex userinfo with one retry on 5xx. Each attempt is capped
   * at 5 s — a real userinfo call returns in ~50–200 ms, and our
   * gateway has its own request budget downstream. Network errors
   * count as "upstream unavailable" (503); we don't retry them here
   * because the user-facing fetch already failed end-to-end.
   */
  private async fetchWithRetry(token: string): Promise<Response> {
    const url = `${this.userInfoUrl}?format=json`;
    const doFetch = () =>
      fetch(url, {
        method: 'GET',
        headers: { Authorization: `OAuth ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      this.logger.error(
        `Yandex userinfo network error: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException({
        code: 'oauth_upstream_unavailable',
        message: 'Yandex ID is temporarily unavailable',
      });
    }
    if (res.status >= 500) {
      this.logger.warn(
        `Yandex userinfo first attempt returned ${res.status}; retrying once`,
      );
      // Drain so the underlying socket can be reused; ignore body.
      await res.text().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 200));
      try {
        res = await doFetch();
      } catch (err) {
        this.logger.error(
          `Yandex userinfo retry network error: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException({
          code: 'oauth_upstream_unavailable',
          message: 'Yandex ID is temporarily unavailable',
        });
      }
    }
    return res;
  }
}
