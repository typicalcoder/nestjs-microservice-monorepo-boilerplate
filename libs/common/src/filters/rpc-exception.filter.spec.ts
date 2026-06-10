import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { firstValueFrom, type Observable } from 'rxjs';
import { ERROR_CODES } from '../dto/error-response.dto';
import {
  isRpcErrorPayload,
  MicroserviceException,
} from '../exceptions/rpc.exception';
import { RpcAllExceptionsFilter } from './rpc-exception.filter';

/**
 * RpcAllExceptionsFilter sits between worker services and the message
 * bus. It depends on three external contracts that change between
 * library majors:
 *   1. @nestjs/common — `HttpException.getStatus()/getResponse()` shape
 *      and the concrete subclasses (BadRequest/NotFound/...) we map.
 *   2. @nestjs/microservices — `RpcException` is the marker the bus
 *      will pass through unchanged; everything else gets wrapped.
 *   3. rxjs — `throwError(() => err)` is what `catch()` returns; if the
 *      observable contract changed (sync vs async, error envelope), the
 *      worker would silently 500 every request.
 *
 * Each test pins one of those contracts.
 */

async function awaitErr(obs: Observable<never>): Promise<unknown> {
  try {
    await firstValueFrom(obs);
    throw new Error('observable resolved without error — unexpected');
  } catch (err) {
    return err;
  }
}

describe('RpcAllExceptionsFilter (dep-bump guard)', () => {
  const filter = new RpcAllExceptionsFilter();
  const host = {} as never;

  it('passes a MicroserviceException through unchanged', async () => {
    const original = MicroserviceException.notFound('User not found');
    const out = await awaitErr(filter.catch(original, host));
    expect(out).toBe(original);
  });

  it('wraps an HttpException into a MicroserviceException with status+code+message', async () => {
    const out = (await awaitErr(
      filter.catch(new BadRequestException('bad input'), host),
    )) as MicroserviceException;

    expect(out).toBeInstanceOf(MicroserviceException);
    expect(out.status).toBe(HttpStatus.BAD_REQUEST);
    expect(out.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(out.messageText).toBe('bad input');
  });

  it('preserves custom code+details from a structured HttpException response', async () => {
    const out = (await awaitErr(
      filter.catch(
        new ConflictException({
          code: 'EMAIL_EXISTS',
          message: 'Email already registered',
          details: { hint: 'login instead' },
        }),
        host,
      ),
    )) as MicroserviceException;

    expect(out.status).toBe(409);
    expect(out.code).toBe('EMAIL_EXISTS');
    expect(out.messageText).toBe('Email already registered');
    expect(out.details).toEqual({ hint: 'login instead' });
  });

  it('maps NotFoundException → 404/NOT_FOUND', async () => {
    const out = (await awaitErr(
      filter.catch(new NotFoundException('gone'), host),
    )) as MicroserviceException;
    expect(out.status).toBe(404);
    expect(out.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('maps UnauthorizedException → 401/UNAUTHORIZED', async () => {
    const out = (await awaitErr(
      filter.catch(new UnauthorizedException(), host),
    )) as MicroserviceException;
    expect(out.status).toBe(401);
    expect(out.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('maps ForbiddenException → 403/FORBIDDEN (project convention)', async () => {
    const out = (await awaitErr(
      filter.catch(new ForbiddenException(), host),
    )) as MicroserviceException;
    expect(out.status).toBe(403);
    expect(out.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('an unhandled Error becomes a 500 INTERNAL_ERROR', async () => {
    const out = (await awaitErr(
      filter.catch(new Error('boom'), host),
    )) as MicroserviceException;
    expect(out.status).toBe(500);
    expect(out.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(out.messageText).toBe('boom');
  });

  it('the wrapped error serialises as an RpcErrorPayload (so it survives RMQ)', async () => {
    const out = (await awaitErr(
      filter.catch(new BadRequestException('bad'), host),
    )) as MicroserviceException;
    // RpcException.getError() is what the transport actually transmits.
    const payload = out.getError();
    expect(isRpcErrorPayload(payload)).toBe(true);
  });

  it('a string-bodied HttpException uses the string as message', async () => {
    // HttpException(string, status) — older style still in some controllers.
    const out = (await awaitErr(
      filter.catch(new HttpException('legacy text', 418), host),
    )) as MicroserviceException;
    expect(out.status).toBe(418);
    expect(out.messageText).toBe('legacy text');
    // 418 isn't in our statusToCode table → falls back to INTERNAL_ERROR.
    expect(out.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });
});
