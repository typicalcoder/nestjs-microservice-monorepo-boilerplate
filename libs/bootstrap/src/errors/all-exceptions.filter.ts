import { EnvType } from "@bootstrap/base-config";
import LixRpcException, { LixException } from "@bootstrap/errors/errors";
import { getLogger } from "@bootstrap/logger";
import { getAsyncStorage } from "@bootstrap/logger/asyncStorage";
import { isString } from "class-validator";
import { Observable, throwError } from "rxjs";

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { HttpArgumentsHost } from "@nestjs/common/interfaces";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly serviceName?: string) {}

  catch(exception: Error, host: ArgumentsHost): void | Observable<unknown> {
    if (host.getType() === "http") {
      return this.catchHttp(exception, host);
    }
    if (host.getType() === "rpc") {
      return this.catchRpc(exception, host);
    }
  }

  catchHttp(exception: Error, host: ArgumentsHost): void {
    const ctx: HttpArgumentsHost = host.switchToHttp();
    const asyncStorage = getAsyncStorage();
    let lixException: LixException;

    if (!exception) {
      exception = new LixException(
        "LixException",
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Nullable exception occurred",
      );
    }

    if (exception["error"]) {
      exception = exception["error"] as Error;
    }

    if (isString(exception)) {
      lixException = new LixException(
        "LixException",
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
      "__internal_type" in exception &&
      exception["__internal_type"] === "LixException"
    ) {
      lixException = exception as LixException;
    } else if (
      "__internal_type" in exception &&
      exception["__internal_type"] === "LixRpcException"
    ) {
      lixException = new LixException(
        exception.name,
        "status" in exception &&
          exception.status &&
          (exception.status as number),
        exception.message,
        exception["payload"],
      );
    } else if ("code" in exception || "message" in exception) {
      lixException = new LixException(
        exception.name ?? "Internal server error",
        ("code" in exception &&
          exception.code &&
          Object.values(HttpStatus).includes(exception.code as number) &&
          (exception.code as number)) ??
          HttpStatus.INTERNAL_SERVER_ERROR,
        exception.message ?? "Internal server error",
        exception,
      );
    }

    if (lixException === undefined) {
      lixException = new LixException(
        "InternalServerError",
        HttpStatus.INTERNAL_SERVER_ERROR,
        "Internal server error",
        exception,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    ctx
      .getResponse()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      .status(lixException.status)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      .send({
        error: { name: lixException.name, message: lixException.message },
        ...((process.env.NODE_ENV as EnvType) !== EnvType.PROD && {
          stack: lixException.stack,
          ...(lixException.originError
            ? { origin: lixException.originError as Error }
            : {}),
        }),
        traceId: lixException.traceId ?? asyncStorage?.traceId,
      });

    getLogger().error(lixException);
  }

  catchRpc(exception: Error, host: ArgumentsHost): Observable<any> {
    const rpc = host.switchToRpc();

    getLogger().error({
      payload: rpc.getData<unknown>(),
      stacktrace: exception?.stack,
      serviceName: this.serviceName,
      message: String(exception),
      exception,
    });

    let err = exception;

    if (!("__internal_type" in exception)) {
      err =
        "error" in exception
          ? LixRpcException.from(exception.error)
          : new LixRpcException(
              exception["name"] ?? "UnhandledError",
              HttpStatus.INTERNAL_SERVER_ERROR,
              exception["message"],
              exception,
              this.serviceName,
            );
    }

    return throwError(() => err);
  }
}
