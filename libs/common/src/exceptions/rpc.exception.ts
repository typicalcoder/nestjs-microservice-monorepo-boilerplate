import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ERROR_CODES } from '../dto/error-response.dto';

/**
 * Serializable payload embedded in the RabbitMQ error envelope.
 * Gateway's RpcExceptionFilter reconstructs an HttpException from this shape.
 */
export interface RpcErrorPayload {
  __rpcError: true;
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId?: string;
}

/**
 * Throw this from microservices instead of NestJS HttpExceptions.
 * Preserves status code, error code, and details across the RMQ wire.
 *
 * Usage:
 *   throw new MicroserviceException(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'User not found');
 *   throw MicroserviceException.notFound('User not found');
 *   throw MicroserviceException.conflict('Email already registered', { code: 'EMAIL_EXISTS' });
 */
export class MicroserviceException extends RpcException {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly messageText: string,
    public readonly details?: Record<string, unknown>,
    public readonly traceId?: string,
  ) {
    const payload: RpcErrorPayload = {
      __rpcError: true,
      status,
      code,
      message: messageText,
      details,
      traceId,
    };
    super(payload);
  }

  static notFound(message = 'Not found', details?: Record<string, unknown>) {
    return new MicroserviceException(
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      message,
      details,
    );
  }

  static conflict(message = 'Conflict', details?: Record<string, unknown>) {
    return new MicroserviceException(
      HttpStatus.CONFLICT,
      ERROR_CODES.CONFLICT,
      message,
      details,
    );
  }

  static badRequest(
    message = 'Bad request',
    details?: Record<string, unknown>,
  ) {
    return new MicroserviceException(
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      message,
      details,
    );
  }
}

export function isRpcErrorPayload(value: unknown): value is RpcErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['__rpcError'] === true
  );
}
