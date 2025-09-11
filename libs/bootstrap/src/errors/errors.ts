import { isNotEmptyObject, isObject } from 'class-validator';

import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import { getAsyncStorage } from '../logger/asyncStorage';

export class LixRpcException extends RpcException {
  constructor(
    name: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    message?: string,
    payload?: any,
    serviceName?: string,
  ) {
    const data = isObject(payload)
      ? payload
      : payload
        ? { ...payload }
        : undefined;
    super({
      message,
      name,
      __internal_type: 'LixRpcException' as const,
      status,
      payload: isNotEmptyObject(data) ? (data['error'] ?? payload) : undefined,
      serviceName: serviceName ?? getAsyncStorage()?.serviceName,
    });
  }

  static from(e: any): LixRpcException {
    if ('error' in e) {
      return LixRpcException.from(e['error']);
    }
    return new LixRpcException(
      e['name'],
      e['status'],
      e['message'],
      e['payload'],
      e['serviceName'],
    );
  }
}

export class LixException extends Error {
  __internal_type = 'LixException' as const;
  name: string;
  message: string;
  status: number;
  traceId: string;
  originError?: any;
  [key: string]: unknown;

  constructor(
    name: string,
    status?: number,
    message?: string,
    e?: any,
    stack?: string,
  ) {
    super(name);

    const eMessage = e?.message,
      eStatus = e?.status,
      eBody = e?.body;

    this.name = name;
    this.message = message ?? eMessage;
    this.status = status ?? eStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.stack = stack ?? e?.stack;
    this.originError = e;
    this.traceId = getAsyncStorage()?.traceId ?? eBody?.traceId;

    Object.setPrototypeOf(this, LixException);
  }
}
