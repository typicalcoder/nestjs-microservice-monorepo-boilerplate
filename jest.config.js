/**
 * Monorepo-wide jest config. Per-app specs live next to sources as *.spec.ts.
 * Path aliases match tsconfig.json so `@app/*` resolves inside tests.
 *
 * Coverage gates are tiered by directory:
 *   - libs/common/src/config  — 80% (env helpers — pure logic)
 *   - libs/common/src/events  — 80% (event schemas — pure logic)
 *   - global floor            — 15% (ratchet it up as services gain coverage)
 *
 * Integration-heavy surfaces (controllers, Nest modules, microservice
 * bootstrap glue) are excluded from `collectCoverageFrom` — they're verified
 * by the E2E smoke suite (tools/e2e-smoke.sh), not unit tests, so including
 * them would only deflate the number.
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [
    '<rootDir>/apps/**/*.spec.ts',
    '<rootDir>/libs/**/*.spec.ts',
    '<rootDir>/tasks/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // Transpile ESM-only deps on the fly so Jest's CJS runtime can require
    // them (e.g. @mikro-orm/decorators if a spec loads entities).
    '^.+\\.m?js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
    ],
  },
  // node_modules is excluded from transform by default; whitelist @mikro-orm
  // so its ESM `export` statements get rewritten into CJS by babel-jest.
  // pnpm puts the real package under .pnpm/@mikro-orm+NAME@VERSION/... so the
  // regex has to accept both layouts.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/@mikro-orm\\+|@mikro-orm/))',
  ],
  moduleNameMapper: {
    // @mikro-orm/core uses `import.meta.resolve` at module scope — babel
    // can't make that CJS-safe, so unit tests get a no-op stand-in. See the
    // stub header for the rationale and the escape hatch.
    '^@mikro-orm/core$': '<rootDir>/test/mikro-orm-jest-stub.cjs',
    '^@mikro-orm/mongodb$': '<rootDir>/test/mikro-orm-jest-stub.cjs',
    '^@app/common$': '<rootDir>/libs/common/src',
    '^@app/common/(.*)$': '<rootDir>/libs/common/src/$1',
    '^@app/database$': '<rootDir>/libs/database/src',
    '^@app/database/(.*)$': '<rootDir>/libs/database/src/$1',
    '^@app/messaging$': '<rootDir>/libs/messaging/src',
    '^@app/messaging/(.*)$': '<rootDir>/libs/messaging/src/$1',
  },
  collectCoverageFrom: [
    'apps/**/*.ts',
    'libs/**/*.ts',
    'tasks/**/*.ts',
    // Files that exist only to wire Nest / Mongo / RMQ together — no logic
    // worth unit-covering; exercised by the E2E smoke.
    '!**/*.spec.ts',
    '!**/main.ts',
    '!**/*.dto.ts',
    '!**/*.entity.ts',
    '!**/*.module.ts',
    '!**/*.controller.ts',
    '!**/bootstrap/**',
    '!libs/database/src/mikro-orm.config.ts',
    '!libs/database/src/database.module.ts',
    '!**/dist/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  // Note on thresholds: Jest subtracts per-path matches from the global set,
  // so the `global` numbers below apply to everything OUTSIDE the per-path
  // buckets — i.e. the integration-heavy apps/* services and tasks/*.
  coverageThreshold: {
    global: {
      statements: 15,
      branches: 6,
      functions: 10,
      lines: 15,
    },
    'libs/common/src/config/': {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
    'libs/common/src/events/': {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
