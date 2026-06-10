# Auth flow

Token model:

- **access** — short-lived JWT (`JWT_ACCESS_EXPIRES_IN`, default 15m), sent as
  `Authorization: Bearer`. Carries `sub` (userId) and `type` (account type).
- **refresh** — long-lived JWT (default 30d), single-use, **device-bound**
  (`deviceId` claim) and gated by the user's `tokenVersion` (`tv` claim). Bumping
  `tokenVersion` (password reset, account upgrade, account delete) revokes every
  outstanding refresh token.

On an expired access token the gateway returns `401` with `code: token_expired`
— refresh silently. Any other `401` (`token_invalid`, `device_mismatch`) means
the stored tokens are unusable: wipe them and go through the cold-start flow.

Every endpoint that issues or rotates a refresh token requires the
`X-Device-Id` header. The value is baked into the refresh JWT, so a stolen token
used from another device fails the match on `/refresh`.

## Which endpoint to call

| Situation | Endpoint |
|-----------|----------|
| Have a refresh token (access expired/expiring) | `POST /v1/auth/refresh` |
| Cold start, no stored credentials | `POST /v1/auth/autoreg` |
| Anonymous (autoreg) user enters email/OAuth | `POST /v1/auth/upgrade` |
| Recover on a new device by email + password | `POST /v1/auth/login` |
| Recover on a new device via OAuth | `POST /v1/auth/oauth/:provider` |
| User taps "log out" | `POST /v1/auth/logout` |
| Forgot password → email a reset link | `POST /v1/auth/forgot` |
| Set a new password from the emailed token | `POST /v1/auth/reset` |

If `/refresh` itself returns `401` (`token_invalid` / `device_mismatch`), wipe
both tokens and fall back to the cold-start flow.

## OAuth providers

`vk` and `yandex` are wired (see `apps/gateway/src/modules/auth/oauth`). The
verifier validates the provider token server-side and returns a normalized
identity; `findOrCreateOAuthUser` only auto-merges into an existing account when
the provider attests the email is verified. `google` / `apple` are stubbed —
add a verifier and register it in `OAuthVerifierFactory`.
