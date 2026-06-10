import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '../enums';

export class TokenPairDto {
  @ApiProperty({
    description:
      'Short-lived JWT for API requests. Expires per JWT_ACCESS_EXPIRES_IN.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NjE...',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Long-lived JWT for token rotation. Single-use — invalidated on refresh.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NjE...',
  })
  refreshToken!: string;
}

/**
 * Security invariant: the response from any auth endpoint MUST
 * NOT carry the device fingerprint back to the client. Fingerprint is a
 * client-only secret — it works as a perpetual recovery key for an
 * autoreg account, so leaking it in a response (logs, mitm-able TLS
 * downgrades, BFF caches) would be a hand-over of that account. Tokens
 * issued from the fingerprint are fine — they have a TTL.
 */
export class AuthResponseDto extends TokenPairDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the authenticated user.',
    example: '507f1f77bcf86cd799439011',
  })
  userId!: string;

  @ApiProperty({
    description:
      'autoreg = anonymous device account; user = registered with email/OAuth.',
    enum: Object.values(AccountType),
    type: String,
    example: AccountType.user,
  })
  accountType!: AccountType;

  @ApiPropertyOptional({
    description:
      'One-time recovery JWT tied to the device. Only returned on autoreg.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NjE...',
  })
  deviceToken?: string;
}
