import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { getTraceId } from '../context/async-storage';
import { ERROR_CODES } from '../dto/error-response.dto';
import { MicroserviceException } from '../exceptions/rpc.exception';
import { captureWithTrace } from '../bootstrap/telemetry';

/**
 * Catches all exceptions thrown inside RPC handlers and converts them
 * into serializable RpcErrorPayload envelopes. Gateway's filter reconstructs
 * these into proper HTTP responses.
 *
 * Register globally in each microservice via `app.useGlobalFilters(new RpcAllExceptionsFilter())`.
 */
@Catch()
export class RpcAllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(RpcAllExceptionsFilter.name);

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    const traceId = getTraceId();

    if (exception instanceof MicroserviceException) {
      // 5xx wrapped as MicroserviceException is still a server fault —
      // ship to Sentry. 4xx (validation / not-found / unauthorized /
      // conflict) is normal traffic and stays out of the issue list.
      if (Number(exception.status) >= 500) {
        captureWithTrace(exception);
      }
      return throwError(() => exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const { code, message, details } = this.normalizeHttpResponse(
        res,
        exception,
      );
      // Same rule for raw HttpException — 5xx goes to Sentry before we
      // wrap it into the RPC envelope.
      if (Number(status) >= 500) {
        captureWithTrace(exception, { status, code });
      }

      return throwError(
        () =>
          new MicroserviceException(
            status,
            code ?? this.statusToCode(status),
            message,
            details,
            traceId,
          ),
      );
    }

    if (exception instanceof RpcException) {
      // RpcException carries no HTTP status, so we can't filter by
      // severity — it's almost always a programming error inside the
      // microservice. Always capture.
      captureWithTrace(exception);
      return throwError(() => exception);
    }

    const err = exception as Error;
    this.logger.error(
      `Unhandled ${err?.name ?? 'Error'}: ${err?.message}`,
      err?.stack,
    );
    // Only 5xx-path exceptions land here; 4xx go through HttpException branch.
    captureWithTrace(err);

    return throwError(
      () =>
        new MicroserviceException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          ERROR_CODES.INTERNAL_ERROR,
          err?.message ?? 'Internal server error',
          undefined,
          traceId,
        ),
    );
  }

  private normalizeHttpResponse(
    res: string | object,
    exception: HttpException,
  ): { code?: string; message: string; details?: Record<string, unknown> } {
    if (typeof res === 'string') {
      return { message: res };
    }
    const body = res as Record<string, unknown>;
    return {
      code: body['code'] as string | undefined,
      message:
        (body['message'] as string | undefined) ?? exception.message ?? 'Error',
      details: body['details'] as Record<string, unknown> | undefined,
    };
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
