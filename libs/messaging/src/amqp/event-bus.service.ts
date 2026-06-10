import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import * as amqp from 'amqp-connection-manager';
import type {
  ChannelWrapper,
  AmqpConnectionManager,
} from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { getOrCreateTraceId, prefixedQueue } from '@app/common';

export const EVENT_BUS_OPTIONS = Symbol('EVENT_BUS_OPTIONS');

export interface EventBusOptions {
  /** AMQP URL — same one services already use for RPC. */
  url: string;
  /**
   * The owning queue this service consumes from (NestJS RMQ ConsumerService
   * already declares it). When set, the bus binds it to the events exchange
   * for every routing key in `subscribesTo`. Leave undefined for callers
   * that only PUBLISH (gateway).
   */
  selfQueue?: string;
  /**
   * Routing keys (pattern strings) this service wants to receive on its
   * `selfQueue`. Topic-pattern wildcards (`*`, `#`) are supported by AMQP
   * but we use exact pattern strings to mirror how `@EventPattern` is
   * declared in code — keeps grep-ability.
   */
  subscribesTo?: string[];
  /**
   * Optional per-service DLQ queue name (already prefixed). Bound to the
   * shared DLX. EventDeadLetterInterceptor publishes failed handler events
   * to the DLX with diagnostics — they land in this queue for ops review.
   */
  deadLetterQueue?: string;
}

/**
 * Shared exchange name (will be prefixed by stage same as queues so
 * dev/prod traffic can't cross). Topic exchange — multiple queues can
 * bind to the same routing key, giving real fan-out semantics
 *. Producers call `RpcClientService.publishEvent(pattern,
 * payload)`; bound consumers receive a copy each.
 */
function eventsExchangeName(): string {
  return prefixedQueue('events');
}

function eventsDlxName(): string {
  return prefixedQueue('events.dlx');
}

/**
 * Single bus instance per service. Initialises the topology (exchange + DLX +
 * queue bindings) on bootstrap, then exposes `publish(pattern, payload)`.
 *
 * Why a separate amqplib connection rather than reusing NestJS's ClientRMQ
 * channels:
 *   - ClientRMQ is queue-direct and exposes no API for declaring or
 *     publishing to an exchange. Wrapping its internals would couple us to
 *     the package version.
 *   - amqp-connection-manager is already a transitive dep of @nestjs/microservices
 *     and gives us auto-reconnect + ChannelWrapper out of the box.
 */
