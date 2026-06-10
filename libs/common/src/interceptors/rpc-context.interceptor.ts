import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { generateTraceId, requestContext } from '../context/async-storage';

interface RpcPayloadLike {
  __traceId?: string;
}

interface RmqContextLike {
  getPattern?: () => unknown;
}

const PATTERN_METADATA = 'microservices:pattern';

/**
 * Populates AsyncLocalStorage with traceId from incoming RMQ message.
 * Must be registered globally in every microservice bootstrap.
 */
@Injectable()
export class RpcContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RPC');
  private readonly reflector = new Reflector();

  constructor(private readonly serviceName: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();

    const data = context.switchToRpc().getData<RpcPayloadLike>() ?? {};
    const traceId = data.__traceId ?? generateTraceId();
    const pattern = this.extractPattern(context);
    const start = Date.now();

    return new Observable((subscriber) => {
      // Never populate userId from the wire payload — it is caller-controlled
      // and would be trivially forgeable. Handlers receive userId through the
      // explicit RPC message body; the AsyncLocalStorage context only carries
      // traceId/origin for observability.
      requestContext.run({ traceId, origin: this.serviceName }, () => {
        this.logger.log(`← ${pattern}`);
        next
          .handle()
          .pipe(
            tap({
              next: () => {
                this.logger.log(`→ ${pattern} ok (${Date.now() - start}ms)`);
              },
              error: (err: Error) => {
                this.logger.warn(
                  `→ ${pattern} err ${err.name}: ${err.message} (${Date.now() - start}ms)`,
                );
              },
            }),
          )
          .subscribe({
            next: (value) => subscriber.next(value),
            error: (err: unknown) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
      });
    });
  }

  /**
   * Resolve a human-readable pattern label for log lines. Try in order:
   *   1. RmqContext.getPattern() — the routing key the broker delivered on
   *   2. @MessagePattern/@EventPattern metadata on the handler
   *   3. handler.name (often empty for NestJS-wrapped methods)
   */
  private extractPattern(context: ExecutionContext): string {
    try {
      const rmq = context.switchToRpc().getContext<RmqContextLike>();
      const fromCtx = rmq?.getPattern?.();
      if (fromCtx !== undefined && fromCtx !== null && fromCtx !== '') {
        return typeof fromCtx === 'string' ? fromCtx : JSON.stringify(fromCtx);
      }
    } catch {
      // RmqContext may be missing in tests / non-RMQ transports — fall through.
    }

    const handler = context.getHandler();
    const fromMeta = this.reflector.get<unknown>(PATTERN_METADATA, handler);
    if (fromMeta !== undefined && fromMeta !== null && fromMeta !== '') {
      return typeof fromMeta === 'string' ? fromMeta : JSON.stringify(fromMeta);
    }

    return handler?.name || 'unknown';
  }
}
