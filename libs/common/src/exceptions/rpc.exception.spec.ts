import { HttpStatus } from '@nestjs/common';
import { MicroserviceException, isRpcErrorPayload } from './rpc.exception';

describe('MicroserviceException', () => {
  it('serializes a tagged RPC error payload', () => {
    const ex = new MicroserviceException(
      HttpStatus.NOT_FOUND,
      'not_found',
      'User not found',
      { userId: '1' },
    );
    const payload = ex.getError();
    expect(isRpcErrorPayload(payload)).toBe(true);
    expect(payload).toMatchObject({
      __rpcError: true,
      status: 404,
      code: 'not_found',
      message: 'User not found',
      details: { userId: '1' },
    });
  });

  it('exposes typed factory helpers', () => {
    expect(MicroserviceException.notFound().status).toBe(HttpStatus.NOT_FOUND);
    expect(MicroserviceException.conflict().status).toBe(HttpStatus.CONFLICT);
    expect(MicroserviceException.badRequest().status).toBe(
      HttpStatus.BAD_REQUEST,
    );
  });
});

describe('isRpcErrorPayload', () => {
  it('is false for arbitrary objects', () => {
    expect(isRpcErrorPayload({ foo: 1 })).toBe(false);
    expect(isRpcErrorPayload(null)).toBe(false);
    expect(isRpcErrorPayload('nope')).toBe(false);
  });
});
