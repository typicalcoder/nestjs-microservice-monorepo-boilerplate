/**
 * Jest stand-in for `@mikro-orm/core` / `@mikro-orm/mongodb`.
 *
 * MikroORM v7 is ESM-only and `@mikro-orm/core` uses `import.meta.resolve`
 * at module scope, which Jest's CJS runtime cannot evaluate even after a
 * babel pass. Unit specs never exercise ORM behaviour — they only need the
 * `@app/common` barrel (which transitively imports mikro-orm via
 * bootstrap-task / db helpers) to LOAD. This universal proxy satisfies any
 * named import with a callable/constructible no-op.
 *
 * If you ever write a spec that needs real MikroORM behaviour (entity
 * metadata, EntityManager), don't fight this stub — test through an e2e
 * harness instead, or narrow the moduleNameMapper entries in jest.config.js.
 */
const anything = new Proxy(function anything() {}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return false;
    if (prop === Symbol.toPrimitive || prop === 'toString') {
      return () => 'mikro-orm-jest-stub';
    }
    return anything;
  },
  apply: () => anything,
  construct: () => ({}),
});

module.exports = anything;
