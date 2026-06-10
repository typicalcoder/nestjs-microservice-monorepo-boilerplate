# Mongo data migrations

MikroORM's migration tooling is SQL-first; our Mongo deployments need
hand-written scripts for data reshapes (index drops, field renames, backfills).

## Format

Each migration is a file named `NNN_short_description.ts` in this directory.
`NNN` is a zero-padded sequence number — the runner sorts lexically and
applies any file not yet recorded in the `_migrations` collection.

Each file exports:

```ts
export const id = '001_example';
export async function up(db: Db): Promise<void> { /* ... */ }
export async function down(db: Db): Promise<void> { /* ... */ }
```

- `id` **must** match the filename (without `.ts`).
- `up` is required; `down` is optional but encouraged for local dev.
- Scripts are run in a single process with the Mongo driver already
  connected to the configured database — no EM / entity classes,
  raw collections only (so we don't tie migrations to a snapshot of
  the current entity definitions).

## Running

```bash
pnpm exec nest build task-db-migrate
# locally:
node dist/tasks/db-migrate/main.js

# k8s:
# kubectl create job db-migrate-$(date +%s) \
#   --from=cronjob/dev-task-db-migrate
```

The task runs pending migrations, records each successful run in the
`_migrations` collection as `{ id, appliedAt }`, and exits 0. On
failure it exits non-zero and leaves the partial-state migration in
place — a re-run will retry that same file.

## Rollback

`down` is only run manually by SSH'ing into a task pod and calling
the module directly. Prod rollback should be rare; prefer a follow-up
`up` migration that corrects the state.

## When NOT to write a migration

- MikroORM entity **additions** are schemaless in Mongo — just add the
  @Property and deploy. The backend will read `undefined` for old docs.
- Index adjustments in `dev` — `ensureIndexes` is `true` there, so
  the entity annotation is picked up on startup. Prod has it off
  (see `libs/database/src/database.module.ts:47`), so any NEW index
  needs a migration that calls `db.collection(...).createIndex(...)`.
