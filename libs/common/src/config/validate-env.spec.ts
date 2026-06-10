import 'reflect-metadata';
import { IsOptional, IsString } from 'class-validator';
import { validateEnvWith } from './validate-env';
import { MongoTaskConfig, ServiceConfig } from './base-service.config';

class SampleConfig {
  @IsString()
  REQUIRED!: string;

  @IsOptional()
  @IsString()
  OPTIONAL?: string;
}

describe('validateEnvWith', () => {
  const validate = validateEnvWith(SampleConfig);

  it('returns the raw env object unchanged when all required fields are present', () => {
    const raw = { REQUIRED: 'hello', UNRELATED: 'kept', OPTIONAL: 'opt' };
    expect(validate(raw)).toBe(raw);
  });

  it('does not strip keys not declared on the schema', () => {
    const raw = { REQUIRED: 'x', EXTRA_KEY: 'y' };
    const result = validate(raw);
    expect(result['EXTRA_KEY']).toBe('y');
  });

  it('throws with class name + failing property when a required field is missing', () => {
    expect(() => validate({})).toThrow(/SampleConfig validation failed/);
    expect(() => validate({})).toThrow(/REQUIRED/);
  });

  it('aggregates multiple violations into one error', () => {
    class Multi {
      @IsString() A!: string;
      @IsString() B!: string;
    }
    const v = validateEnvWith(Multi);
    let msg = '';
    try {
      v({});
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/A/);
    expect(msg).toMatch(/B/);
  });

  describe('trim + dequote of raw values', () => {
    it('strips ambient whitespace from string values', () => {
      const raw = { REQUIRED: '  hello\n', OPTIONAL: '\tworld' };
      validate(raw);
      expect(raw.REQUIRED).toBe('hello');
      expect(raw.OPTIONAL).toBe('world');
    });

    it('strips a single matched pair of surrounding quotes', () => {
      const raw = {
        REQUIRED: '"foo@bar.ru"',
        OPTIONAL: "'wrapped'",
      };
      validate(raw);
      expect(raw.REQUIRED).toBe('foo@bar.ru');
      expect(raw.OPTIONAL).toBe('wrapped');
    });

    it('handles the EMAIL_FROM-style nested quote case ("\'foo@bar.ru\'")', () => {
      const raw = { REQUIRED: '"\'foo@bar.ru\'"' };
      validate(raw);
      expect(raw.REQUIRED).toBe("'foo@bar.ru'");
    });

    it('leaves mismatched / unquoted values alone', () => {
      const raw = {
        REQUIRED: 'no-quotes-here',
        OPTIONAL: '"only-leading',
      };
      validate(raw);
      expect(raw.REQUIRED).toBe('no-quotes-here');
      expect(raw.OPTIONAL).toBe('"only-leading');
    });

    it('passes non-string values through untouched', () => {
      const raw: Record<string, unknown> = {
        REQUIRED: 'x',
        EXTRA_NUMBER: 42,
        EXTRA_BOOL: true,
      };
      validate(raw);
      expect(raw.EXTRA_NUMBER).toBe(42);
      expect(raw.EXTRA_BOOL).toBe(true);
    });
  });
});

describe('shared config classes', () => {
  it('ServiceConfig requires MONGO + MONGO_DB + RABBITMQ_URL', () => {
    const validate = validateEnvWith(ServiceConfig);
    expect(() => validate({})).toThrow(/ServiceConfig validation failed/);
    expect(
      validate({
        MONGO: 'mongodb://localhost:27017',
        MONGO_DB: 'app-dev',
        RABBITMQ_URL: 'amqp://localhost:5672',
      }),
    ).toBeDefined();
  });

  it('MongoTaskConfig requires only the Mongo pair', () => {
    const validate = validateEnvWith(MongoTaskConfig);
    expect(() => validate({ MONGO: 'mongodb://x' })).toThrow(/MONGO_DB/);
    expect(
      validate({ MONGO: 'mongodb://x', MONGO_DB: 'app-dev' }),
    ).toBeDefined();
  });
});
