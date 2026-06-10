import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import {
  AccountType,
  ERROR_CODES,
  Platform,
  type RpcClientService,
} from '@app/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { TokenStoreService } from './services/token-store.service';

/**
 * These tests exercise AuthService's orchestration logic in isolation. The
 * surrounding Nest infra (ConfigService, JwtService, TokenStoreService, the
 * RPC client) is stubbed — the goal is to catch regressions in the wiring:
 * what gets passed to RPC, what shape is returned, how refresh rotation and
 * the tokenVersion gate behave.
 */

function makeDeps() {
  const rpcCalls: { pattern: string; payload: unknown }[] = [];
  const rpcResponses = new Map<string, unknown>();
  const rpc = {
    user: jest.fn((pattern: string, payload: unknown) => {
      rpcCalls.push({ pattern, payload });
      if (!rpcResponses.has(pattern)) {
        return Promise.reject(new Error(`unexpected RPC: ${pattern}`));
      }
      return Promise.resolve(rpcResponses.get(pattern));
    }),
  } as unknown as RpcClientService;

  const tokenCalls: { jti: string; exp: number }[] = [];
  const blacklistRefreshToken = jest.fn((jti: string, exp: number) => {
    tokenCalls.push({ jti, exp });
    return Promise.resolve();
  });
  const tokenStore = {
    blacklistRefreshToken,
    isBlacklisted: jest.fn(() => Promise.resolve(false)),
  } as unknown as TokenStoreService;

  const signedTokens: string[] = [];
  const signCalls: { payload: unknown; opts?: unknown }[] = [];
  const jwt = {
    sign: jest.fn((payload: unknown, opts?: unknown) => {
      signCalls.push({ payload, opts });
      const t = `jwt.${signedTokens.length}`;
      signedTokens.push(t);
      return t;
    }),
    verify: jest.fn(() => ({ jti: 'refresh-jti', exp: 9_999_999_999 })),
  } as unknown as JwtService;

  const configMap = new Map<string, string>([
    ['JWT_ACCESS_SECRET', 'access-secret'],
    ['JWT_REFRESH_SECRET', 'refresh-secret'],
    ['JWT_ACCESS_EXPIRES_IN', '15m'],
    ['JWT_REFRESH_EXPIRES_IN', '30d'],
  ]);
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const v = configMap.get(key);
      if (!v) throw new Error(`missing ${key}`);
      return v;
    }),
    get: jest.fn((key: string) => configMap.get(key)),
  } as unknown as ConfigService;

  return {
    rpc,
    jwt,
    config,
    tokenStore,
    blacklistRefreshToken,
    rpcCalls,
    rpcResponses,
    signCalls,
    signedTokens,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>): AuthService {
  return new AuthService(deps.rpc, deps.jwt, deps.config, deps.tokenStore, {
    for: jest.fn(),
  } as never);
}

