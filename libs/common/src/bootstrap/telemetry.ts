import type { LoggerService } from '@nestjs/common';
import { createLogger, format, transports } from 'winston';
import * as Sentry from '@sentry/node';
import { requestContext } from '../context/async-storage';
import { redactSecrets, SECRET_REDACTED } from './redact-secrets';

export { redactSecrets, SECRET_REDACTED };

/**
 * Build a Nest LoggerService backed by a winston Console transport. JSON in
 * non-TTY (k8s pods, CI), colorized pretty in interactive terminals. Carries
 * `service` and the current AsyncLocalStorage traceId on every line.
 *
 * Pattern from a sibling project that works under webpack-bundled Nest: build
 * the winston logger with no top-level format/transports, then `.add()` a
 * Console transport with the format scoped to the transport. The previous
 * `WinstonModule.createLogger({ format, transports })` shape silently swallowed
 * every line in our bundled main.js and left every microservice/task pod
 * without observable output.
 */
export function buildLogger(serviceName: string): LoggerService {
  const isProd = process.env['NODE_ENV'] === 'production';
  const formatOverride = process.env['LOG_FORMAT']?.toLowerCase();
  const usePretty =
    formatOverride === 'pretty' ||
    (formatOverride !== 'json' && Boolean(process.stdout.isTTY));

  const injectTrace = format((info) => {
    const ctx = requestContext.getStore();
    if (ctx?.traceId) info['traceId'] = ctx.traceId;
    info['service'] = serviceName;
    return info;
  });
  // Walk every meta object before serialisation and replace
  // KEY/SECRET/TOKEN/PASSWORD/PRIVATE values with [REDACTED].
  const redact = format((info) => redactSecrets(info) as typeof info);

  const consoleFormat = usePretty
    ? format.combine(
        format.errors({ stack: true }),
        format.timestamp(),
        injectTrace(),
        redact(),
        format.colorize({ all: false }),
        format.printf((info) => {
          const meta = info as Record<string, unknown>;
          const stringifyMeta = (v: unknown): string =>
            typeof v === 'string'
              ? v
              : typeof v === 'number' || typeof v === 'boolean'
                ? String(v)
                : '';
          const ctxPart = meta['context']
            ? ` [${stringifyMeta(meta['context'])}]`
            : '';
          const tracePart = meta['traceId']
            ? ` trace=${stringifyMeta(meta['traceId'])}`
            : '';
          return `${stringifyMeta(meta['timestamp'])} ${stringifyMeta(meta['level'])} [${stringifyMeta(meta['service'])}]${ctxPart}${tracePart} ${stringifyMeta(meta['message'])}`;
        }),
      )
    : format.combine(
        format.errors({ stack: true }),
        format.timestamp(),
        injectTrace(),
        redact(),
        format.json(),
      );

  const logger = createLogger({
    level: process.env['LOG_LEVEL'] ?? (isProd ? 'info' : 'debug'),
  });
  logger.add(new transports.Console({ format: consoleFormat }));

  return {
    log(message: unknown, ...optionalParams: unknown[]): void {
      logger.log('info', message as string, ...optionalParams);
    },
    error(message: unknown, ...optionalParams: unknown[]): void {
      logger.error(message as string, ...optionalParams);
    },
    warn(message: unknown, ...optionalParams: unknown[]): void {
      logger.warn(message as string, ...optionalParams);
    },
    debug(message: unknown, ...optionalParams: unknown[]): void {
      logger.debug(message as string, ...optionalParams);
    },
    verbose(message: unknown, ...optionalParams: unknown[]): void {
      logger.verbose(message as string, ...optionalParams);
    },
  };
}

/**
 * Initialize Sentry once per process. Skips silently if SENTRY_DSN is unset,
 * so dev/staging without Sentry just logs normally.
 */
export function initSentry(serviceName: string): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    serverName: serviceName,
    tracesSampleRate: Number(
      process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.05',
    ),
    release: process.env['RELEASE_TAG'],
    // scrub anything looking like a secret out of the event
    // payload. Sentry has its own server-side scrubbing but we're not
    // willing to leak even briefly — do it at the source.
    beforeSend(event) {
      if (event.extra) {
        event.extra = redactSecrets(event.extra) as Record<string, unknown>;
      }
      if (event.contexts) {
        event.contexts = redactSecrets(event.contexts) as typeof event.contexts;
      }
      if (event.request?.data) {
        event.request.data = redactSecrets(event.request.data);
      }
      if (event.request?.headers) {
        event.request.headers = redactSecrets(event.request.headers) as Record<
          string,
          string
        >;
      }
      return event;
    },
  });
}

/**
 * Attach the current AsyncLocalStorage traceId to a Sentry event as a tag
 * so issues are linkable back to request logs.
 */
export function captureWithTrace(
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  const ctx = requestContext.getStore();
  Sentry.captureException(err, {
    tags: { traceId: ctx?.traceId ?? 'none', origin: ctx?.origin ?? 'none' },
    extra,
  });
}
