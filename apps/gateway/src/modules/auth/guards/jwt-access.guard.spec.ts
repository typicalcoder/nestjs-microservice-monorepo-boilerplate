import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@app/common';
import { JwtAccessGuard } from './jwt-access.guard';

/**
 * Pins the error-code contract of handleRequest. The client's auth flow
 * branches on it (docs/AUTH-FLOW.md): `token_expired` → silent /refresh,
 * `token_invalid` → wipe tokens and cold-start. Swapping the two forces
 * users into needless re-logins (or worse, into a refresh loop).
 */
describe('JwtAccessGuard.handleRequest', () => {
  const guard = new JwtAccessGuard({} as Reflector);

  function codeOf(fn: () => unknown): string {
    try {
      fn();
      throw new Error('expected handleRequest to throw');
    } catch (err) {
      return ((err as UnauthorizedException).getResponse() as { code: string })
        .code;
    }
  }

  it('returns the user untouched on success', () => {
    const user = { userId: 'u1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('maps an expired token (passport info=TokenExpiredError) to token_expired', () => {
    const info = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    expect(codeOf(() => guard.handleRequest(null, null, info))).toBe(
      ERROR_CODES.TOKEN_EXPIRED,
    );
  });

  it('maps any other failure (forged/malformed/missing) to token_invalid', () => {
    const info = Object.assign(new Error('invalid signature'), {
      name: 'JsonWebTokenError',
    });
    expect(codeOf(() => guard.handleRequest(null, null, info))).toBe(
      ERROR_CODES.TOKEN_INVALID,
    );
    expect(codeOf(() => guard.handleRequest(null, null))).toBe(
      ERROR_CODES.TOKEN_INVALID,
    );
    expect(codeOf(() => guard.handleRequest(new Error('boom'), null))).toBe(
      ERROR_CODES.TOKEN_INVALID,
    );
  });
});
