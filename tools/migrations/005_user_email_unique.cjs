/**
 * Promote `users.email` from a plain sparse index to a UNIQUE sparse
 * index. Without uniqueness the JS-side `findOne({email})` in
 * `upgradeAccount` / `findOrCreateOAuthUser` is a read-then-write race;
 * two parallel callers can both take the same email and end up with a
 * duplicate User document.
 *
 * Strategy:
 *   1. Pre-flight: count active (non-soft-deleted) users that share an
 *      email. If any group has size > 1, abort the migration with a
 *      loud error so a human resolves it manually — silently picking a
 *      keeper from `email_already_registered` collisions can lose data.
 *   2. Drop the existing non-unique sparse index, if any.
 *   3. Create the new UNIQUE sparse index on `email`.
 *
 * Down: revert to the non-unique sparse index — same shape as before
 * the migration. Pre-existing data isn't restored.
 *
 * CommonJS — same convention as 001/002/003/004 for the runtime loader.
 */
'use strict';

module.exports.id = '005_user_email_unique';

module.exports.up = async function up(db) {
  const users = db.collection('users');

  // 1. Bail out if any active email is shared by two or more users.
  const dups = await users
    .aggregate([
      { $match: { email: { $type: 'string' }, deletedAt: null } },
      { $group: { _id: '$email', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
  if (dups.length > 0) {
    const summary = dups
      .map((d) => `${d._id} (${d.count} accounts: ${d.ids.join(', ')})`)
      .join('; ');
    throw new Error(
      `Cannot create unique index on users.email — ${dups.length} duplicate(s) found: ${summary}. ` +
        `Resolve manually (merge or delete duplicates) before re-running this migration.`,
    );
  }

  // 2. Drop the legacy non-unique variant if present — keeping a
  // non-unique definition next to the unique one would defeat the
  // whole point of this migration. Best-effort: tolerate the case
  // where MikroORM ensureIndexes already replaced it.
  const existing = await users.indexes();
  for (const ix of existing) {
    if (
      ix.key &&
      Object.keys(ix.key).length === 1 &&
      ix.key.email === 1 &&
      !ix.unique
    ) {
      await users.dropIndex(ix.name).catch(() => undefined);
    }
  }

  // 3. Create the unique sparse index. Name matches the @Index
  // decorator on `User.email` 1:1 so this is idempotent against
  // both prior runs and ensureIndexes-built definitions.
  await users.createIndex(
    { email: 1 },
    { name: 'users_email_unique', unique: true, sparse: true },
  );
};

module.exports.down = async function down(db) {
  const users = db.collection('users');
  await users.dropIndex('users_email_unique').catch(() => undefined);
  await users.createIndex(
    { email: 1 },
    { name: 'users_email_sparse', sparse: true },
  );
};
