/**
 * Reads a required environment variable or throws synchronously at module
 * load time. No silent fallbacks — in k8s the pod should fail-fast so the
 * misconfiguration is visible in `kubectl describe pod` instead of
 * manifesting hours later as a connection error to localhost.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    throw new Error(
      `Missing required env var "${name}". Fix the k8s ConfigMap/Secret or your .env file.`,
    );
  }
  return value.trim();
}

/** Optional env with a typed fallback. Does NOT treat empty string as unset. */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return value;
}

/**
 * Verify a group of required env vars all-at-once at startup and throw a
 * single error listing every missing one. Cheaper to debug a misconfigured
 * pod than a sequence of `requireEnv` failures one by one.
 *
 * Call from each service's main.ts before NestFactory.create(); or from
 * bootstrap helpers so every service validates before any modules load.
 */
export function assertRequiredEnv(names: string[]): void {
  const missing: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined || value === null || value.trim() === '') {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. ` +
        `Fix the k8s ConfigMap/Secret or your .env file.`,
    );
  }
}

/**
 * Parse an int-shaped env var with optional range validation. Throws on
 * unset/empty/non-integer values, so callers don't have to sprinkle
 * `parseInt(process.env.X ?? '0')` and risk silently booting with 0.
 */
export function requireEnvInt(
  name: string,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Env var "${name}" must be an integer (got "${raw}")`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`Env var "${name}" must be ≥ ${opts.min} (got ${n})`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new Error(`Env var "${name}" must be ≤ ${opts.max} (got ${n})`);
  }
  return n;
}

/**
 * Decode a base64 env var and verify it decodes to the expected byte count.
 * Needed for base64 secrets/keys where a 16- vs 32-byte
 * key mistake would only blow up on the first webhook — we want the pod to
 * fail at startup instead.
 */
export function requireEnvBase64(name: string, expectedBytes?: number): Buffer {
  const raw = requireEnv(name);
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(`Env var "${name}" is not valid base64`);
  }
  if (expectedBytes !== undefined && buf.length !== expectedBytes) {
    throw new Error(
      `Env var "${name}" must decode to ${expectedBytes} bytes (got ${buf.length})`,
    );
  }
  return buf;
}
