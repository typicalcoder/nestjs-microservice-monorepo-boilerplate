import { isNotEmptyObject, isObject } from "class-validator";

import { HttpStatus } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";

import { getAsyncStorage } from "../logger/asyncStorage";

class LixRpcException extends RpcException {
  constructor(
    name: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    message?: string,
    payload?: unknown,
    serviceName?: string,
  ) {
    const data = isObject(payload) ? payload : undefined;
    super({
      message,
      name,
      __internal_type: "LixRpcException" as const,
      status,
      payload: isNotEmptyObject(data)
        ? ((data["error"] as unknown) ?? payload)
        : undefined,
      serviceName: serviceName ?? getAsyncStorage()?.serviceName,
    });
  }

  static from(e: unknown): LixRpcException {
    if (isObject(e) && "error" in e) {
      return LixRpcException.from(e["error"]);
    }
    return new LixRpcException(
      e["name"] as string,
      e["status"] as number,
      e["message"] ? (e["message"] as string) : undefined,
      e["payload"],
      e["serviceName"] ? (e["serviceName"] as string) : undefined,
    );
  }
}

export default LixRpcException;

export class LixException extends Error {
  __internal_type = "LixException" as const;
  name: string;
  message: string;
  status: number;
  traceId: string;
  originError?: unknown;

  constructor(
    name: string,
    status?: number,
    message?: string,
    e?: unknown,
    stack?: string,
  ) {
    super(name);

    if (!isObject(e)) {
      e = undefined;
    }

    const eMessage = e && e["message"] && (e["message"] as string),
      eStatus = e && e["status"] && (e["status"] as number),
      eBody = e && e["body"] && (e["body"] as unknown);

    this.name = name;
    this.message = message ?? eMessage;
    this.status = status ?? eStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.stack = stack ?? (e && e["stack"] && (e["stack"] as string));
    this.originError = e;
    this.traceId =
      getAsyncStorage()?.traceId ??
      (eBody &&
        isObject(eBody) &&
        eBody["traceId"] &&
        (eBody["traceId"] as string));

    Object.setPrototypeOf(this, LixException);
  }
}
