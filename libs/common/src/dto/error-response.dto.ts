import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Machine-readable error codes the client can branch on for special UI flows.
// Keep this list small and add codes as your domain needs them.
export const ERROR_CODES = {
  // Auth
  TOKEN_EXPIRED: 'token_expired',
  TOKEN_INVALID: 'token_invalid',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',

  // Rate limiting
  RATE_LIMITED: 'rate_limited',

  // Generic
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  VALIDATION_ERROR: 'validation_error',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    example: 'validation_error',
    enum: Object.values(ERROR_CODES),
  })
  code: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({ example: { field: 'email' } })
  details?: Record<string, unknown>;

  @ApiProperty({ example: 'req_01hxyz' })
  requestId: string;
}
