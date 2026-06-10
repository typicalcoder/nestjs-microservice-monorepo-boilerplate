import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { Platform, UpgradeMethod } from '@app/common';

export class AutoregDto {
  @ApiProperty({
    description:
      'SHA-256 of stable device identifiers. Used as idempotency key — same device always gets same account.',
    minLength: 32,
    maxLength: 256,
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  })
  @IsString()
  @IsNotEmpty()
  // A common client persists `Uuid().v4()` (36 chars with dashes,
  // see lib/src/core/infrastructure/auth/device_fingerprint.dart).
  // Server doc historically said "SHA-256 hex (64 chars)" but the
  // client never produced that — backend just never enforced shape.
  // Allow 32–256 chars to keep both formats accepted (and absorb
  // future client hash bumps like MD5/SHA-512).
  @Length(32, 256, {
    message: 'deviceFingerprint must be 32–256 chars',
  })
  // restrict to hex + dash. Pre-fix any 32-256
  // char string was accepted; arbitrary symbols never come from a
  // legitimate client and let an attacker store junk in the Device
  // index. Dashes are needed for the canonical UUID v4 form
  // `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` a UUID-v4 client emits.
  @Matches(/^[a-fA-F0-9-]+$/, {
    message: 'deviceFingerprint must be hexadecimal (UUID v4 also accepted)',
  })
  deviceFingerprint!: string;

  @ApiPropertyOptional({
    description:
      'Mobile OS of the device. Used for analytics and push routing.',
    enum: Object.values(Platform),
    type: String,
    example: Platform.android,
  })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({
    description: 'Client app version string for telemetry.',
    example: '1.0.3',
  })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({
    description:
      'Play Integrity / DeviceCheck attestation token. Optional in MVP; required in v2 anti-abuse.',
    example: 'ey...',
  })
  @IsOptional()
  @IsString()
  integrityToken?: string;
}

export class LoginDto {
  @ApiProperty({
    description: 'Registered email address.',
    example: 'user@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Account password.',
    example: 'MySecret1!',
  })
  @IsNotEmpty()
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({
    description:
      'Email of the account to reset. Response is always 200 to prevent user enumeration.',
    example: 'user@example.com',
  })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Short-lived token from the password reset email. Single-use.',
    example: 'abc123def456',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    description: 'New password. Min 8 characters.',
    minLength: 8,
    example: 'NewSecret2@',
  })
  @MinLength(8)
  password!: string;
}

export class OAuthDto {
  @ApiPropertyOptional({
    description:
      'JWT id_token from Google or Apple Sign-In. Required for those providers.',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString()
  idToken?: string;

  @ApiPropertyOptional({
    description:
      'Access token from VK or Yandex OAuth. Required for those providers.',
    example: 'vk1.a.xxxxxxxx',
  })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiPropertyOptional({
    description:
      'Email hint from the OAuth provider. Used to link accounts by email.',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Display name from the OAuth provider. Used on first registration.',
    example: 'Алексей',
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class UpgradeAccountDto {
  @ApiProperty({
    description:
      'Auth method to link. email = set email+password; others = link OAuth provider.',
    enum: Object.values(UpgradeMethod),
    type: String,
    example: UpgradeMethod.email,
  })
  @IsEnum(UpgradeMethod)
  method!: UpgradeMethod;

  @ApiPropertyOptional({
    description: 'Required when method=email.',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Required when method=email. Min 8 characters.',
    example: 'MySecret1!',
  })
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    description: 'Display name to set. Optional for all methods.',
    example: 'Алексей',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @ApiPropertyOptional({
    description:
      'id_token (Google/Apple) or access_token (VK/Yandex) for OAuth methods.',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString()
  oauthToken?: string;
}

export class LogoutDto {
  @ApiProperty({
    description:
      'Refresh token to invalidate. All sessions sharing this token are revoked.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export { AuthResponseDto, TokenPairDto } from '@app/common';
