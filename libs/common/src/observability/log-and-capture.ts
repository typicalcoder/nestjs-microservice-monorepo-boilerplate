import { Logger } from '@nestjs/common';
import { captureWithTrace } from '../bootstrap/telemetry';

/**
 * Log at WARN + ship to Sentry with the current traceId.
 *
 * Use for non-fatal anomalies a human should look at: a per-user
 * subscription restore that bounced (other users still got through),
 * a suspicious credit pattern flagged by anomaly checks, etc.
 *
 * For terminal failures the operator must act on, use `errorAndCapture`.
 */
export function warnAndCapture(
  logger: Logger,
  message: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  logger.warn(message);
  captureWithTrace(err, context);
}

/**
 * Log at ERROR + ship to Sentry with the current traceId.
 *
 * Use for terminal failures: a swallowed RMQ consumer error that
 * an outbox row that exhausted its retry
 * budget, etc. Anything where Sentry needs to alert.
 */
export function errorAndCapture(
  logger: Logger,
  message: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  logger.error(message);
  captureWithTrace(err, context);
}
