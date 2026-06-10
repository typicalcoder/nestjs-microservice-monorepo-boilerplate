import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EntityManager, ObjectId } from '@mikro-orm/mongodb';
import { MikroORM } from '@mikro-orm/core';
import { CreateRequestContext } from '@mikro-orm/decorators/legacy';
import { OutboxEvent } from '@app/database';
import { errorAndCapture, metrics, RpcClientService } from '@app/common';

const POLL_INTERVAL_MS = 2_000;
const MAX_BATCH = 25;
const MAX_ATTEMPTS = 10;

/**
 * Generic in-process outbox dispatcher. Each service that wants
 * at-least-once event delivery imports OutboxModule, calls stageOutboxEvent
 * inside its unit-of-work, and the dispatcher running in the same pod sweeps
 * pending rows and publishes them to the topic exchange.
 *
 * Why in-process rather than a dedicated worker:
 *   - 1 replica per service in MVP; co-location avoids an extra deployment
 *     and an extra Mongo connection
 *   - sweep is cheap (small batch + short poll); the overhead of running it
 *     alongside the API/RPC handlers is negligible
 *   - the unref'd timer keeps the loop from holding the process open during
 *     graceful shutdown / tests
 *
 * Caveats baked in (call out before adding new producers):
 *   - At-least-once: a successful publish that fails to mark `sent` is
 *     re-published on the next sweep. Consumers MUST dedupe on
 *     `idempotencyKey` (the schema validator already passes this through).
 *   - Single-replica: if a service scales out, two pods sweep the same rows
 *     and double-emit. Add a `lockedBy/lockedUntil` column or move dispatch
 *     to a dedicated singleton worker before that.
 *   - 10 attempts then `failed` — terminal state for ops to inspect; no
 *     auto-promotion to DLQ (handler errors land in `<svc>.dlq` separately).
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private shuttingDown = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly em: EntityManager,
    private readonly rpc: RpcClientService,
  ) {}

  @CreateRequestContext()
  async onModuleInit(): Promise<void> {
    // Alert on startup if there are already terminal-failed rows from a prior
    // run. These will never be retried automatically — ops must inspect and
    // decide whether to re-queue or accept the loss. Surfaced as ERROR so
    // Sentry catches them even if no one is watching logs.
    const stuck = await this.em.count(OutboxEvent, { status: 'failed' });
    if (stuck > 0) {
      this.logger.error(
        `Outbox has ${stuck} terminal-failed row(s) from a previous run. ` +
          `Inspect the outbox_events collection (status='failed') and re-queue or acknowledge.`,
      );
    }
    metrics.outboxFailed.set(stuck);
    this.schedule();
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.shuttingDown) return;
    this.timer = setTimeout(() => {
      void this.sweep().finally(() => this.schedule());
    }, POLL_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  @CreateRequestContext()
  async sweep(): Promise<{ dispatched: number; failed: number }> {
    if (this.running) return { dispatched: 0, failed: 0 };
    this.running = true;
    try {
      const pending = await this.em.find(
        OutboxEvent,
        { status: 'pending', attempts: { $lt: MAX_ATTEMPTS } },
        { orderBy: { createdAt: 'ASC' }, limit: MAX_BATCH },
      );
      if (pending.length === 0) return { dispatched: 0, failed: 0 };

      let dispatched = 0;
      let failed = 0;
      for (const row of pending) {
        try {
          this.rpc.publishEvent(row.pattern, row.payload);
          row.status = 'sent';
          row.lastAttemptAt = new Date();
          row.attempts += 1;
          dispatched++;
        } catch (err) {
          row.attempts += 1;
          row.lastAttemptAt = new Date();
          row.lastError = (err as Error).message;
          if (row.attempts >= MAX_ATTEMPTS) {
            row.status = 'failed';
            failed++;
            metrics.outboxTerminalFailuresTotal
              .labels(row.target, row.pattern)
              .inc();
            // Terminal failure — no more retries. Log as ERROR so Sentry
            // picks it up. Include idempotencyKey for correlation with the
            // domain mutation that staged this row.
            errorAndCapture(
              this.logger,
              `Outbox event reached terminal failure (${MAX_ATTEMPTS} attempts). ` +
                `target=${row.target} pattern=${row.pattern} ` +
                `key=${row.idempotencyKey} lastError=${row.lastError}`,
              err,
              {
                tag: 'outbox.terminal_failure',
                target: row.target,
                pattern: row.pattern,
                idempotencyKey: row.idempotencyKey,
                attempts: row.attempts,
              },
            );
          } else {
            this.logger.warn(
              `Outbox dispatch failed ${row.target}/${row.pattern} ` +
                `attempt=${row.attempts}: ${row.lastError}`,
            );
          }
        }
      }
      await this.em.flush();
      if (failed > 0) {
        this.logger.error(
          `Outbox sweep: ${failed} event(s) reached terminal failure this cycle. ` +
            `Check above ERRORs for details.`,
        );
      }
      // Refresh sampled gauges after the sweep mutates state. Counts
      // are cheap (indexed on `status`) and give Prometheus a steady
      // signal between terminal-failure events.
      const [stillPending, stillFailed] = await Promise.all([
        this.em.count(OutboxEvent, { status: 'pending' }),
        this.em.count(OutboxEvent, { status: 'failed' }),
      ]);
      metrics.outboxPending.set(stillPending);
      metrics.outboxFailed.set(stillFailed);
      return { dispatched, failed };
    } finally {
      this.running = false;
    }
  }
}

/**
 * Stage an outbox row inside the caller's unit-of-work. The flush happens
 * in the caller's `em.flush()` so the event row and the domain mutation
 * land in the same transaction window — at-least-once delivery starts
 * here, not at the dispatcher.
 *
 * `idempotencyKey` is global (unique-indexed on OutboxEvent), so callers
 * should namespace it: `<event_pattern>:<entity_id>:<context>`.
 *
 * Idempotent at the function level: a duplicate stage with the
 * same key never throws E11000 — instead:
 *   - existing `pending` / `sent` row → no-op, return as-is. The earlier
 *     stage already promised this event; reasserting it changes nothing.
 *   - existing `failed` row → re-queue: reset `attempts`/`lastError`,
 *     refresh the payload, set status back to `pending`. Lets a fresh
 *     domain mutation revive a give-up event.
 */
