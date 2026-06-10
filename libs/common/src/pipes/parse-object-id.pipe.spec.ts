import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

const meta = (data?: string): ArgumentMetadata => ({
  type: 'param',
  data,
  metatype: String,
});

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('passes a valid 24-char hex ObjectId through unchanged', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(pipe.transform(id, meta('userId'))).toBe(id);
  });

  it('rejects a non-hex / wrong-length value', () => {
    expect(() => pipe.transform('not-an-id', meta('userId'))).toThrow(
      BadRequestException,
    );
  });

  it('names the offending field in the error', () => {
    try {
      pipe.transform('xyz', meta('friendId'));
      fail('expected throw');
    } catch (err) {
      const res = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
      };
      expect(res.code).toBe('invalid_object_id');
      expect(res.message).toContain('friendId');
    }
  });
});
