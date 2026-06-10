import { redactSecrets, SECRET_REDACTED } from './redact-secrets';

describe('redactSecrets', () => {
  it('redacts top-level secret-named keys', () => {
    const out = redactSecrets({
      JWT_REFRESH_SECRET: 'shh',
      API_KEY_ID: 'abc',
      SMTP_PASSWORD: 'pw',
      PRIVATE_KEY: '-----PEM-----',
      Authorization: 'Bearer xyz',
      cookie: 'sid=abc',
      benign: 'visible',
    }) as Record<string, string>;

    expect(out['JWT_REFRESH_SECRET']).toBe(SECRET_REDACTED);
    expect(out['API_KEY_ID']).toBe(SECRET_REDACTED);
    expect(out['SMTP_PASSWORD']).toBe(SECRET_REDACTED);
    expect(out['PRIVATE_KEY']).toBe(SECRET_REDACTED);
    expect(out['Authorization']).toBe(SECRET_REDACTED);
    expect(out['cookie']).toBe(SECRET_REDACTED);
    expect(out['benign']).toBe('visible');
  });

  it('walks nested objects + arrays', () => {
    const out = redactSecrets({
      service: 'gateway',
      config: {
        SMTP_HOST: 'mail.x',
        SMTP_PASSWORD: 'pw',
        nested: {
          REFRESH_TOKEN: 'rt',
        },
      },
      headers: [
        { name: 'X-Auth-Token', value: 'leak-me' }, // value is not under a secret key
      ],
    }) as {
      config: {
        SMTP_HOST: string;
        SMTP_PASSWORD: string;
        nested: { REFRESH_TOKEN: string };
      };
    };

    expect(out.config.SMTP_HOST).toBe('mail.x');
    expect(out.config.SMTP_PASSWORD).toBe(SECRET_REDACTED);
    expect(out.config.nested.REFRESH_TOKEN).toBe(SECRET_REDACTED);
  });

  it('does not corrupt primitives, dates, errors, buffers', () => {
    const date = new Date('2026-01-01');
    const err = new Error('boom');
    const buf = Buffer.from('hi');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
    expect(redactSecrets(date)).toBe(date);
    expect(redactSecrets(err)).toBe(err);
    expect(redactSecrets(buf)).toBe(buf);
  });

  it('halts at MAX_DEPTH so a self-referential cycle does not stack-overflow', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });

  it('redacts fingerprint and code_verifier (client-only secrets)', () => {
    const out = redactSecrets({
      // Camel-case and snake-case forms a service might log.
      fingerprint: 'a'.repeat(64),
      deviceFingerprint: 'b'.repeat(64),
      code_verifier: 'pkce-secret',
      codeVerifier: 'pkce-secret-2',
      benign: 'still-visible',
    }) as Record<string, string>;
    expect(out['fingerprint']).toBe(SECRET_REDACTED);
    expect(out['deviceFingerprint']).toBe(SECRET_REDACTED);
    expect(out['code_verifier']).toBe(SECRET_REDACTED);
    expect(out['codeVerifier']).toBe(SECRET_REDACTED);
    expect(out['benign']).toBe('still-visible');
  });
});
