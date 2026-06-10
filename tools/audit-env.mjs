#!/usr/bin/env node
/**
 * One-shot audit: cross-check three env surfaces across the monorepo.
 *
 *   1. Typed config classes (@IsX decorated fields on *.config.ts)
 *   2. Runtime reads (process.env[X], config.get(X), config.getOrThrow(X),
 *      requireEnv(X), requireEnvInt(X), requireEnvUrl(X), requireEnvBase64(X),
 *      optionalEnv(X))
 *   3. Every .env.example file
 *
 * Reports three gap classes per service scope:
 *   - read in code but NOT declared on the typed config  (validation hole)
 *   - declared on typed config but NEVER read in code    (decorative field)
 *   - read in code but MISSING from .env.example          (doc gap)
 *
 * Not a linter — just a readable diff. Meant to be run, read, deleted.
 *
 * Run: node tools/audit-env.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── scope map: which .env.example owns which code directory(s) ───────────
// Root .env.example is a union — not a per-scope authority, reported separately.
const SCOPES = [
  { name: 'gateway', code: ['apps/gateway'], env: 'apps/gateway/.env.example', config: 'apps/gateway/src/config/gateway.config.ts' },
  { name: 'user',    code: ['apps/user'],    env: 'apps/user/.env.example',    config: 'apps/user/src/config/user.config.ts' },
  { name: 'task:db-migrate', code: ['tasks/db-migrate'], env: 'tasks/db-migrate/.env.example', config: null },
  { name: 'task:user-purge', code: ['tasks/user-purge'], env: 'tasks/user-purge/.env.example', config: null },
];

// Shared config classes in libs/common — inherited by service configs.
const SHARED_CONFIGS = {
  ServiceConfig: ['MONGO', 'MONGO_DB', 'RABBITMQ_URL', 'RMQ_QUEUE_PREFIX'],
  MongoTaskConfig: ['MONGO', 'MONGO_DB'],
};

// Vars every service boots through initSentry / buildLogger (libs/common).
const OBSERVABILITY_VARS = [
  'NODE_ENV', 'LOG_LEVEL', 'LOG_FORMAT',
  'SENTRY_DSN', 'SENTRY_TRACES_SAMPLE_RATE', 'RELEASE_TAG',
  // RMQ_QUEUE_PREFIX is now declared on ServiceConfig / GatewayConfig.
];

/**
 * Keys read in code BEFORE NestFactory.create / ConfigModule comes online.
 * Typed-config validate hook can't touch them — `requireEnvBase64()` /
 * manual checks own those vars. Not a validation hole, so silence the
 * "not on config class" warning.
 */
const BOOTSTRAP_ONLY = {
  // These vars are read via process.env in libs/common code (queue.constants,
  // main.ts early guards) that runs BEFORE NestFactory / ConfigModule boots.
  // The typed config still declares them so validate-hook catches bad values,
  // but the code-read is invisible to the per-scope grep.
  gateway: ['RMQ_QUEUE_PREFIX'],
  user:    ['RMQ_QUEUE_PREFIX'],
};

/**
 * Config-class fields consumed by shared library code (libs/common) rather
 * than by the service's own code. The typed schema still validates them at
 * boot, but the per-scope code grep won't find the read inside apps/.
 * Keep in sync with the actual reads in libs/.
 */
const SHARED_LIB_READS = {
  // getQueuePrefix() in libs/common/src/constants/queue.constants.ts reads
  // RMQ_QUEUE_PREFIX via process.env at module-load time. All services use it.
  gateway: ['RMQ_QUEUE_PREFIX'],
  user:    ['RMQ_QUEUE_PREFIX'],
};

/**
 * Fields deliberately declared on config classes as stubs for upcoming
 * features — the typed schema documents them as future optional vars so
 * prod env templates stay correct once the feature wires in. Keep the
 * marker here in sync with the docstring on the field.
 */
const RESERVED_STUBS = {
  gateway: [
    // phase 2 — VK server-to-server API (no user context).
    'VK_ANDROID_SERVICE_TOKEN',
    'VK_IOS_SERVICE_TOKEN',
  ],
};

// ─── helpers ───────────────────────────────────────────────────────────────

function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walkTs(p, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Collect env reads from a set of dirs — union of every way we read env. */
function collectReads(codeDirs) {
  const keys = new Set();
  const patterns = [
    /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /process\.env\.([A-Z][A-Z0-9_]*)\b/g,
    // Allow chained call across linebreaks: `this.config\n      .getOrThrow<T>('X')`
    /\.(?:get|getOrThrow)(?:\s*<[^>]+>)?\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\b(?:requireEnv|optionalEnv|requireEnvInt|requireEnvUrl|requireEnvBase64)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  ];
  for (const d of codeDirs) {
    const abs = join(ROOT, d);
    if (!statSync(abs, { throwIfNoEntry: false })) continue;
    for (const file of walkTs(abs)) {
      const src = readFileSync(file, 'utf8');
      for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src)) !== null) keys.add(m[1]);
      }
    }
  }
  return keys;
}

