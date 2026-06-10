import { Entity, Index, Property } from '@mikro-orm/decorators/legacy';
import { BaseEntity } from './base.entity';

export type OutboxEventStatus = 'pending' | 'sent' | 'failed';

/**
 * Transactional Outbox: a write path persists event rows in the same Mongo
 * flush as its domain mutation. A background dispatcher (OutboxModule) reads
 * `pending` rows and emits them via RpcClientService, then stamps
 * `status:'sent'`.
 *
 * Why an outbox: with naive fire-and-forget, a pod crash between `em.flush()`
 * and `rpc.emit()` loses the event silently — the downstream side effect never
 * happens. Co-locating the event with the DB write closes the gap; at-least-once
 * delivery is the trade (consumers dedupe by `idempotencyKey`).
 *
 * Stage rows via `stageOutboxEvent()` inside the same unit of work as the
 * mutation that produced them.
 */
@Entity({ tableName: 'outbox_events' })
@Index({ properties: ['status', 'createdAt'] })
@Index({ properties: ['idempotencyKey'], options: { unique: true } })
export class OutboxEvent extends BaseEntity {
  /** Target service queue name (e.g. 'user'). */
  @Property()
  target!: string;

  /** Event pattern string that consumers subscribe to. */
  @Property()
  pattern!: string;

  /** Arbitrary JSON payload; kept as-is since consumers parse their own shape. */
  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  /**
   * Stable dedup key per logical operation (e.g. `<entityId>:<date>`) so a
   * crash-retry re-emitting the same row is deduped by the consumer.
   */
  @Property()
  idempotencyKey!: string;

  @Property()
  status: OutboxEventStatus = 'pending';

  @Property({ nullable: true })
  lastAttemptAt?: Date;

  @Property()
  attempts: number = 0;

  @Property({ nullable: true })
  lastError?: string;
}
