import { Entity, Index, Property } from '@mikro-orm/core';
import { ObjectId } from '@mikro-orm/mongodb';
import { BaseEntity } from './base.entity';

@Entity({ tableName: 'devices' })
@Index({ properties: ['userId', 'createdAt'] })
export class Device extends BaseEntity {
  @Property({ unique: true })
  fingerprint!: string;

  @Property()
  platform: 'android' | 'ios' = 'android';

  @Property()
  userId!: ObjectId;

  @Property({ onCreate: () => new Date() })
  lastSeenAt: Date = new Date();

  @Property({ nullable: true })
  lastIpHash?: string;

  @Property()
  attestationFailures: number = 0;

  /**
   * Hard-block from future autoreg / login. Set manually via admin tool, or
   * automatically when `attestationFailures` exceeds threshold.
   */
  @Property()
  isBlocked: boolean = false;

  @Property({ nullable: true })
  blockedReason?: string;

  @Property({ nullable: true })
  blockedAt?: Date;
}
