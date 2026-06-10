import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EventBusService } from './event-bus.service';
import { captureWithTrace } from '@app/common';

export const DLQ_SERVICE_NAME = Symbol('DLQ_SERVICE_NAME');

// NestJS microservices internals — re-declared here to avoid importing
// from `@nestjs/microservices/constants` which isn't part of the public API.
// Source: node_modules/@nestjs/microservices/{constants,enums/pattern-handler.enum}.js
const PATTERN_HANDLER_METADATA = 'microservices:handler_type';
const PATTERN_HANDLER_EVENT = 2; // PatternHandler.EVENT

/**
 * Catches errors thrown by `@EventPattern` handlers and republishes the
 * failed message to the DLX with diagnostics. Crucially **does not rethrow** —
 * NestJS RMQ Server runs with noAck:true so re-throwing wouldn't trigger
 * any broker-side retry; it would just bubble into a generic error log
 * with no payload context.
 *
 * Scope: only RPC contexts. HTTP requests are handled by the gateway's
 * HttpExceptionFilter and shouldn't go anywhere near a dead-letter queue.
 */
@Injectable()
export class EventDeadLetterInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EventDeadLetterInterceptor.name);

  constructor(
    @Optional() private readonly bus: EventBusService | null,
    @Optional()
    @Inject(DLQ_SERVICE_NAME)
    private readonly serviceName: string | null = 'unknown',
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Skip HTTP — only RPC contexts have @MessagePattern / @EventPattern.
    if (ctx.getType() !== 'rpc') return next.handle();

    // CRITICAL: only intercept @EventPattern handlers. @MessagePattern
    // handlers are RPC commands whose errors must propagate back to the
    // caller (gateway translates to HTTP status). Swallowing those would
    // turn every "Invalid credentials" 401 into "no elements in sequence"
    // 503 at the gateway because the reply Observable never emits.
    const handler = ctx.getHandler();
    const handlerType = handler
      ? (Reflect.getMetadata(PATTERN_HANDLER_METADATA, handler) as
          | number
          | undefined)
      : undefined;
    if (handlerType !== PATTERN_HANDLER_EVENT) {
      // RPC command (or untagged handler) — bubble errors normally.
      return next
        .handle()
        .pipe(catchError((err: unknown) => throwError(() => err)));
    }

    return next.handle().pipe(
      catchError((err: unknown) => {
        const rpc = ctx.switchToRpc();
        const data: unknown = rpc.getData();
        const pattern = this.extractPattern(ctx);
        const error = err instanceof Error ? err : new Error(String(err));

        this.logger.error(
          `event handler ${pattern ?? '<unknown>'} threw: ${error.message}`,
        );
        captureWithTrace(error, {
          tag: 'event_handler_threw',
          pattern,
          payload: data,
        });

        if (this.bus) {
          this.bus.publishToDeadLetter(
            pattern ?? '<unknown>',
            data,
            error,
            this.serviceName ?? 'unknown',
          );
        } else {
          this.logger.warn(
            'event-bus not available; failed event NOT recorded in DLQ',
          );
        }

        // Swallow — broker already considers the message acked (noAck:true),
        // so propagating the exception only pollutes logs.
        return of(undefined);
      }),
    );
  }

  private extractPattern(ctx: ExecutionContext): string | undefined {
    // NestJS RMQ wraps incoming events; the routing pattern lives on the
    // RpcArgumentsHost context object. Different transport versions expose
    // it under slightly different names — try both.
    const rpc = ctx.switchToRpc();
    const ctxObj = rpc.getContext<{
      getPattern?: () => string;
      args?: unknown[];
    }>();
    if (typeof ctxObj?.getPattern === 'function') {
      try {
        return ctxObj.getPattern();
      } catch {
        // fall through
      }
    }
    // Fallback: handler method name from the executor
    const handler = ctx.getHandler?.();
    return handler?.name;
  }
}