describe('AuthService', () => {
  describe('autoreg', () => {
    it('issues access+refresh tokens and tags accountType=autoreg', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('create_autoreg_user', {
        id: 'u1',
        deviceRecordId: 'mongo-device-1',
        tokenVersion: 0,
      });
      const svc = makeService(deps);

      const result = await svc.autoreg(
        { deviceFingerprint: 'fp1' },
        'client-device-1',
      );

      expect(result.userId).toBe('u1');
      expect(result.accountType).toBe('autoreg');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      // 2 sign() calls: access, refresh
      expect(deps.signedTokens).toHaveLength(2);
      expect(deps.signCalls[1].payload).toMatchObject({
        sub: 'u1',
        type: 'autoreg',
        deviceId: 'client-device-1',
        tv: 0,
      });
    });

    it('forwards fingerprint + platform to user-service and ignores internal device row id for JWT binding', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('create_autoreg_user', {
        id: 'u1',
        deviceRecordId: 'mongo-device-1',
        tokenVersion: 0,
      });
      const svc = makeService(deps);
      await svc.autoreg(
        {
          deviceFingerprint: 'fp1',
          platform: Platform.ios,
        },
        'client-device-1',
      );

      expect(deps.rpcCalls[0].payload).toEqual({
        fingerprint: 'fp1',
        platform: Platform.ios,
        ipHash: undefined,
      });
      expect(deps.signCalls[1].payload).toMatchObject({
        deviceId: 'client-device-1',
      });
    });

    it('hashes the client IP before it crosses the message bus', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('create_autoreg_user', {
        id: 'u1',
        deviceRecordId: 'mongo-device-1',
        tokenVersion: 0,
      });
      const svc = makeService(deps);
      await svc.autoreg({ deviceFingerprint: 'fp1' }, 'd1', '203.0.113.7');

      const payload = deps.rpcCalls[0].payload as { ipHash?: string };
      const expected = createHash('sha256').update('203.0.113.7').digest('hex');
      expect(payload.ipHash).toBe(expected);
      // The raw IP must never appear in the RPC payload.
      expect(JSON.stringify(payload)).not.toContain('203.0.113.7');
    });
  });

  describe('login', () => {
    it('returns accountType from the RPC, not hardcoded', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('login_user', {
        id: 'u2',
        accountType: 'user',
        tokenVersion: 0,
      });
      const svc = makeService(deps);

      const result = await svc.login({ email: 'a@b.c', password: 'p' }, 'd2');
      expect(result.accountType).toBe('user');
      expect(result.userId).toBe('u2');
    });
  });

  describe('refresh rotation', () => {
    it('blacklists the old refresh token before issuing a new pair', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('get_user_token_version', { tokenVersion: 0 });
      const svc = makeService(deps);

      const pair = await svc.refresh(
        'u3',
        'old-jti',
        1_700_000_000,
        'd3',
        AccountType.user,
        0,
      );

      expect(deps.blacklistRefreshToken).toHaveBeenCalledWith(
        'old-jti',
        1_700_000_000,
      );
      expect(pair.accessToken).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
    });

    it('rejects when presented tv is below the user current tokenVersion', async () => {
      const deps = makeDeps();
      // Server side bumped to 1 (e.g. after password reset).
      deps.rpcResponses.set('get_user_token_version', { tokenVersion: 1 });
      const svc = makeService(deps);

      await expect(
        svc.refresh(
          'u3',
          'old-jti',
          1_700_000_000,
          'd3',
          AccountType.user,
          0, // Pre-reset token still claims tv=0.
        ),
      ).rejects.toMatchObject({
        response: { code: ERROR_CODES.TOKEN_INVALID },
      });
      // Old token NOT blacklisted because we never accepted it as
      // valid — saves a Redis write on every revoked-attacker poke.
      expect(deps.blacklistRefreshToken).not.toHaveBeenCalled();
    });

    it('maps a NotFound from user-service to 401 token_invalid (deleted/unknown user)', async () => {
      const deps = makeDeps();
      const notFound = new HttpException(
        { statusCode: 404, code: 'NOT_FOUND', message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
      (deps.rpc.user as jest.Mock).mockRejectedValue(notFound);
      const svc = makeService(deps);

      await expect(
        svc.refresh(
          'ghost-user',
          'old-jti',
          1_700_000_000,
          'd1',
          AccountType.user,
          0,
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: ERROR_CODES.TOKEN_INVALID },
      });
      // No blacklist write — we never accepted the token as legitimate.
      expect(deps.blacklistRefreshToken).not.toHaveBeenCalled();
    });

    it('treats a legacy refresh with no tv claim as tv=0', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('get_user_token_version', { tokenVersion: 0 });
      const svc = makeService(deps);

      const pair = await svc.refresh(
        'u3',
        'old-jti',
        1_700_000_000,
        'd3',
        AccountType.user,
        undefined, // legacy token: no tv claim
      );

      expect(pair.accessToken).toBeTruthy();
      expect(deps.blacklistRefreshToken).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('returns success:true even when token is invalid/expired', async () => {
      const deps = makeDeps();
      (deps.jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('expired');
      });
      const svc = makeService(deps);

      const result = await svc.logout('bogus-token');
      expect(result).toEqual({ success: true });
      expect(deps.blacklistRefreshToken).not.toHaveBeenCalled();
    });

    it('blacklists on valid token', async () => {
      const deps = makeDeps();
      const svc = makeService(deps);

      await svc.logout('valid-refresh-token');

      expect(deps.blacklistRefreshToken).toHaveBeenCalledWith(
        'refresh-jti',
        9_999_999_999,
      );
    });
  });

  describe('forgotPassword', () => {
    it('always returns success regardless of email existence', async () => {
      const deps = makeDeps();
      deps.rpcResponses.set('forgot_password', { success: true });
      const svc = makeService(deps);

      const result = await svc.forgotPassword({ email: 'nobody@example.com' });
      expect(result).toEqual({ success: true });
    });
  });
});
