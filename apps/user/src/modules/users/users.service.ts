import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EntityManager, FilterQuery, ObjectId } from '@mikro-orm/mongodb';
import { Device, OAuthLink, User } from '@app/database';
import {
  AccountType,
  ERROR_CODES,
  Locale,
  MicroserviceException,
  OAuthProvider,
  UserDto,
  captureWithTrace,
  isDuplicateKeyError,
} from '@app/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { EmailService } from '../email/email.service';

interface AutoregPayload {
  fingerprint: string;
  platform?: 'android' | 'ios';
  ipHash?: string;
}

interface OAuthPayload {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string | null;
  /**
   * True iff the provider asserted the user controls `email`. Only verified
   * emails are eligible for cross-account auto-merge; an unverified email may
   * seed a new account's profile but never reattaches to an existing one.
   */
  emailVerified?: boolean;
  name?: string | null;
}

interface UpgradePayload {
  method: 'email' | 'google' | 'apple' | 'vk' | 'yandex';
  email?: string;
  password?: string;
  name?: string;
  providerUserId?: string;
}

export interface UpdateUserInput {
  name?: string | null;
  tz?: string;
  locale?: Locale;
  avatarUrl?: string | null;
  onboardingCompleted?: boolean;
}

/**
 * Real argon2id hash of an unguessable random string. Used by `login` to keep
 * verify-time identical between "no such user" and "wrong password" branches
 * — verifying against this always returns false but takes the same ~50–200 ms
 * as a real hash, so wall-clock time can't be used to enumerate valid emails.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$B1s61iTQ08nOuxDcmd0vuA$rmWDDrZq9l6brSGdOr5p34voo0slFj31ajurPq49ETI';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly email: EmailService,
  ) {}

  private hashResetToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private throwEmailTaken(): never {
    throw new MicroserviceException(
      HttpStatus.CONFLICT,
      'EMAIL_EXISTS',
      'Email already registered',
    );
  }

  /**
   * Create or return the autoreg user for this device fingerprint. The
   * fingerprint stays a recovery anchor only while the account is anonymous:
   * the moment a user attaches a real identity via /auth/upgrade, the Device
   * rows are wiped (see `upgradeAccount`), so the fingerprint stops resolving
   * to it. Defensive double-check here: a Device row pointing at a non-autoreg
   * user is treated as orphaned — dropped, and a fresh autoreg created.
   *
   * The fingerprint MUST NOT appear in any HTTP response — it's a client-only
   * secret. Keep AuthResponseDto / AutoregDto free of it.
   */
  async createAutoregUser(
    payload: AutoregPayload,
  ): Promise<{ id: string; deviceRecordId: string; tokenVersion: number }> {
    const existing = await this.em.findOne(Device, {
      fingerprint: payload.fingerprint,
    });

    if (existing) {
      if (existing.isBlocked) {
        throw new MicroserviceException(
          403,
          'device_blocked',
          'This device is blocked',
          { reason: existing.blockedReason ?? 'policy_violation' },
        );
      }
      const linkedUser = await this.em.findOne(User, { _id: existing.userId });
      if (!linkedUser || linkedUser.accountType !== AccountType.autoreg) {
        // Stale Device row — its user is gone or has been upgraded. Wipe it and
        // fall through to create a fresh autoreg; returning the upgraded user's
        // id here would be the actual hole.
        await this.em.nativeDelete(Device, { _id: existing._id });
        this.em.clear();
      } else {
        existing.lastSeenAt = new Date();
        if (payload.ipHash) existing.lastIpHash = payload.ipHash;
        await this.em.flush();
        return {
          id: existing.userId.toHexString(),
          deviceRecordId: existing._id.toHexString(),
          tokenVersion: linkedUser.tokenVersion ?? 0,
        };
      }
    }

    // Generate ObjectIds up front — the MongoDriver only assigns the primary
    // key at flush time, so we can't reference `user._id` when building the
    // Device that links to it.
    const userId = new ObjectId();
    const deviceId = new ObjectId();
    const user = this.em.create(User, {
      _id: userId,
      accountType: AccountType.autoreg,
    } as unknown as User);
    const device = this.em.create(Device, {
      _id: deviceId,
      fingerprint: payload.fingerprint,
      platform: payload.platform ?? 'android',
      userId,
      lastIpHash: payload.ipHash,
    } as unknown as Device);

    this.em.persist(user);
    this.em.persist(device);
    await this.em.flush();
    return {
      id: userId.toHexString(),
      deviceRecordId: deviceId.toHexString(),
      tokenVersion: 0,
    };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ id: string; accountType: string; tokenVersion: number }> {
    // Filter `deletedAt: null` so a soft-deleted account can't be reanimated
    // by a stale email row. `deleteUser` clears the email as a redundant
    // guard; this filter is the load-bearing one.
    const user = await this.em.findOne(User, { email, deletedAt: null });
    // Run argon2 on both branches so wall-clock time of `/login` does not
    // distinguish "no such email" from "email exists, wrong password".
    const passwordHash = user?.passwordHash ?? DUMMY_ARGON2_HASH;
    let valid = false;
    try {
      valid = await argon2.verify(passwordHash, password);
    } catch (err) {
      // A malformed stored hash would otherwise throw → 500. Treat any verify
      // exception as a failed auth; log once for operator follow-up.
      this.logger.warn(
        `argon2.verify threw for email=${email} userId=${user?.id ?? 'none'}: ${(err as Error).message}`,
      );
    }
    if (!user?.passwordHash || !valid) {
      throw new MicroserviceException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_INVALID,
        'Invalid credentials',
      );
    }
    return {
      id: user.id,
      accountType: user.accountType,
      tokenVersion: user.tokenVersion ?? 0,
    };
  }

  async upgradeAccount(userId: string, payload: UpgradePayload): Promise<User> {
    const user = await this.findById(userId);

    if (user.accountType !== AccountType.autoreg) {
      throw MicroserviceException.conflict('Account already upgraded');
    }

    if (payload.method === 'email') {
      if (!payload.email || !payload.password) {
        throw MicroserviceException.badRequest('Email and password required');
      }
      // Fast-path JS check — saves a wasted argon2 hash on the obvious
      // collision. The load-bearing gate is the unique index on User.email:
      // two parallel upgrade calls can both pass this `findOne` and only one
      // survives `em.flush()`; the other gets E11000, translated to 409 below.
      const existing = await this.em.findOne(User, { email: payload.email });
      if (existing && existing.id !== userId) {
        this.throwEmailTaken();
      }
      user.email = payload.email;
      user.passwordHash = await argon2.hash(payload.password);
    } else {
      const provider = payload.method;
      if (!payload.providerUserId) {
        throw MicroserviceException.badRequest(
          'providerUserId required for OAuth upgrade',
        );
      }
      // Guard against attaching an OAuth identity already bound to another
      // account — that would force a lossy merge. 409 so the client can route
      // to a dedicated "account recovery" flow instead.
      const clash = await this.em.findOne(User, {
        oauthLinks: {
          $elemMatch: { provider, providerUserId: payload.providerUserId },
        },
      } as FilterQuery<User>);
      if (clash && clash.id !== userId) {
        throw new MicroserviceException(
          HttpStatus.CONFLICT,
          'oauth_collision',
          'OAuth identity already linked to another account',
          { conflictingUserId: clash.id },
        );
      }
      user.email = payload.email ?? user.email;
      user.oauthLinks.push(
        Object.assign(new OAuthLink(), {
          provider,
          providerUserId: payload.providerUserId,
          email: payload.email,
          linkedAt: new Date(),
        }),
      );
    }

    if (payload.name) user.name = payload.name;
    user.accountType = AccountType.user;
    user.upgradedAt = new Date();
    // Bump tokenVersion so any refresh token issued before the upgrade is
    // rejected on the next /auth/refresh. The gateway then mints a fresh pair
    // carrying the new tv claim.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    try {
      await this.em.flush();
    } catch (err) {
      if (isDuplicateKeyError(err, 'email')) this.throwEmailTaken();
      throw err;
    }

    // Invalidate fingerprint-based recovery for this account. After upgrade the
    // user has a real login path — the anonymous fingerprint must stop being a
    // valid back door, so a future /auth/autoreg creates a fresh anon account.
    await this.em.nativeDelete(Device, { userId: user._id });

    return user;
  }

  async findOrCreateOAuthUser(
    payload: OAuthPayload,
  ): Promise<{ id: string; accountType: string; tokenVersion: number }> {
    // Every lookup filters `deletedAt: null` so a soft-deleted account can't
    // be re-entered through OAuth before the purge job runs.

    // 1. Find by exact OAuth link (same provider + providerUserId).
    const byProvider = await this.em.findOne(User, {
      oauthLinks: {
        $elemMatch: {
          provider: payload.provider,
          providerUserId: payload.providerUserId,
        },
      },
      deletedAt: null,
    });

    if (byProvider) {
      return {
        id: byProvider.id,
        accountType: byProvider.accountType,
        tokenVersion: byProvider.tokenVersion ?? 0,
      };
    }

    // 2. Find by email (merge: add OAuth link to existing account). Gated on
    // `emailVerified` — without it, a malicious account whose `email` claim
    // names the victim's address would be auto-merged into the victim's user.
    // Unverified emails fall through to step 3 (new account).
    if (payload.email && payload.emailVerified) {
      const byEmail = await this.em.findOne(User, {
        email: payload.email,
        deletedAt: null,
      });
      if (byEmail) {
        byEmail.oauthLinks.push(
          Object.assign(new OAuthLink(), {
            provider: payload.provider,
            providerUserId: payload.providerUserId,
            email: payload.email,
            linkedAt: new Date(),
          }),
        );
        await this.em.flush();
        return {
          id: byEmail.id,
          accountType: byEmail.accountType,
          tokenVersion: byEmail.tokenVersion ?? 0,
        };
      }
    }

    // 3. Create a new user.
    const user = this.em.create(User, {
      accountType: AccountType.user,
      email: payload.email ?? undefined,
      name: payload.name ?? undefined,
      oauthLinks: [
        Object.assign(new OAuthLink(), {
          provider: payload.provider,
          providerUserId: payload.providerUserId,
          email: payload.email ?? undefined,
          linkedAt: new Date(),
        }),
      ],
    } as unknown as User);

    try {
      await this.em.persist(user).flush();
    } catch (err) {
      // Another OAuth-create raced us on the same email; the other writer won.
      if (isDuplicateKeyError(err, 'email')) this.throwEmailTaken();
      throw err;
    }
    return {
      id: user.id,
      accountType: user.accountType,
      tokenVersion: user.tokenVersion ?? 0,
    };
  }

  async forgotPassword(email: string): Promise<{ success: true }> {
    // Skip soft-deleted accounts so a /forgot can't issue a reset token to a
    // corpse. Combined with `deleteUser` clearing the reset fields, deletion
    // stays final.
    const user = await this.em.findOne(User, { email, deletedAt: null });
    if (!user) return { success: true }; // Do not reveal whether email exists

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = this.hashResetToken(token);
    user.resetPasswordExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.em.flush();
    // Dispatch the plaintext token by email — never in the RPC reply or logs.
    // EmailService is a stub in dev (logs only) so the flow works end-to-end
    // without an SMTP dependency.
    try {
      await this.email.sendPasswordReset(email, token);
    } catch (err) {
      // Do-not-reveal: swallow dispatch errors; the user always gets 200.
      this.logger.warn(
        `password reset email dispatch failed for ${email}: ${(err as Error).message}`,
      );
      captureWithTrace(err, {
        tag: 'auth.password_reset.email_failed',
        emailDomain: email.split('@')[1] ?? 'unknown',
      });
    }
    return { success: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashResetToken(token);
    // Filter `deletedAt: null` so a /reset link issued before an account
    // deletion can't reanimate the soft-deleted record.
    const user = await this.em.findOne(User, {
      resetPasswordToken: tokenHash,
      deletedAt: null,
    });

    if (
      !user ||
      !user.resetPasswordExpiry ||
      user.resetPasswordExpiry < new Date()
    ) {
      throw new MicroserviceException(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_INVALID,
        'Invalid or expired reset token',
      );
    }

    user.passwordHash = await argon2.hash(newPassword);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    // Bump tokenVersion so every outstanding refresh token (including any a
    // stolen-session attacker holds) is rejected on next /auth/refresh.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.em.flush();
  }

  async findById(userId: string): Promise<User> {
    const user = await this.em.findOne(User, { _id: new ObjectId(userId) });
    if (!user) throw MicroserviceException.notFound('User not found');
    // Soft-delete: once deletedAt is set, treat as gone for ordinary reads.
    if (user.deletedAt) {
      throw MicroserviceException.notFound('User not found');
    }
    return user;
  }

  async updateUser(userId: string, data: UpdateUserInput): Promise<UserDto> {
    const user = await this.findById(userId);
    // Explicit allowlist: any User property not listed here is unreachable via
    // this endpoint. Sensitive fields (passwordHash, accountType, oauthLinks,
    // reset tokens, etc.) stay ignored.
    if (data.name !== undefined) user.name = data.name ?? undefined;
    if (data.tz !== undefined) user.tz = data.tz;
    if (data.locale !== undefined) user.locale = data.locale;
    if (data.avatarUrl !== undefined)
      user.avatarUrl = data.avatarUrl ?? undefined;
    if (data.onboardingCompleted !== undefined) {
      user.onboardingCompleted = data.onboardingCompleted;
    }
    await this.em.flush();
    return this.toDto(user);
  }

  async deleteUser(userId: string): Promise<void> {
    const user = await this.findById(userId);
    // Soft-delete: mark and leave for the purge task to hard-delete after the
    // grace window. Scrub PII-ish fields so a pending-purge record can't leak
    // email/name.
    user.deletedAt = new Date();
    user.email = undefined;
    user.passwordHash = undefined;
    // Void any pending reset-password flow so a /reset link mailed before the
    // delete can't write a fresh password into the soft-deleted record.
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    // Bump tokenVersion so every refresh token already in flight is invalidated.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.em.flush();
  }

  /** User DTO — the shape consumed by `GET /v1/users/me`. */
  toDto(user: User): UserDto {
    return {
      id: user.id,
      accountType: user.accountType,
      email: user.email ?? null,
      name: user.name ?? '',
      tz: user.tz,
      locale: user.locale,
      avatarUrl: user.avatarUrl ?? null,
      onboardingCompleted: user.onboardingCompleted ?? false,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
