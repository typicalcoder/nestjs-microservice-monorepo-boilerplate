/**
 * Normalized OAuth identity returned by every provider verifier. Keeps the
 * caller (AuthService) decoupled from per-provider response shapes.
 *
 * `providerUserId` is the stable identifier we store in `User.oauthLinks` —
 * it MUST come from a server-verified field (JWT `sub` for VK, `id` from
 * Yandex's user-info endpoint), never from anything the client could spoof.
 *
 * `email` MAY be present even when the provider has
 * not verified that the user controls that mailbox (VK idToken without
 * `email_verified=true` is the canonical case). `findOrCreateOAuthUser`
 * auto-merges accounts by email match, so an unverified email is a
 * potential takeover vector. Verifiers set `emailVerified` to record
 * the provider's own confidence; the user-service only auto-merges
 * when the flag is true.
 */
export interface OAuthIdentity {
  providerUserId: string;
  email?: string;
  /** True iff the provider asserted the user controls `email`. */
  emailVerified?: boolean;
  name?: string;
}

export type OAuthProviderId = 'google' | 'apple' | 'vk' | 'yandex';

/** Hints from the request that help a verifier pick faster paths.
 *  None of these are trusted as security input — they only tweak ordering
 *  of equivalent attempts (e.g. which platform's client_id VK tries first). */
export interface OAuthVerifyHints {
  platform?: 'android' | 'ios';
}

export interface OAuthVerifier {
  /**
   * Verify a token from a specific provider and return the normalized
   * identity. Throws `UnauthorizedException` (`code: 'token_invalid'`) on
   * any failure mode — expired, forged, audience mismatch, network 4xx
   * from the upstream userinfo endpoint. Network 5xx from the upstream
   * surfaces as `ServiceUnavailableException` so the gateway returns 503,
   * not 401 (so a transient outage doesn't look like a credential issue).
   *
   * The `idToken` / `accessToken` fields from OAuthDto are passed in as
   * a single `token` string — providers that distinguish (VK) inspect the
   * shape themselves.
   *
   * `hints` is best-effort, never trusted: e.g. `platform=ios` skips the
   * Android-first probe inside VK verification but doesn't change which
   * client_ids are acceptable.
   */
  verify(token: string, hints?: OAuthVerifyHints): Promise<OAuthIdentity>;
}
