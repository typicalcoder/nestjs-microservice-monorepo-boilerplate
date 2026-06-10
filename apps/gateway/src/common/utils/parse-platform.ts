/**
 * Best-effort platform detection from a request's User-Agent. Used as an
 * ordering hint for OAuth verifiers (e.g. VK, which has separate client_ids
 * per platform); NEVER as a security boundary — a client can spoof UA.
 *
 * Recognised shapes:
 *   - Flutter / Dart on Android:  `Dart/3.x (dart:io; android)`
 *                                 `Dart/3.x (... Android ...)`
 *   - Flutter / Dart on iOS:      `Dart/3.x (dart:io; ios)` /
 *                                 `... Darwin/... CFNetwork/...`
 *   - Native iOS apps:            `... CFNetwork/... Darwin/...`,
 *                                 `... iOS/...`, `... iPhone OS ...`
 *   - Native Android apps:        `... Android/...`, `okhttp/... Android ...`
 *
 * Returns `null` when the UA either is missing or doesn't unambiguously
 * map to one platform — callers must fall back to platform-agnostic
 * behaviour (e.g. trying every candidate client_id).
 */
export function parsePlatformFromUserAgent(
  ua: string | undefined | null,
): 'android' | 'ios' | null {
  if (!ua) return null;
  const lower = ua.toLowerCase();

  // iOS markers — Darwin / CFNetwork / explicit iOS / iPhone OS / Cupertino.
  if (
    /\b(darwin|cfnetwork|cupertino|iphone\s*os|ios)\b/.test(lower) ||
    /;\s*ios[;)\s]/.test(lower)
  ) {
    return 'ios';
  }

  // Android marker — straightforward, no overlap with iOS substrings.
  if (/\bandroid\b/.test(lower)) {
    return 'android';
  }

  return null;
}
