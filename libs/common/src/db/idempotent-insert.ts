import { EntityManager } from '@mikro-orm/mongodb';
import { isDuplicateKeyError } from './duplicate-key';

/**
 * Insert `doc` into `collection` via the native Mongo driver, treating
 * E11000 (duplicate key on a unique index) as the idempotent-replay
 * signal: returns `{ inserted: false }` instead of throwing.
 *
 * Bypasses MikroORM's identity map / unit of work so the duplicate-key
 * error fires synchronously at the insert call site rather than at a
 * later flush — necessary for callers that branch on `inserted` before
 * doing more work (atomic $inc, fire-and-forget push, etc.).
 *
 * Non-duplicate errors (network, schema validation, …) still throw.
 */
export async function idempotentInsert<T extends Record<string, unknown>>(
  em: EntityManager,
  collection: string,
  doc: T,
): Promise<{ inserted: boolean }> {
  const coll = em.getConnection().getCollection(collection);
  try {
    await coll.insertOne(doc);
    return { inserted: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { inserted: false };
    throw err;
  }
}
