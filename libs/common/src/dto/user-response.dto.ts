import { ApiProperty } from '@nestjs/swagger';
import { AccountType, Locale } from '../enums';

/**
 * User profile DTO — the shape returned by `GET /v1/users/me` and embedded in
 * auth responses. Built from the User entity by UsersService.toDto(). Add your
 * own profile fields here and in the entity / toDto mapping together.
 */
export class UserDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the user.',
    example: '507f1f77bcf86cd799439011',
  })
  id!: string;

  @ApiProperty({
    description:
      'autoreg = anonymous device account; user = registered with email/OAuth.',
    enum: Object.values(AccountType),
    type: String,
    example: AccountType.autoreg,
  })
  accountType!: AccountType;

  @ApiProperty({
    description: 'Email address. Null for anonymous autoreg accounts.',
    nullable: true,
    type: String,
    example: 'user@example.com',
  })
  email!: string | null;

  @ApiProperty({
    description: 'Display name shown on the profile screen.',
    example: 'Alex',
  })
  name!: string;

  @ApiProperty({
    description: 'IANA timezone used for any per-user date math.',
    example: 'Europe/Moscow',
  })
  tz!: string;

  @ApiProperty({
    description: 'App UI language. Drives copy and date formatting.',
    enum: Object.values(Locale),
    type: String,
    example: Locale.ru,
  })
  locale!: Locale;

  @ApiProperty({
    description: 'CDN URL of the user avatar. Null when not set.',
    nullable: true,
    type: String,
    example: null,
  })
  avatarUrl!: string | null;

  @ApiProperty({
    description:
      'True when the client has finished onboarding. Set via PATCH /v1/users/me with `{ onboardingCompleted: true }`.',
    example: false,
  })
  onboardingCompleted!: boolean;

  @ApiProperty({
    description: 'ISO-8601 account creation timestamp.',
    example: '2026-04-01T08:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'ISO-8601 last profile update timestamp.',
    example: '2026-04-24T10:00:00.000Z',
  })
  updatedAt!: string;
}

export class SuccessDto {
  @ApiProperty({
    description:
      'Always true. Indicates the operation completed without errors.',
    example: true,
  })
  success!: boolean;
}
