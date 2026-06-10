/**
 * Recursively walk a value and replace anything whose key matches one of
 * the secret-name patterns with `[REDACTED]`. Used by the winston log
 * formatter and by the Sentry `beforeSend` hook so a stray
 * `logger.error('boom', { config: process.env })` (or any unhandled
 * exception that captures a config object) doesn't leak credentials
 * into Loki / Sentry.
 *
 * The match is case-insensitive and substring-based — `API_KEY_ID`,
 * `JWT_REFRESH_SECRET`, `SMTP_PASSWORD`, `Authorization`, etc. all
 * trigger.
 *
 * Caveats:
 *   - This is *defense in depth*, not a license to log credentials. A
 *     determined leak (printing the value with a non-secret key name) is
 *     still possible.
 *   - We never recurse into Buffers, Dates, or Errors; those serialize
 *     fine on their own and walking them is wasteful.
 */
export const SECRET_REDACTED = '[REDACTED]';

// FINGERPRINT and VERIFIER added to the regex.
// `fingerprint` is a perpetual recovery token by design.
// `code_verifier` is the PKCE secret half of an OAuth handshake — leaking
// it lets an attacker complete the authorization code exchange.
const SECRET_KEY_RE =
  /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|AUTHORIZATION|AUTH|CREDENTIAL|COOKIE|SESSION|API_-?KEY|FINGERPRINT|VERIFIER)/i;

const MAX_DEPTH = 6;

export function redactSecrets(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return input;
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v, depth + 1));
  }
  // Don't walk through these — winston/Sentry serialise them themselves.
  if (
    input instanceof Error ||
    input instanceof Date ||
    Buffer.isBuffer(input)
  ) {
    return input;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = SECRET_REDACTED;
    } else {
      out[k] = redactSecrets(v, depth + 1);
    }
  }
  return out;
}
