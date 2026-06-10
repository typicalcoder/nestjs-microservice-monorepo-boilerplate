import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ServiceConfig } from '@app/common';

/**
 * Typed env schema for the user microservice. Inherits Mongo + RabbitMQ
 * fields from `ServiceConfig` and declares the transactional-email (SMTP)
 * credentials it touches.
 *
 * SMTP is optional — if `SMTP_HOST` is unset, `EmailService` runs in stub
 * mode and logs instead of sending. When set, `SMTP_PORT` becomes required
 * and `SMTP_PASSWORD` becomes required iff `SMTP_USER` is set.
 */
export class UserConfig extends ServiceConfig {
  // ── SMTP (optional — stub mode when SMTP_HOST is empty) ──────────────
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) =>
    value === undefined || value === ''
      ? undefined
      : parseInt(value as string, 10),
  )
  @ValidateIf((c: UserConfig) => !!c.SMTP_HOST)
  SMTP_PORT?: number;

  @IsOptional()
  @IsIn(['true', 'false', ''], {
    message: 'SMTP_SECURE must be "true", "false", or unset',
  })
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsString()
  @ValidateIf((c: UserConfig) => !!c.SMTP_USER)
  SMTP_PASSWORD?: string;

  // Accepts any string that contains an email address; nodemailer parses the
  // From header itself, so we just need to ensure there is *something* shaped
  // like an email. Tolerates bare addresses and display-name forms.
  @IsString()
  @Matches(/[^@\s]+@[^@\s]+\.[^@\s]+/, {
    message: 'EMAIL_FROM must contain a valid email address',
  })
  @ValidateIf((c: UserConfig) => !!c.EMAIL_FROM)
  EMAIL_FROM?: string;
}
