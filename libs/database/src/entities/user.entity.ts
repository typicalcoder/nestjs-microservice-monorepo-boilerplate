import {
  Entity,
  Property,
  Embeddable,
  Embedded,
  Index,
} from '@mikro-orm/decorators/legacy';
import { AccountType, Locale } from '@app/common';
import type { OAuthProvider } from '@app/common';
import { BaseEntity } from './base.entity';

@Embeddable()
export class OAuthLink {
  @Property()
  provider!: OAuthProvider;

  @Property()
  providerUserId!: string;

  @Property({ nullable: true })
  email?: string;

  @Property({ onCreate: () => new Date() })
  linkedAt: Date = new Date();
}

@Entity({ tableName: 'users' })
// Purge-task scan — sparse partial index on soft-deleted rows only.
@Index({
  properties: ['deletedAt'],
  options: { partialFilterExpression: { deletedAt: { $type: 'date' } } },
})
export class User extends BaseEntity {
  @Property()
  accountType: AccountType = AccountType.autoreg;

  @Property({ nullable: true })
  name?: string;

  // Unique sparse — at most one User per email, but soft-deleted accounts
  // (which scrub `email` in deleteUser) drop out of the index and free the
  // address for re-use. The JS-side `findOne` in upgradeAccount /
  // findOrCreateOAuthUser is a fast-path; the load-bearing gate is this
  // index — a concurrent attempt either matches and 409s on the find, or
  // races past it and hits E11000 on flush, translated to the same 409.
  // Index name matches tools/migrations/005_user_email_unique.cjs so
  // MikroORM ensureIndexes (dev) and the migration produce the same Mongo
  // index — no "different name" collisions.
  @Property({ nullable: true })
  @Index({
    options: { name: 'users_email_unique', unique: true, sparse: true },
  })
  email?: string;

  @Property({ nullable: true })
  passwordHash?: string;

  /** IANA timezone string — available for any per-user date math. */
  @Property()
  tz: string = 'UTC';

  @Property()
  locale: Locale = Locale.ru;

  @Property({ nullable: true })
  avatarUrl?: string;

  /**
   * Bump on every event that should invalidate every existing refresh token
   * for this user (password reset, account upgrade, account delete). Refresh
   * JWTs carry the `tv` claim from the moment they were minted; on
   * /auth/refresh we compare it to the current value, and any token issued
   * before the last bump is rejected as `token_invalid`.
   *
   * Access tokens are short-lived and intentionally not gated on this — the
   * kill switch targets the long-lived refresh path.
   */
  @Property()
  tokenVersion: number = 0;

  @Property()
  onboardingCompleted: boolean = false;

  @Embedded(() => OAuthLink, { object: true, array: true })
  oauthLinks: OAuthLink[] = [];

  @Property({ nullable: true })
  upgradedAt?: Date;

  @Property({ nullable: true })
  resetPasswordToken?: string;

  @Property({ nullable: true })
  resetPasswordExpiry?: Date;

  /** Soft-delete marker. Grace window before the purge task wipes the record. */
  @Property({ nullable: true })
  deletedAt?: Date;
}
