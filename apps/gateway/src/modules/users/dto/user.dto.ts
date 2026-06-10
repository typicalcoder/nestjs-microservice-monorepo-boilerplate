import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { Locale } from '@app/common';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Display name shown on the profile.',
    example: 'Alex',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone id, used for any per-user date math.',
    example: 'Europe/Moscow',
  })
  @IsOptional()
  @IsString()
  tz?: string;

  @ApiPropertyOptional({
    description: 'App UI language.',
    enum: Object.values(Locale),
    type: String,
    example: Locale.ru,
  })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @ApiPropertyOptional({
    description: 'CDN URL of the user avatar image. HTTPS only.',
    example: 'https://cdn.example.com/avatars/abc123.jpg',
  })
  @IsOptional()
  // Close potential SSRF if a future feature proxies/fetches this URL: lock to
  // HTTPS with a real TLD up-front rather than storing arbitrary schemes.
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  @MaxLength(2048)
  avatarUrl?: string;

  @ApiPropertyOptional({
    description:
      'Set to true once the onboarding flow is fully completed on the client.',
    example: true,
  })
  @IsOptional()
  onboardingCompleted?: boolean;
}
