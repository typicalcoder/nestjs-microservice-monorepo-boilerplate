import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DI token for the raw mongodb `Db` provided by `app.module`. Lives
 * here (the consumer side) instead of `app.module` to avoid a circular
 * import — the module imports `DbMigrateTask`, so anything `DbMigrateTask`
 * imports from the module is `undefined` at decorator-evaluation time
 * and Nest fails to resolve the constructor argument.
 */
export const MONGO_DB_TOKEN = 'MONGO_DB_RAW';

interface Migration {
  id: string;
  up: (db: Db) => Promise<void>;
  down?: (db: Db) => Promise<void>;
}

const MIGRATIONS_COLLECTION = '_migrations';

/**
 * Applies pending migrations from `tools/migrations/*.ts` in lexical order.
 * Records each successful run in the `_migrations` collection so re-running
 * is idempotent. Migration scripts use the raw mongodb `Db` (not an EM)
 * so they stay decoupled from evolving entity definitions.
 *
 * Invoked by the `task-db-migrate` k8s Job. In prod this runs as part of
 * release hooks before the new microservice pods start accepting traffic.
 *
 * Note: this task talks to Mongo directly via the `mongodb` driver — no
 * MikroORM. An ORM-backed runner would `ensureIndexes()` on init in dev,
 * which races any migration that exists *to fix* the data violating the
 * new index (the very situation a dedup migration handles).
 */
@Injectable()
export class DbMigrateTask {
  private readonly logger = new Logger(DbMigrateTask.name);

  constructor(@Inject(MONGO_DB_TOKEN) private readonly db: Db) {}

  async run(): Promise<{ applied: number; skipped: number }> {
    const applied = await this.loadAppliedIds(this.db);
    const all = this.loadMigrations();

    let appliedCount = 0;
    let skippedCount = 0;

    for (const m of all) {
      if (applied.has(m.id)) {
        skippedCount++;
        continue;
      }
      this.logger.log(`Applying migration ${m.id}…`);
      try {
        await m.up(this.db);
        await this.db
          .collection(MIGRATIONS_COLLECTION)
          .insertOne({ id: m.id, appliedAt: new Date() });
        appliedCount++;
        this.logger.log(`  ok (${m.id})`);
      } catch (err) {
        this.logger.error(
          `Migration ${m.id} failed: ${(err as Error).message}`,
        );
        throw err; // exit non-zero — next run retries this same file
      }
    }

    this.logger.log(
      `Migration sweep complete: applied=${appliedCount} skipped=${skippedCount}`,
    );
    return { applied: appliedCount, skipped: skippedCount };
  }

  private async loadAppliedIds(db: Db): Promise<Set<string>> {
    const rows = await db
      .collection<{ id: string }>(MIGRATIONS_COLLECTION)
      .find({}, { projection: { id: 1 } })
      .toArray();
    return new Set(rows.map((r: { id: string }) => r.id));
  }

  /**
   * Reads every `NNN_*.cjs` (or `.js`) file in `tools/migrations/`,
   * loads it through Node's CommonJS resolver, and returns the scripts
   * in id order.
   *
   * Migrations are CommonJS — webpack would otherwise inline them into
   * the bundle (defeating the point of an external migration folder)
   * and the runtime image needs no TypeScript compiler.
   */
  private loadMigrations(): Migration[] {
    // Webpack rewrites `__dirname` to the bundle's source dir at compile
    // time; at runtime that's `dist/tasks/db-migrate/`. Migrations live
    // at `<repo>/tools/migrations` in dev and are copied to
    // `<image>/tools/migrations` in the runtime container — both reachable
    // from cwd. Keep the resolved-from-__dirname fallback for the
    // standalone `node dist/tasks/db-migrate/main.js` case from repo root.
    const candidates = [
      path.resolve(process.cwd(), 'tools/migrations'),
      path.resolve(__dirname, '../../tools/migrations'),
      path.resolve(__dirname, '../../../tools/migrations'),
    ];
    let dir: string | null = null;
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        dir = candidate;
        break;
      }
    }
    if (!dir) {
      this.logger.warn('tools/migrations directory not found — nothing to do');
      return [];
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{3,}_.+\.(cjs|js)$/.test(f) && !f.endsWith('.d.ts'))
      .sort();

    // Hide the dynamic require from webpack — bundling the whole
    // tools/migrations directory at compile time would defeat the
    // purpose of an external migration folder. `eval('require')` keeps
    // webpack out of the way and falls through to Node's CommonJS
    // resolver at runtime.

    const nodeRequire = eval('require') as NodeRequire;

    const out: Migration[] = [];
    for (const file of files) {
      const mod = nodeRequire(path.join(dir, file)) as Partial<Migration>;
      if (!mod.id || typeof mod.up !== 'function') {
        this.logger.warn(
          `Skipping ${file}: missing required exports { id, up }`,
        );
        continue;
      }
      out.push({ id: mod.id, up: mod.up, down: mod.down });
    }
    return out;
  }
}
