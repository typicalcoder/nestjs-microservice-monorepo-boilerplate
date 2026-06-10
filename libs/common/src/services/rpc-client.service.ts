import {
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { SERVICE_TOKENS } from '../constants/queue.constants';
import { getTraceId } from '../context/async-storage';
import { ERROR_CODES } from '../dto/error-response.dto';
import { isRpcErrorPayload } from '../exceptions/rpc.exception';

/**
 * Minimal interface for the publish bus we delegate to. Defined here so
 * libs/common doesn't depend on libs/messaging (which would create a cycle).
 * libs/messaging exports EventBusService that conforms to this shape.
 */
export interface IEventBus {
  publish(pattern: string, payload: object): boolean;
}

export const EVENT_BUS_TOKEN = Symbol('IEventBus');

/** Service names callers route to. Add a member per microservice you wire. */
export type ServiceName = 'user';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Single injection point for all gateway → microservice RPC calls.
 *
 * Replaces the verbose `firstValueFrom(this.userClient.send(MSG.Y, {...}))`
 * pattern. Provides:
 *   - typed service routing (.user — add .yourService when you add a peer)
 *   - unified timeout (15s default)
 *   - error envelope unwrapping → HttpException with correct status
 *   - automatic traceId propagation via CustomAmqpProxy
 *
 * Usage in gateway controllers:
 *   constructor(private readonly rpc: RpcClientService) {}
 *   getMe(user) {
 *     return this.rpc.user<UserDto>(MSG.GET_USER_BY_ID, { userId: user.userId });
 *   }
 *
 * To add a microservice: register its token in SERVICE_TOKENS, add it to
 * MessagingModule's ALL_SERVICES, inject the client below, and add a routing
 * helper mirroring `user()`.
 */
@Injectable()
export class RpcClientService {
  private readonly logger = new Logger(RpcClientService.name);

  constructor(
    @Inject(SERVICE_TOKENS.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Optional()
    @Inject(EVENT_BUS_TOKEN)
    private readonly eventBus: IEventBus | null = null,
  ) {}

  user<T = unknown>(
    pattern: string,
    payload: object = {},
    timeoutMs?: number,
  ): Promise<T> {
    return this.send<T>('user', this.userClient, pattern, payload, timeoutMs);
  }

  /**
   * Fire-and-forget event emission to ONE service queue.
   *
   * Direct queue delivery — `client.emit()` writes straight to the target
   * service's queue, NOT through the topic exchange. Use this for
   * point-to-point side channels (e.g. cache invalidation aimed at one
   * peer). For fan-out (many subscribers, one publish), use
   * {@link publishEvent}.
   */
  emit(service: ServiceName, pattern: string, payload: object = {}): void {
    const client = this.pickClient(service);
    try {
      client.emit(pattern, payload).subscribe({
        error: (err: Error) => {
          this.logger.warn(`emit ${service}.${pattern} failed: ${err.message}`);
        },
      });
    } catch (err) {
      // Peer not configured in MessagingModule.forPeers — stub client throws
      // synchronously. Downgrade to debug; callers that need strict delivery
      // should handle the failure themselves.
      this.logger.debug(
        `emit ${service}.${pattern} skipped: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Publish a fan-out event to the topic exchange. Every service whose queue
   * is bound to the matching routing key receives a copy. Fire-and-forget;
   * durability is the outbox dispatcher's job.
   *
   * In environments without `EventBusService` wired (unit tests with a
   * stripped MessagingModule) the call logs and drops.
   */
  publishEvent(pattern: string, payload: object = {}): void {
    if (!this.eventBus) {
      this.logger.debug(
        `publishEvent(${pattern}) skipped — EventBusService not wired`,
      );
      return;
    }
    try {
      this.eventBus.publish(pattern, payload);
    } catch (err) {
      this.logger.warn(
        `event-bus publish ${pattern} failed: ${(err as Error).message}`,
      );
    }
  }

  private pickClient(service: ServiceName): ClientProxy {
    if (service === 'user') return this.userClient;
    // Exhaustive: extend ServiceName + this switch when adding peers.
    throw new Error(`Unknown RPC service '${service as string}'`);
  }

  private async send<T>(
    service: string,
    client: ClientProxy,
    pattern: string,
    payload: object,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    try {
      return await firstValueFrom(
        client.send<T>(pattern, payload).pipe(
          timeout(timeoutMs),
          catchError((err: unknown) => {
            throw this.unwrapError(service, pattern, err);
          }),
        ),
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw this.unwrapError(service, pattern, err);
    }
  }

  private unwrapError(service: string, pattern: string, err: unknown): Error {
    const traceId = getTraceId();

    if (err instanceof TimeoutError) {
      this.logger.warn(`${service}.${pattern} timeout [${traceId ?? '-'}]`);
      return new GatewayTimeoutException({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: `Upstream service '${service}' timed out`,
      });
    }

    if (isRpcErrorPayload(err)) {
      return new HttpException(
        {
          statusCode: err.status,
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
        err.status,
      );
    }

    // NestJS wraps RpcException serialization as plain object — inspect common shapes
    const maybe = err as { error?: unknown; message?: string };
    if (maybe?.error && isRpcErrorPayload(maybe.error)) {
      const p = maybe.error;
      return new HttpException(
        {
          statusCode: p.status,
          code: p.code,
          message: p.message,
          ...(p.details ? { details: p.details } : {}),
        },
        p.status,
      );
    }

    this.logger.error(
      `${service}.${pattern} unknown error [${traceId ?? '-'}]: ${maybe?.message ?? String(err)}`,
    );
    return new ServiceUnavailableException({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: `Upstream service '${service}' is unavailable`,
    });
  }
}
