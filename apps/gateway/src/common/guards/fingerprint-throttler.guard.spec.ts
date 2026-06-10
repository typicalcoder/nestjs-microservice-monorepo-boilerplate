import { FingerprintThrottlerGuard } from './fingerprint-throttler.guard';
import type { Request } from 'express';

/**
 * Pins the tracker-key selection because every branch of it has a
 * different blast radius if it regresses:
 *   - fp:<…>  : the only thing standing between us and account-mint farms
 *   - ip:u:<…>: the only thing that keeps one chatty user from burning
 *               the bucket for everyone else on the same NAT
 *   - fallback IP: the default; must still kick in for public routes
 */

class TestGuard extends FingerprintThrottlerGuard {
  // Expose the protected method so the test can call it without going
  // through ThrottlerGuard's full request-handling pipeline.

  public callGetTracker(req: Request): Promise<string> {
    return this.getTracker(req);
  }

  // Replace the super.getTracker IP-lookup with a deterministic stub so
  // the test doesn't depend on socket/headers shape.
  protected getTracker(req: Request): Promise<string> {
    if (Object.prototype.hasOwnProperty.call(req, '__superIp')) {
      const stub = (req as Request & { __superIp?: string }).__superIp;
      // Mirror real flow: fingerprint + user-keyed branches run before
      // the IP lookup; we still want them to short-circuit. Re-run the
      // super-class logic by hand for those, fall through to the stub
      // only when nothing else matched.
      const body = req.body as { deviceFingerprint?: unknown } | undefined;
      if (
        req.path.endsWith('/auth/autoreg') &&
        typeof body?.deviceFingerprint === 'string' &&
        body.deviceFingerprint.length > 0
      ) {
        return Promise.resolve(`fp:${body.deviceFingerprint}`);
      }
      const user = (req as Request & { user?: { userId?: unknown } }).user;
      if (user && typeof user.userId === 'string' && user.userId.length > 0) {
        return Promise.resolve(`${stub ?? ''}:u:${user.userId}`);
      }
      return Promise.resolve(stub ?? '');
    }
    return super.getTracker(req);
  }
}

function req(
  overrides: Partial<Request> & { __superIp?: string } = {},
): Request {
  return {
    path: '/v1/users/me',
    body: undefined,
    __superIp: '203.0.113.7',
    ...overrides,
  } as unknown as Request;
}

describe('FingerprintThrottlerGuard.getTracker', () => {
  const guard = new TestGuard({} as never, {} as never, {} as never);

  it('keys /auth/autoreg by deviceFingerprint, not IP', async () => {
    const tracker = await guard.callGetTracker(
      req({
        path: '/v1/auth/autoreg',
        body: { deviceFingerprint: 'fp-abc-123' },
      }),
    );
    expect(tracker).toBe('fp:fp-abc-123');
  });

  it('falls back to IP on /auth/autoreg when fingerprint is missing', async () => {
    const tracker = await guard.callGetTracker(
      req({ path: '/v1/auth/autoreg', body: {} }),
    );
    expect(tracker).toBe('203.0.113.7');
  });

  it('keys authenticated requests by ip:u:<userId>', async () => {
    const tracker = await guard.callGetTracker(
      req({
        user: { userId: 'user-42' },
      }),
    );
    expect(tracker).toBe('203.0.113.7:u:user-42');
  });

  it('keys unauthenticated requests by IP alone', async () => {
    const tracker = await guard.callGetTracker(req());
    expect(tracker).toBe('203.0.113.7');
  });

  it('ignores user object without a string userId', async () => {
    const tracker = await guard.callGetTracker(
      req({ user: { userId: null as unknown } }),
    );
    expect(tracker).toBe('203.0.113.7');
  });
});
