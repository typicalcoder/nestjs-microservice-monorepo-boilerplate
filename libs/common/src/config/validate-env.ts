import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Strip surrounding ASCII single/double quotes and ambient whitespace from
 * every string value in the env map. Helm/configMap pipelines sometimes
 * wrap values in quotes (`EMAIL_FROM="'foo@bar.ru'"`) or sneak in
 * trailing newlines (`SOME_KEY=...\n`); both used to manifest as
 * cryptic 5xx until we trimmed each field by hand. Doing it once at the
 * boundary covers every current and future env field automatically.
 *
 * Multi-line values like a PEM-encoded private key keep their inner
 * whitespace — only leading/trailing space and a single matched pair of
 * surrounding quotes get peeled off.
 */
function trimEnvValues(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    let s = v.trim();
    if (
      s.length >= 2 &&
      ((s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'")))
    ) {
      s = s.slice(1, -1);
    }
    out[k] = s;
  }
  return out;
}

/**
 * Factory for `ConfigModule.forRoot({ validate })` hooks. Binds a typed
 * config class and returns a callback that runs at boot: every
 * class-validator violation is aggregated into one error so a misconfigured
 * pod is diagnosed from a single `kubectl logs` line.
 *
 * Returns the *trimmed* env so `ConfigService.get(...)` answers for vars
 * not declared on the schema with the same normalisation applied.
 */
export function validateEnvWith<T extends object>(
  cls: ClassConstructor<T>,
): (raw: Record<string, unknown>) => Record<string, unknown> {
  return (raw) => {
    const trimmed = trimEnvValues(raw);
    const cfg = plainToInstance(cls, trimmed, {
      enableImplicitConversion: true,
    });
    const errors = validateSync(cfg as object, {
      skipMissingProperties: false,
    });
    if (errors.length > 0) {
      const msg = errors
        .map(
          (e) =>
            `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
        )
        .join('\n');
      throw new Error(`${cls.name} validation failed:\n${msg}`);
    }
    // Mutate the original env in place — NestJS reuses this object for
    // ConfigService and it must reflect the normalised values.
    for (const [k, v] of Object.entries(trimmed)) {
      raw[k] = v;
    }
    return raw;
  };
}
