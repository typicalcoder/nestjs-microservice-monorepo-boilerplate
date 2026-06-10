/**
 * Monorepo-wide jest config. Per-app specs live next to sources as *.spec.ts.
 * Path aliases match tsconfig.json so `@app/*` resolves inside tests.
 *
 * Coverage gates are tiered by directory:
 *   - libs/common/src/domain  — 90% (pure logic, every branch ought to be testable)
 *   - libs/common/src/config  — 80% (env helpers)
 *   - libs/common/src/events  — 80% (event schemas)
 *   - global floor             — 20% (ratchets up as more services get coverage)
 *
 * Integration-heavy surfaces (controllers, Nest modules, microservice
 * bootstrap glue) are excluded from `collectCoverageFrom` — they're verified
 * by the curl-driven E2E sweep (memory/backend_e2e_cases.md), not unit tests,
 * so including them would only deflate the number.
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
    // Transpile ESM-only deps (jose) on the fly so Node can require them.
    '^.+\\.m?js$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
    ],
  },
  // node_modules is excluded from transform by default; whitelist jose so
  // its ESM `export` statements get rewritten into CJS by babel-jest.
  // pnpm puts the real package under .pnpm/jose@VERSION/node_modules/jose
  // so the regex has to accept both layouts.
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/jose@|jose/))'],
  moduleNameMapper: {
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
    // worth unit-covering; exercised by E2E smoke.
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
  // so the `global` numbers below apply to everything OUTSIDE the three
  // per-path buckets — i.e. the integration-heavy apps/* services and
  // tasks/*. That's why global is modest (ratchets up as more services
  // land unit tests) while libs/common/* get a strict floor.
  coverageThreshold: {
    global: {
      statements: 15,
      branches: 6,
      functions: 10,
      lines: 15,
    },
    'libs/common/src/domain/': {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
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
  // Ignore build output and node_modules from discovery.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
