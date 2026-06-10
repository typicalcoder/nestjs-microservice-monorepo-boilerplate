import { AccountType } from '../enums';

export interface JwtPayload {
  sub: string; // userId (MongoDB ObjectId as string)
  type: AccountType;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload extends JwtPayload {
  jti: string; // token id for revocation
  // bind the refresh token to the device that issued it. The
  // /refresh endpoint requires the same value via the X-Device-Id header
  // — a stolen refresh JWT used from another device fails the match.
  // Older tokens lack this field; they're rejected, forcing a
  // re-login (intentional one-shot invalidation at rollout).
  deviceId: string;
  // User.tokenVersion at the moment of issue. /auth/refresh
  // compares it to the current value and rejects mismatches — so a
  // password reset / account upgrade / account delete invalidates every
  // refresh token outstanding for that user. Optional in the type for
  // backward-compat with older tokens still in the wild; the
  // refresh handler treats `undefined` as `0` (initial value).
  tv?: number;
}

export interface JwtDevicePayload {
  sub: string; // userId
  deviceId: string;
  type: 'device';
  iat?: number;
}
