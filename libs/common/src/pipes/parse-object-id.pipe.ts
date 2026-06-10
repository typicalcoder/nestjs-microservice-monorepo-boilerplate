import {
  ArgumentMetadata,
  BadRequestException,
  PipeTransform,
} from '@nestjs/common';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * Validate that a route parameter is shaped like a Mongo ObjectId
 * (24 hex chars). Defends the gateway against forwarding obviously
 * invalid identifiers to the worker services where they'd otherwise
 * be caught by `parseObjectId(...)` after a wasted RMQ round-trip.
 *
 * gateway-level filter so junk input shorts out
 * before reaching the message bus.
 *
 * Returns the value unchanged on success (we don't construct an
 * ObjectId here — the worker does, and types stay string at the
 * controller boundary so DTO/serialization plumbing stays simple).
 */
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !OBJECT_ID_RE.test(value)) {
      const field = metadata.data ?? 'id';
      throw new BadRequestException({
        statusCode: 400,
        code: 'invalid_object_id',
        message: `${field} must be a 24-character hexadecimal string`,
      });
    }
    return value;
  }
}
