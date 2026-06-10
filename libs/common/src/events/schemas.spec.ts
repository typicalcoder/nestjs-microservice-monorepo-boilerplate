import { parseUserDeleted } from './schemas';

describe('parseUserDeleted', () => {
  it('accepts a well-formed payload', () => {
    expect(parseUserDeleted({ userId: 'u1' })).toEqual({ userId: 'u1' });
  });

  it('ignores extra fields', () => {
    expect(parseUserDeleted({ userId: 'u1', extra: 'x' })).toEqual({
      userId: 'u1',
    });
  });

  it('returns null for a missing / empty userId', () => {
    expect(parseUserDeleted({})).toBeNull();
    expect(parseUserDeleted({ userId: '' })).toBeNull();
    expect(parseUserDeleted({ userId: 42 })).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseUserDeleted(null)).toBeNull();
    expect(parseUserDeleted(undefined)).toBeNull();
    expect(parseUserDeleted('u1')).toBeNull();
    expect(parseUserDeleted(7)).toBeNull();
  });
});