/** Extract class-validator-decorated fields (declared env keys) from a config file. */
function collectConfigFields(configPath) {
  if (!configPath) return { fields: new Set(), extendsName: null };
  const abs = join(ROOT, configPath);
  const src = readFileSync(abs, 'utf8');

  // `extends ServiceConfig` / `extends MongoTaskConfig`
  const extMatch = src.match(/class\s+\w+\s+extends\s+(\w+)/);
  const extendsName = extMatch ? extMatch[1] : null;

  // Scan class body for UPPER_CASE field declarations that follow at least
  // one class-validator / transform decorator. We don't try to bind specific
  // decorators to specific fields — any UPPER_SNAKE identifier directly
  // declared as `NAME[?!]:` or `NAME[?!] =` inside the class is assumed to
  // be a typed env field. class-validator convention is reliable here.
  const fields = new Set();
  const fieldLineRe = /^\s*([A-Z][A-Z0-9_]+)\s*[?!]?\s*[:=]/gm;
  let m;
  while ((m = fieldLineRe.exec(src)) !== null) fields.add(m[1]);
  return { fields, extendsName };
}

function collectEnvExample(envPath) {
  const keys = new Set();
  const abs = join(ROOT, envPath);
  const src = readFileSync(abs, 'utf8');
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // "#   VK_JWKS_URL=https://..." — commented-out hint, counts as documented.
    const comm = line.match(/^\s*#+\s+([A-Z][A-Z0-9_]*)\s*=/);
    if (comm) {
      keys.add(comm[1]);
      continue;
    }
    if (t.startsWith('#')) continue;
    const m = t.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function fmtSet(s) {
  return s.size === 0 ? '—' : [...s].sort().join(', ');
}

// ─── run ───────────────────────────────────────────────────────────────────

const findings = [];

for (const scope of SCOPES) {
  const codeReads = collectReads(scope.code);
  const envDeclared = collectEnvExample(scope.env);
  const { fields: ownFields, extendsName } = collectConfigFields(scope.config);
  const inherited = extendsName && SHARED_CONFIGS[extendsName] ? SHARED_CONFIGS[extendsName] : [];
  const allConfigFields = new Set([...ownFields, ...inherited]);

  // For task-scopes without a dedicated config but backed by MongoTaskConfig:
  const effectiveFields = scope.config
    ? allConfigFields
    : scope.name.startsWith('task:')
      ? new Set(SHARED_CONFIGS.MongoTaskConfig)
      : new Set(SHARED_CONFIGS.ServiceConfig);

  // Observability vars are read inside libs/common/bootstrap — legitimate but
  // invisible to the per-scope grep. Treat as "inherited" to suppress noise.
  const inheritedObservability = new Set(OBSERVABILITY_VARS);
  const bootstrapOnly = new Set(BOOTSTRAP_ONLY[scope.name] ?? []);
  const sharedLibReads = new Set(SHARED_LIB_READS[scope.name] ?? []);
  const reservedStubs = new Set(RESERVED_STUBS[scope.name] ?? []);

  const readsMinusConfig = new Set(
    [...codeReads].filter(
      k => !effectiveFields.has(k)
        && !inheritedObservability.has(k)
        && !bootstrapOnly.has(k),
    ),
  );
  const configMinusReads = new Set(
    [...effectiveFields].filter(
      k => !codeReads.has(k) && !reservedStubs.has(k) && !sharedLibReads.has(k),
    ),
  );
  const readsMinusEnv = new Set(
    [...codeReads].filter(k => !envDeclared.has(k) && !inheritedObservability.has(k)),
  );
  const envMinusReads = new Set(
    [...envDeclared].filter(
      k => !codeReads.has(k)
        && !inheritedObservability.has(k)
        && !effectiveFields.has(k)
        && !reservedStubs.has(k),
    ),
  );

  findings.push({
    scope: scope.name,
    configFile: scope.config ?? `(shared ${scope.name.startsWith('task:') ? 'MongoTaskConfig' : 'ServiceConfig'})`,
    envFile: scope.env,
    readsMinusConfig,
    configMinusReads,
    readsMinusEnv,
    envMinusReads,
  });
}

// ─── report ────────────────────────────────────────────────────────────────

let any = false;
for (const f of findings) {
  const hole = f.readsMinusConfig.size;
  const dead = f.configMinusReads.size;
  const docGap = f.readsMinusEnv.size;
  const envDead = f.envMinusReads.size;
  if (!hole && !dead && !docGap && !envDead) continue;
  any = true;
  console.log(`\n── ${f.scope} ────────────────────────────────────────────`);
  console.log(`   config: ${f.configFile}`);
  console.log(`   env:    ${f.envFile}`);
  if (hole) console.log(`   ⚠  VALIDATION HOLE (read in code, not on config class):\n        ${fmtSet(f.readsMinusConfig)}`);
  if (dead) console.log(`   ☠  DECORATIVE FIELDS (on config class, never read):\n        ${fmtSet(f.configMinusReads)}`);
  if (docGap) console.log(`   📄 DOC GAP (read in code, missing from .env.example):\n        ${fmtSet(f.readsMinusEnv)}`);
  if (envDead) console.log(`   🗑  STALE ENV (in .env.example, not read, not on config):\n        ${fmtSet(f.envMinusReads)}`);
}
if (!any) {
  console.log(
    '\n✓ all scopes consistent: every read is declared on a config class AND in .env.example, no decorative fields, no stale env entries.',
  );
}
console.log('');
// Exit non-zero so CI / `pnpm lint:env` fails the pipeline on regressions.
process.exit(any ? 1 : 0);
