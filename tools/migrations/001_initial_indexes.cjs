/**
 * Baseline no-op migration. Acts as the "zero" entry in `_migrations` so
 * future deltas have a well-defined ordering predecessor. Production dbs
 * that were created before the migration framework existed should run
 * this first to record their baseline.
 *
 * Intentionally does nothing — entity-level @Index annotations bootstrapped
 * the current index set in dev. When we need to add or drop indexes in
 * prod (where ensureIndexes is off), write a follow-up `002_*`.
 *
 * CommonJS (`.cjs`) so the runtime loader (raw Node require) works in the
 * webpack-bundled task without a TS compiler step.
 */
'use strict';

module.exports.id = '001_initial_indexes';

module.exports.up = async function up(_db) {
  // No-op baseline.
};

module.exports.down = async function down(_db) {
  // No-op.
};