@Injectable()
export class EventBusService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EventBusService.name);
  private connection: AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;

  constructor(
    @Inject(EVENT_BUS_OPTIONS) private readonly options: EventBusOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const exchange = eventsExchangeName();
    const dlx = eventsDlxName();
    const subs = this.options.subscribesTo ?? [];
    const selfQueue = this.options.selfQueue;
    const maskedUrl = maskAmqpUrl(this.options.url);

    this.logger.log(`event-bus: connecting to ${maskedUrl}`);

    this.connection = amqp.connect([this.options.url]);
    this.connection.on('connect', () =>
      this.logger.log(`event-bus connected (exchange=${exchange})`),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(
        `event-bus disconnected: ${err?.message ?? 'unknown reason'}`,
      ),
    );
    // amqp-connection-manager fires `connectFailed` with the underlying
    // network error (ECONNREFUSED / ETIMEDOUT / EHOSTUNREACH) on each
    // failed dial. `disconnect` after a failed first dial often fires
    // with an empty error, so without this listener a broker that's
    // simply unreachable surfaces only as `disconnected: unknown reason`.
    this.connection.on('connectFailed', ({ err }) =>
      this.logger.error(
        `event-bus: connectFailed url=${maskedUrl} err=${(err as Error | undefined)?.message ?? 'unknown'}`,
      ),
    );

    this.channel = this.connection.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        // Topic exchange — multi-queue fan-out by routing key match.
        await ch.assertExchange(exchange, 'topic', { durable: true });
        // Dead-letter exchange. Manual-publish DLQ pattern: handlers that
        // throw are caught by EventDeadLetterInterceptor which republishes
        // the failed event here with diagnostics envelope. We deliberately
        // keep noAck:true on main queues to avoid infinite requeue on
        // poison-pill messages (NestJS RMQ would loop without an
        // attempts-counter contract).
        //
        // Topic exchange — routing key on dead-letter publish is the
        // service name, so each per-service DLQ binds to its own key
        // and stays isolated.
        await ch.assertExchange(dlx, 'topic', { durable: true });

        if (selfQueue && subs.length) {
          // Don't redeclare the queue itself — NestJS RMQ ConsumerService
          // already did that with its own queueOptions. Just add bindings.
          for (const pattern of subs) {
            await ch.bindQueue(selfQueue, exchange, pattern);
            this.logger.log(`bind ${selfQueue} → ${exchange}/${pattern}`);
          }
        }

        // Per-service dead-letter queue. Durable so messages survive a
        // broker restart; ops inspects via the RabbitMQ UI or a future
        // /admin/dlq endpoint.
        // Routing key = service name (selfQueue without the prefix). Each
        // DLQ binds with its own key so failures don't cross-contaminate
        // when multiple services subscribed to the same upstream pattern.
        if (this.options.deadLetterQueue && selfQueue) {
          await ch.assertQueue(this.options.deadLetterQueue, {
            durable: true,
          });
          await ch.bindQueue(this.options.deadLetterQueue, dlx, selfQueue);
          this.logger.log(
            `bind ${this.options.deadLetterQueue} → ${dlx}/${selfQueue}`,
          );
        }
      },
    });

    // Heartbeat while we wait for the first connect. Without this the
    // gateway's `OnApplicationBootstrap` hook silently blocks `app.init()`
    // when RMQ is down — pod stays "Ready" (no probes), stdout empty,
    // diagnosis takes hours. The 5s heartbeat surfaces the wait in
    // `kubectl logs` immediately and pairs with the `connectFailed`
    // listener above so ops can see *why* it's stuck, not just *that*.
    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      this.logger.warn(
        `event-bus: still waiting for RMQ at ${maskedUrl} (${elapsedSec}s elapsed)`,
      );
    }, 5000);
    watchdog.unref();
    // Hard cap so a permanently-unreachable broker triggers a pod restart
    // instead of an indefinite "Ready" hang. With probes still TODO on the
    // Argo side this throw is currently the only signal that bumps
    // `RESTARTS` and surfaces the failure in `kubectl get pods`. Default
    // 60s; override via `RMQ_BOOT_TIMEOUT_MS=0` to disable in local dev.
    const timeoutMs = Number(process.env['RMQ_BOOT_TIMEOUT_MS'] ?? 60_000);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise =
      timeoutMs > 0
        ? new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(
                new Error(
                  `event-bus: RMQ connect did not succeed within ${timeoutMs}ms (url=${maskedUrl})`,
                ),
              );
            }, timeoutMs);
            timeoutHandle.unref();
          })
        : null;
    try {
      await (timeoutPromise
        ? Promise.race([this.channel.waitForConnect(), timeoutPromise])
        : this.channel.waitForConnect());
    } finally {
      clearInterval(watchdog);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  /**
   * Publish a fan-out event to the topic exchange. Format mirrors what
   * NestJS RMQ ConsumerService expects so existing `@EventPattern(pattern)`
   * handlers receive the payload unchanged.
   *
   * Persistent + mandatory:
   *   - persistent so a broker restart doesn't lose events
   *   - mandatory:false because unrouted messages (no queue bound) are
   *     valid: e.g. an event may not have any subscriber bound yet.
   */
  publish(pattern: string, payload: object): boolean {
    if (!this.channel) {
      this.logger.warn(`publish ${pattern} dropped: bus not initialised yet`);
      return false;
    }
    const traceId = getOrCreateTraceId();
    const data =
      payload && typeof payload === 'object' && !('__traceId' in payload)
        ? { ...payload, __traceId: traceId }
        : payload;
    const message = { pattern, data };
    // ChannelWrapper.publish returns Promise<boolean> but we're fire-and-
    // forget: amqp-connection-manager buffers locally on disconnect, so
    // awaiting would serialize publishes under normal operation. Log on
    // actual failure to avoid losing it silently.
    void this.channel
      .publish(eventsExchangeName(), pattern, message, {
        persistent: true,
        contentType: 'application/json',
      })
      .catch((err: unknown) => {
        this.logger.error(
          `publish ${pattern} failed: ${(err as Error).message}`,
        );
      });
    return true;
  }

  /**
   * Publish a failed event into the dead-letter exchange with diagnostics.
   * Called from EventDeadLetterInterceptor when a `@EventPattern` handler
   * throws. Wraps the original payload in a metadata envelope so ops can
   * see why it failed without spelunking through service logs.
   */
  publishToDeadLetter(
    originalPattern: string,
    originalPayload: unknown,
    error: Error,
    serviceName: string,
  ): boolean {
    if (!this.channel) {
      this.logger.warn(
        `dlq publish ${originalPattern} dropped: bus not initialised`,
      );
      return false;
    }
    const envelope = {
      // The dead-letter routing key carries the original pattern + a marker
      // so DLQ consumers can demux if they ever care. Fanout DLX ignores
      // the key — it's purely informational.
      pattern: 'dlq.event_handler_failed',
      data: {
        service: serviceName,
        originalPattern,
        originalPayload,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
        },
        deadLetteredAt: new Date().toISOString(),
        traceId: getOrCreateTraceId(),
      },
    };
    // Routing key = service name. Each per-service DLQ bound with its own
    // key so the failure stays isolated to the service that produced it.
    void this.channel
      .publish(eventsDlxName(), serviceName, envelope, {
        persistent: true,
        contentType: 'application/json',
      })
      .catch((err: unknown) => {
        this.logger.error(
          `dlq publish ${originalPattern} failed: ${(err as Error).message}`,
        );
      });
    return true;
  }
}

/**
 * Strip credentials from an AMQP URL for logs. `amqp://user:pass@host/vhost`
 * → `amqp://host/vhost`. Falls back to `'<unparsable>'` so a malformed URL
 * never leaks into stdout untouched.
 */
function maskAmqpUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return '<unparsable>';
  }
}
