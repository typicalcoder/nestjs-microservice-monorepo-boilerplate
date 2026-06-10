/**
 * Schemas for RMQ event payloads crossing service boundaries. Kept as plain
 * parse/guard functions rather than class-validator DTOs because:
 *   - events travel through `@EventPattern` where Nest's ValidationPipe
 *     doesn't wire up automatically without extra plumbing;
 *   - a missed event shape must not throw past the handler (RMQ noAck:true
 *     means the message is already gone) — we want a typed null result and
 *     a log line, not an exception.
 *
 * Callers invoke `parseX` → on null, they log + skip (or escalate to Sentry
 * via captureWithTrace for high-severity events).
 *
 * The example below (`user.deleted`) shows the pattern: publish via
 * `rpc.publishEvent('user.deleted', { userId })` (or stage it through the
 * outbox for at-least-once delivery), subscribe via `@EventPattern` and
 * validate the payload with `parseUserDeleted`. Add your own domain events
 * here the same way.
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export interface UserDeletedEvent {
  userId: string;
}

export function parseUserDeleted(raw: unknown): UserDeletedEvent | null {
  if (!isObject(raw)) return null;
  const { userId } = raw;
  if (!isNonEmptyString(userId)) return null;
  return { userId };
}
