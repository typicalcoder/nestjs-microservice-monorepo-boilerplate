import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * Per-request HTTP access log. Mirrors the RPC interceptor pattern:
 *   ← METHOD /path
 *   → METHOD /path STATUS (Xms)
 *
 * Runs inside the AsyncLocalStorage scope set up by `RequestIdInterceptor`,
 * so the winston formatter automatically appends the same `traceId` to both
 * the entry and exit lines — making it trivial to grep a full request flow
 * (gateway in/out plus all RPC hops downstream) by traceId.
 *
 * Health probes and Swagger UI are filtered out to keep the log volume sane.
 */
@Injectable()
export class HttpLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  private static readonly SKIP_PREFIXES = ['/health', '/docs', '/favicon'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.originalUrl ?? req.url ?? '';

    if (HttpLogInterceptor.SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      return next.handle();
    }

    const method = req.method;
    // Real client IP — relies on `app.set('trust proxy', 1)` in main.ts so
    // req.ip resolves to the X-Forwarded-For client, not the ingress pod's
    // overlay address. Without trust-proxy this prints the same 10.x.x.x
    // for everyone and the field is useless.
    const ip = req.ip ?? req.socket?.remoteAddress ?? '?';
    const start = Date.now();
    this.logger.log(`← ${method} ${path} ip=${ip}`);

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `→ ${method} ${path} ${res.statusCode} ip=${ip} (${Date.now() - start}ms)`,
          );
        },
        error: (err: unknown) => {
          const status =
            err instanceof HttpException ? err.getStatus() : res.statusCode;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `→ ${method} ${path} ${status} ip=${ip} err: ${message} (${Date.now() - start}ms)`,
          );
        },
      }),
    );
  }
}
