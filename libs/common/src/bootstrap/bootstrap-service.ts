import {
  INestMicroservice,
  Logger,
  type Type,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { prefixedQueue } from '../constants/queue.constants';
import { RpcAllExceptionsFilter } from '../filters/rpc-exception.filter';
import { RpcContextInterceptor } from '../interceptors/rpc-context.interceptor';
import { buildLogger, captureWithTrace, initSentry } from './telemetry';
import {
  startMetricsServer,
  stopMetricsServer,
} from '../observability/metrics-server';

export interface BootstrapOptions {
  /** RabbitMQ queue name (must be unique per service). */
  queue: string;
  /** Short service name for logs/traces, e.g. 'user'. */
  serviceName: string;
  /** How many in-flight messages a consumer processes concurrently. */
  prefetchCount?: number;
}

/**
 * Uniform microservice bootstrap. Every microservice's main.ts should use this.
 *
 * Wires in:
 *   - RabbitMQ transport with durable queues, manual ack
 *   - Global ValidationPipe
 *   - Global RpcContextInterceptor (traceId → AsyncLocalStorage, RPC logs)
 *   - Global RpcAllExceptionsFilter (converts all errors to RpcErrorPayload)
 *   - Graceful shutdown on SIGINT / SIGTERM
 */
export async function bootstrapService(
  module: Type,
  options: BootstrapOptions,
): Promise<INestMicroservice> {
  initSentry(options.serviceName);
  const nestLogger = buildLogger(options.serviceName);
  const logger = new Logger(`Bootstrap:${options.serviceName}`);
  const rabbitUrl = process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672';
  const queueName = prefixedQueue(options.queue);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    module,
    {
      transport: Transport.RMQ,
      // `bufferLogs:true` + `app.useLogger(...)` below pair with the custom
      // logger so Nest startup events and every `new Logger(...)` call land
      // in winston/stdout. Without the explicit useLogger, internal Nest
      // bootstrap logs slip through the built-in ConsoleLogger first.
      bufferLogs: true,
      logger: nestLogger,
      options: {
        urls: [rabbitUrl],
        queue: queueName,
        queueOptions: { durable: true },
        prefetchCount: options.prefetchCount ?? 10,
        // noAck:true because @nestjs/microservices (v11) does not auto-ack RPC
        // messages on success — with noAck:false the in-flight count grows
        // every request until prefetch is hit and delivery stalls. For RPC the
        // result is returned to the caller, so redelivery semantics don't add
        // value; events that need at-least-once delivery should get their own
        // consumer with explicit ack.
        noAck: true,
      },
    },
  );
  app.useLogger(nestLogger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // Per-RPC EM fork is handled by `@CreateRequestContext()` on each
  // @MessagePattern method (see security fix #10). Attempts to wire it through
  // a global interceptor broke ack semantics — keep this global list minimal.
  app.useGlobalInterceptors(new RpcContextInterceptor(options.serviceName));
  app.useGlobalFilters(new RpcAllExceptionsFilter());

  app.enableShutdownHooks();

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — closing microservice`);
    try {
      await stopMetricsServer();
      await app.close();
      logger.log('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Shutdown error', err as Error);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // Last-resort capture for promise rejections that escaped every
  // try/catch and for synchronous throws on the event loop. The Sentry
  // node SDK installs its own integrations for these, but we want a
  // local log line too — silent crashes have already cost us hours of
  // diagnosis on this codebase.
  installProcessErrorHandlers(options.serviceName, logger);

  await app.listen();
  logger.log(`Listening on queue '${queueName}'`);
  // Start the Prometheus /metrics listener after the microservice is
  // up. Skipped silently if METRICS_PORT is unset.
  startMetricsServer(options.serviceName);
  return app;
}

/**
 * Install process-level error handlers that ship to Sentry and emit a
 * structured warn line. Idempotent: safe to call once per process. Used
 * by both microservice bootstrap and gateway main.ts.
 *
 * Why both layers: a thrown error inside an unawaited Promise (common
 * pattern in setTimeout / event-emitter callbacks) bypasses every
 * Nest filter and would otherwise vanish into stderr. A swallowed
 * unhandledRejection is the canonical "I don't know why prod is down"
 * incident — make sure it's loud.
 */
export function installProcessErrorHandlers(
  serviceName: string,
  logger: Logger,
): void {
  process.on('unhandledRejection', (reason) => {
    logger.error(`[${serviceName}] unhandledRejection: ${String(reason)}`);
    captureWithTrace(reason, { tag: 'process.unhandled_rejection' });
  });
  process.on('uncaughtException', (err) => {
    logger.error(`[${serviceName}] uncaughtException: ${err.message}`);
    captureWithTrace(err, { tag: 'process.uncaught_exception' });
  });
}