export interface StageOutboxResult {
  row: OutboxEvent;
  /**
   * `true` when this call inserted a fresh row, `false` when the
   * idempotencyKey already existed (no-op or revival of a `failed` row).
   *
   * Crucial for credit/debit flows: the caller can mirror its
   * user-facing response to whether the event will *actually* be
   * delivered to the consumer. Without this flag a re-emission after
   * an uncomplete/complete cycle would silently no-op in outbox while
   * the API still claimed the side effect happened — i.e. the response lied.
   */
  created: boolean;
}

export async function stageOutboxEvent(
  em: EntityManager,
  params: {
    /** Informational target service (consumer queue) — used in dispatcher logs. */
    target: string;
    /** Routing key on the topic exchange. */
    pattern: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<StageOutboxResult> {
  const existing = await em.findOne(OutboxEvent, {
    idempotencyKey: params.idempotencyKey,
  });
  if (existing) {
    if (existing.status === 'failed') {
      existing.status = 'pending';
      existing.attempts = 0;
      existing.lastError = undefined;
      existing.payload = params.payload;
    }
    // Whether the row was sent/pending or revived from failed, this
    // call did NOT add a new event to be delivered — the prior stage
    // already promised it. Treat as `created: false` so the caller's
    // response stays honest.
    return { row: existing, created: false };
  }
  const row = em.create(OutboxEvent, {
    _id: new ObjectId(),
    target: params.target,
    pattern: params.pattern,
    payload: params.payload,
    idempotencyKey: params.idempotencyKey,
    status: 'pending',
    attempts: 0,
  } as unknown as OutboxEvent);
  em.persist(row);
  return { row, created: true };
}
