import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Tracker-key strategy:
 *
 * - `/auth/autoreg` → `fp:<deviceFingerprint>`. One attacker IP can spray
 *   many fake fingerprints, but one fingerprint can't mint many accounts —
 *   this blunts account-mint farms while still letting legitimate repeat
 *   callers from the same NAT through.
 *
 * - Authenticated routes (req.user.userId populated by JwtAccessGuard,
 *   which is registered ahead of this guard in AppModule.providers) →
 *   `<ip>:<userId>`. IP alone is unfair to users sharing a NAT/carrier
 *   gateway/dorm Wi-Fi — one chatty roommate would burn the bucket for
 *   everyone else on the same edge. Combining ip+userId gives every
 *   logged-in user their own counter while still requiring the IP to
 *   stay stable (cheap forgery protection).
 *
 * - Everything else (public, unauthenticated) → fall back to the default
 *   IP-based tracker. With `app.set('trust proxy', 1)` in main.ts, this
 *   resolves to the real client IP from X-Forwarded-For, not the ingress
 *   pod's overlay address.
 */
@Injectable()
export class FingerprintThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const body = req.body as { deviceFingerprint?: unknown } | undefined;
    if (
      req.path.endsWith('/auth/autoreg') &&
      typeof body?.deviceFingerprint === 'string' &&
      body.deviceFingerprint.length > 0
    ) {
      return `fp:${body.deviceFingerprint}`;
    }
    const user = (req as Request & { user?: { userId?: unknown } }).user;
    if (user && typeof user.userId === 'string' && user.userId.length > 0) {
      const ip = await super.getTracker(req);
      return `${ip}:u:${user.userId}`;
    }
    return super.getTracker(req);
  }
}
