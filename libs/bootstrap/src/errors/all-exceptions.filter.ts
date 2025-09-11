import { isString } from 'class-validator';
import { Observable, throwError } from 'rxjs';
import { EnvType } from '@bootstrap/base-config';
import { LixException, LixRpcException } from '@bootstrap/errors/errors';
import { getLogger } from '@bootstrap/logger';
import { getAsyncStorage } from '@bootstrap/logger/asyncStorage';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly serviceName?: string) {}

  catch(exception: any, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      return this.catchHttp(exception, host);
    }
    if (host.getType() === 'rpc') {
      return this.catchRpc(exception, host);
    }
  }

  catchHttp(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const asyncStorage = getAsyncStorage();
    let lixException: LixException;

    if (!exception) {
      exception = new LixException(
        'LixException',
        HttpStatus.INTERNAL_SERVER_ERROR,
        `Nullable exception occurred`,
      );
    }

    if (exception['error']) {
      exception = exception['error'];
    }

    if (isString(exception)) {
      lixException = new LixException(
        'LixException',
        HttpStatus.INTERNAL_SERVER_ERROR,
        `${exception}`,
      );
    } else if (exception instanceof HttpException) {
      lixException = new LixException(
        exception.name,
        exception.getStatus(),
        exception.message,
        exception?.cause || exception.getResponse(),
        exception?.stack,
      );
    } else if (
      '__internal_type' in exception &&
      exception['__internal_type'] === 'LixException'
    ) {
      lixException = exception as LixException;
    } else if (
      '__internal_type' in exception &&
      exception['__internal_type'] === 'LixRpcException'
    ) {
      lixException = new LixException(
        exception.name,
        exception['status'],
        exception.message,
        exception['payload'],
      );
    } else if ('code' in exception || 'message' in exception) {
      lixException = new LixException(
        exception.name ?? 'Internal server error',
        (exception['code'] &&
          Object.values(HttpStatus).includes(exception['code']) &&
          exception['code']) ||
          HttpStatus.INTERNAL_SERVER_ERROR,
        exception.message ?? 'Internal server error',
        exception,
      );
    }

    if (lixException === undefined) {
      lixException = new LixException(
        'InternalServerError',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Internal server error',
        exception,
      );
    }

    ctx
      .getResponse()
      .status(lixException.status)
      .send({
        error: { name: lixException.name, message: lixException.message },
        ...(process.env.NODE_ENV !== EnvType.PROD && {
          stack: lixException.stack,
          ...(lixException.originError
            ? { origin: lixException.originError }
            : {}),
        }),
        traceId: lixException.traceId ?? asyncStorage?.traceId,
      });

    getLogger().error(lixException);
  }

  catchRpc(exception: any, host: ArgumentsHost): Observable<any> {
    const rpc = host.switchToRpc();

    getLogger().error({
      payload: rpc.getData(),
      stacktrace: (exception as Error)?.stack,
      serviceName: this.serviceName,
      message: String(exception),
      exception,
    });

    let err = exception;

    if (!('__internal_type' in exception)) {
      err =
        'error' in exception
          ? LixRpcException.from(exception.error)
          : new LixRpcException(
              exception['name'] ?? 'UnhandledError',
              HttpStatus.INTERNAL_SERVER_ERROR,
              exception['message'],
              exception,
              this.serviceName,
            );
    }

    return throwError(() => err);
  }
}
