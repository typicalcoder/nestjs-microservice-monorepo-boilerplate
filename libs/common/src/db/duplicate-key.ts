/**
 * Recognise a MongoDB duplicate-key violation (E11000) consistently across
 * the four call sites that used to inline their own variant. The driver
 * raises a `MongoServerError` with `code === 11000` plus a `keyPattern`
 * map of `{ <field>: 1 }` listing which unique index fired. The message
 * also names the field, but it changes between Mongo versions, so the
 * `field` overload prefers `keyPattern` and falls back to a name-match
 * regex on the message only when `keyPattern` is absent.
 *
 * Usage:
 *   try { await coll.insertOne(doc); }
 *   catch (err) {
 *     if (isDuplicateKeyError(err, 'email')) throwEmailTaken();
 *     throw err;
 *   }
 *
 * Without the `field` argument: any duplicate-key error matches.
 */
export function isDuplicateKeyError(err: unknown, field?: string): boolean {
  const e = err as {
    code?: number;
    message?: string;
    keyPattern?: Record<string, unknown>;
  } | null;
  if (!e || e.code !== 11000) return false;
  if (!field) return true;
  if (e.keyPattern && Object.keys(e.keyPattern).includes(field)) return true;
  // Fallback for legacy drivers that don't surface `keyPattern`. The
  // message looks like `E11000 duplicate key error ... index: email_1 ...`,
  // so we want `email` to match in `email_1` but NOT match a longer name
  // like `emailVerificationToken_1`. Anchor on the leading word boundary
  // and require the trailing char (if any) to be `_` (the index suffix
  // separator) — that gives us "exact field, possibly followed by _N".
  if (typeof e.message === 'string') {
    return new RegExp(`\\b${field}(?:_|\\b)`).test(e.message);
  }
  return false;
}
