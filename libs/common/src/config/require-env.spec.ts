import {
  assertRequiredEnv,
  optionalEnv,
  requireEnv,
  requireEnvBase64,
  requireEnvInt,
} from './require-env';

describe('requireEnv', () => {
  const orig = process.env;
  afterEach(() => {
    process.env = orig;
  });

  it('returns the value when set', () => {
    process.env = { ...orig, FOO: 'bar' };
    expect(requireEnv('FOO')).toBe('bar');
  });

  it('throws when unset', () => {
    process.env = { ...orig };
    delete process.env['FOO'];
    expect(() => requireEnv('FOO')).toThrow(/Missing required env var "FOO"/);
  });

  it('throws when whitespace-only', () => {
    process.env = { ...orig, FOO: '   ' };
    expect(() => requireEnv('FOO')).toThrow(/Missing/);
  });

  it('trims surrounding whitespace', () => {
    process.env = { ...orig, FOO: '  hello  ' };
    expect(requireEnv('FOO')).toBe('hello');
  });
});

describe('optionalEnv', () => {
  const orig = process.env;
  afterEach(() => {
    process.env = orig;
  });

  it('returns value when set, even if empty string', () => {
    process.env = { ...orig, FOO: '' };
    // Empty string is a legitimate value for "this is set but blank"; only
    // treat unset as "use fallback".
    expect(optionalEnv('FOO', 'fallback')).toBe('');
  });

  it('returns fallback when unset', () => {
    process.env = { ...orig };
    delete process.env['FOO'];
    expect(optionalEnv('FOO', 'fallback')).toBe('fallback');
  });
});

describe('assertRequiredEnv', () => {
  const orig = process.env;
  afterEach(() => {
    process.env = orig;
  });

  it('no-op when all set', () => {
    process.env = { ...orig, A: '1', B: '2' };
    expect(() => assertRequiredEnv(['A', 'B'])).not.toThrow();
  });

  it('aggregates all missing names into one error', () => {
    process.env = { ...orig, A: '1' };
    delete process.env['B'];
    delete process.env['C'];
    expect(() => assertRequiredEnv(['A', 'B', 'C'])).toThrow(
      /Missing required env vars: B, C/,
    );
  });
});

describe('requireEnvInt', () => {
  const orig = process.env;
  afterEach(() => {
    process.env = orig;
  });

  it('parses integer', () => {
    process.env = { ...orig, PORT: '3000' };
    expect(requireEnvInt('PORT')).toBe(3000);
  });

  it('throws on non-integer', () => {
    process.env = { ...orig, PORT: '3.14' };
    expect(() => requireEnvInt('PORT')).toThrow(/must be an integer/);
  });

  it('throws on non-numeric', () => {
    process.env = { ...orig, PORT: 'banana' };
    expect(() => requireEnvInt('PORT')).toThrow(/must be an integer/);
  });

  it('enforces min range', () => {
    process.env = { ...orig, PORT: '50' };
    expect(() => requireEnvInt('PORT', { min: 1024 })).toThrow(/≥ 1024/);
  });

  it('enforces max range', () => {
    process.env = { ...orig, PORT: '99999' };
    expect(() => requireEnvInt('PORT', { max: 65535 })).toThrow(/≤ 65535/);
  });
});

describe('requireEnvBase64', () => {
  const orig = process.env;
  afterEach(() => {
    process.env = orig;
  });

  it('decodes base64', () => {
    const raw = Buffer.from('A'.repeat(32)).toString('base64');
    process.env = { ...orig, KEY: raw };
    const buf = requireEnvBase64('KEY', 32);
    expect(buf.length).toBe(32);
  });

  it('enforces expected byte count', () => {
    const raw = Buffer.from('short').toString('base64');
    process.env = { ...orig, KEY: raw };
    expect(() => requireEnvBase64('KEY', 32)).toThrow(
      /must decode to 32 bytes/,
    );
  });
});
