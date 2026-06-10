import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  EVENT_BUS_TOKEN,
  QUEUES,
  RpcClientService,
  SERVICE_TOKENS,
  prefixedQueue,
} from '@app/common';
import { CustomAmqpProxy } from './amqp/custom-amqp-proxy';
import { EventBusService, EVENT_BUS_OPTIONS } from './amqp/event-bus.service';
import {
  DLQ_SERVICE_NAME,
  EventDeadLetterInterceptor,
} from './amqp/event-dead-letter.interceptor';

export { EventBusService, EVENT_BUS_OPTIONS } from './amqp/event-bus.service';
export {
  DLQ_SERVICE_NAME,
  EventDeadLetterInterceptor,
} from './amqp/event-dead-letter.interceptor';

/**
 * NestJS RMQ transport is NOT a pub/sub bus on its own — `client.emit`
 * publishes straight to a queue. Two paths are wired here:
 *
 *   - Direct queue delivery: `RpcClientService.emit(service, pattern,
 *     payload)` → one specific peer queue. Use for point-to-point
 *     side channels (cache invalidation, etc.).
 *   - Topic-exchange fan-out: `RpcClientService.publishEvent(pattern,
 *     payload)` → shared exchange `<stage>_events` → every consumer queue
 *     bound to the routing pattern. Use for domain events with multiple
 *     subscribers.
 *
 * Failed handlers go to the per-service DLQ (see EventDeadLetterInterceptor)
 * so we don't silently drop events.
 *
 * Adding a microservice: register its token in SERVICE_TOKENS + queue in
 * QUEUES, then add the key to ALL_SERVICES and QUEUE_BY_TOKEN below.
 */

export interface MessagingModuleOptions {
  url: string;
  /**
   * If set, the EventBusService binds this queue to the events topic
   * exchange for every routing key in `subscribesTo`. Microservices
   * pass their own queue name; gateway leaves it undefined (publish-only).
   */
  selfQueue?: string;
  /** Routing keys this service wants delivered into selfQueue. */
  subscribesTo?: string[];
}

type ServiceKey = keyof typeof SERVICE_TOKENS;

const ALL_SERVICES: ServiceKey[] = ['USER_SERVICE'];

const QUEUE_BY_TOKEN: Record<string, string> = {
  [SERVICE_TOKENS.USER_SERVICE]: QUEUES.USER_SERVICE,
};

/**
 * ClientProxy stand-in for peers we didn't register — calling it throws with
 * a clear message so misconfigurations surface loudly instead of hanging on
 * a 15s RPC timeout. Used by `forPeers()` to keep `RpcClientService` happy.
 */
class MissingPeerClient {
  constructor(private readonly serviceName: string) {}
  private fail(): never {
    throw new Error(
      `RPC to '${this.serviceName}' is not configured for this service. Add it to MessagingModule.forPeers([...]).`,
    );
  }
  send() {
    this.fail();
  }
  emit() {
    this.fail();
  }
  // ClientProxy exposes other methods we don't care about; the ones above are
  // the only hot paths our RpcClientService touches.
}

@Module({})
export class MessagingModule {
  /** Full setup for the gateway: clients for every microservice + RpcClientService. */
  static forRoot(options: MessagingModuleOptions): DynamicModule {
    return this.build(options, ALL_SERVICES, true);
  }

  /**
   * Subset registration for microservices. Pass the peer services this
   * microservice needs to call. RpcClientService is always wired so services
   * can use `rpc.user(...)` uniformly; unrequested peers get a stub client
   * that throws on use.
   */
  static forPeers(
    options: MessagingModuleOptions,
    peers: ServiceKey[],
  ): DynamicModule {
    // Global so peer-aware services can inject RpcClientService from any
    // module without wiring MessagingModule into every feature module.
    return this.build(options, peers, true);
  }

  private static build(
    options: MessagingModuleOptions,
    peers: ServiceKey[],
    global: boolean,
  ): DynamicModule {
    const registered = new Set(peers);
    const imports = peers.length
      ? [
          ClientsModule.register(
            peers.map((key) => ({
              name: SERVICE_TOKENS[key],
              transport: Transport.RMQ,
              customClass: CustomAmqpProxy,
              options: {
                urls: [options.url],
                queue: prefixedQueue(QUEUE_BY_TOKEN[SERVICE_TOKENS[key]]),
                queueOptions: { durable: true },
                noAck: true,
                prefetchCount: 10,
              },
            })),
          ),
        ]
      : [];

    // Stub providers for every service NOT in peers — RpcClientService's
    // constructor needs all tokens resolvable.
    const stubProviders: Provider[] = ALL_SERVICES.filter(
      (k) => !registered.has(k),
    ).map((k) => ({
      provide: SERVICE_TOKENS[k],
      useValue: new MissingPeerClient(SERVICE_TOKENS[k]),
    }));

    const busProvider: Provider = {
      provide: EVENT_BUS_OPTIONS,
      useValue: {
        url: options.url,
        selfQueue: options.selfQueue
          ? prefixedQueue(options.selfQueue)
          : undefined,
        subscribesTo: options.subscribesTo,
        deadLetterQueue: options.selfQueue
          ? prefixedQueue(`${options.selfQueue}.dlq`)
          : undefined,
      },
    };

    // DLQ routing key matches the prefixed selfQueue so EventBusService's
    // bindQueue(dlq, dlx, selfQueue) and interceptor's publish(dlx, selfQueue, …)
    // hit the same key.
    const serviceNameProvider: Provider = {
      provide: DLQ_SERVICE_NAME,
      useValue: options.selfQueue
        ? prefixedQueue(options.selfQueue)
        : 'gateway',
    };

    return {
      module: MessagingModule,
      global,
      imports,
      providers: [
        ...stubProviders,
        busProvider,
        serviceNameProvider,
        EventBusService,
        // Build the interceptor via factory so DI fully resolves bus +
        // service-name at construction time. Plain APP_INTERCEPTOR /
        // useExisting hit a registration-order issue where bus came in null.
        {
          provide: APP_INTERCEPTOR,
          useFactory: (bus: EventBusService, name: string) =>
            new EventDeadLetterInterceptor(bus, name),
          inject: [EventBusService, DLQ_SERVICE_NAME],
        },
        // Alias under the symbol RpcClientService injects via @Optional()
        { provide: EVENT_BUS_TOKEN, useExisting: EventBusService },
        RpcClientService,
      ],
      // Only re-export ClientsModule if it was actually imported. Services
      // with no peers (publish-only) get an empty `imports`, and exporting a
      // never-registered module trips `UnknownExportException` in Nest's
      // dependency scanner.
      exports: [
        ...(peers.length ? [ClientsModule] : []),
        RpcClientService,
        EventBusService,
      ],
    };
  }
}
