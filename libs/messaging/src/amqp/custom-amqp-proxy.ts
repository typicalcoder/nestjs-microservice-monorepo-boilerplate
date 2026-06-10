import { ClientRMQ, ReadPacket } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { getOrCreateTraceId } from '@app/common';

/**
 * Extension over ClientRMQ that automatically attaches `__traceId` to every
 * outgoing payload. The traceId comes from AsyncLocalStorage (set by the gateway
 * request interceptor or by the RpcContextInterceptor in microservices).
 */
export class CustomAmqpProxy extends ClientRMQ {
  protected override dispatchEvent(
    packet: ReadPacket<unknown>,
  ): Promise<unknown> {
    return super.dispatchEvent(this.enrich(packet));
  }

  override emit<TResult = unknown, TPayload = unknown>(
    pattern: unknown,
    payload: TPayload,
  ): Observable<TResult> {
    return super.emit<TResult>(pattern, this.attachTraceId(payload));
  }

  override send<TResult = unknown, TPayload = unknown>(
    pattern: unknown,
    payload: TPayload,
  ): Observable<TResult> {
    return super.send<TResult>(pattern, this.attachTraceId(payload));
  }

  private enrich(packet: ReadPacket<unknown>): ReadPacket<unknown> {
    return { ...packet, data: this.attachTraceId(packet.data) };
  }

  private attachTraceId<T>(payload: T): T {
    if (payload === null || payload === undefined) {
      return { __traceId: getOrCreateTraceId() } as unknown as T;
    }
    if (typeof payload !== 'object') return payload;
    const obj = payload as Record<string, unknown>;
    if (obj['__traceId']) return payload;
    return { ...obj, __traceId: getOrCreateTraceId() } as T;
  }
}
