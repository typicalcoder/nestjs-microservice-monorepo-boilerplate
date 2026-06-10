import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@app/common';
import {
  ERROR_CODES,
  captureWithTrace,
  getTraceId,
  isRpcErrorPayload,
} from '@app/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestId = request.requestId ?? getTraceId() ?? 'unknown';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> | undefined;

    const rpcPayload = this.extractRpcPayload(exception);
    if (rpcPayload) {
      statusCode = rpcPayload.status;
      code = rpcPayload.code;
      message = rpcPayload.message;
      details = rpcPayload.details;
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message = (body['message'] as string) ?? exception.message ?? message;
        code = (body['code'] as string) ?? this.statusToCode(statusCode);
        details = body['details'] as Record<string, unknown> | undefined;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      const inProd = process.env['NODE_ENV'] === 'production';
      if (inProd) {
        this.logger.error(
          `${exception.name}: ${exception.message} [${requestId} ${request.url}]`,
        );
      } else {
        this.logger.error(
          `${exception.name}: ${exception.message}`,
          exception.stack,
          { requestId, path: request.url },
        );
      }
      // Forward unhandled exceptions to Sentry for triage. 4xx HttpExceptions
      // above don't go through this branch — only true server-side faults.
      captureWithTrace(exception, { path: request.url, requestId });
    }

    // Server-side faults (5xx) that came through HttpException or an RPC
    // error envelope still belong in Sentry — they're never user error.
    // 4xx are intentionally excluded (validation, auth, not-found etc.
    // are normal traffic and would drown the issue list).
    if (Number(statusCode) >= 500) {
      captureWithTrace(exception, {
        path: request.url,
        requestId,
        statusCode,
        code,
      });
    }

    response.status(statusCode).json({
      statusCode,
      code,
      message,
      ...(details ? { details } : {}),
      requestId,
    });
  }

  private extractRpcPayload(exception: unknown) {
    if (isRpcErrorPayload(exception)) return exception;
    const maybe = exception as { error?: unknown } | null;
    if (maybe && isRpcErrorPayload(maybe.error)) return maybe.error;
    return null;
  }

  private statusToCode(status: number): string {
    switch (status) {
      case 400:
        return ERROR_CODES.VALIDATION_ERROR;
      case 401:
        return ERROR_CODES.UNAUTHORIZED;
      case 403:
        return ERROR_CODES.FORBIDDEN;
      case 404:
        return ERROR_CODES.NOT_FOUND;
      case 409:
        return ERROR_CODES.CONFLICT;
      case 429:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return ERROR_CODES.INTERNAL_ERROR;
    }
  }
}
