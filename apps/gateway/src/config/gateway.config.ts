import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Typed env schema for the gateway. Instantiated and class-validated inside
 * `ConfigModule.forRoot({ validate })` so misconfiguration surfaces at
 * boot time with a single aggregated error, and hot paths can inject a
 * typed `GatewayConfig` instead of sprinkling `config.get('VK_...')`
 * calls across services.
 */
export class GatewayConfig {
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value as string, 10))
  PORT: number = 3000;

  @IsString()
  NODE_ENV: string = 'development';

  // Gateway is an HTTP edge proxy — no direct Mongo access. MONGO/MONGO_DB
  // intentionally NOT declared here; the microservices own the data layer.

  @IsString()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsUrl({ require_tld: false, protocols: ['amqp', 'amqps'] })
  RABBITMQ_URL: string = 'amqp://localhost:5672';

  // See ServiceConfig for the full comment. Declared here too because gateway
  // doesn't extend ServiceConfig (no Mongo), but still calls getQueuePrefix().
  @IsOptional()
  @IsString()
  RMQ_QUEUE_PREFIX?: string;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_DEVICE_SECRET!: string;

  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '30d';

  @IsString()
  JWT_DEVICE_EXPIRES_IN: string = '365d';

  // ── VK OAuth ────────────────────────────────────────────────
  // VK ID issues a DIFFERENT App ID per mobile platform (Android / iOS),
  // and the verifier accepts BOTH as valid `aud` on incoming idTokens —
  // Android clients mint tokens with `aud=VK_ANDROID_APP_ID`, iOS clients
  // with `aud=VK_IOS_APP_ID`. Both MUST be set in prod or cross-platform
  // logins break silently. Numeric strings, public identifiers, single
  // values across all stages (VK Developers Console → Приложения).
  @IsString()
  @Matches(/^\d+$/, { message: 'VK_ANDROID_APP_ID must be numeric' })
  VK_ANDROID_APP_ID!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'VK_IOS_APP_ID must be numeric' })
  VK_IOS_APP_ID!: string;

  // Optional URL overrides — defaults baked into the verifier services.
  // Override only to point at a VK staging environment or a pinned mirror.
  @IsOptional()
  @IsUrl()
  VK_PUBLIC_INFO_URL?: string;

  @IsOptional()
  @IsUrl()
  VK_USERINFO_URL?: string;

  @IsOptional()
  @IsUrl()
  YANDEX_USERINFO_URL?: string;

  // VK server-to-server service tokens. NOT user-OAuth — kept for future
  // flows that hit api.vk.com without a user context (see
  // VkOAuthVerifierService docstring for why they don't work on
  // /v1/auth/oauth/vk). Opaque strings, optional.
  @IsOptional()
  @IsString()
  VK_ANDROID_SERVICE_TOKEN?: string;

  @IsOptional()
  @IsString()
  VK_IOS_SERVICE_TOKEN?: string;

  /** Convenience for verifiers — returns both platform VK audiences. */
  get vkAudiences(): [string, string] {
    return [this.VK_ANDROID_APP_ID, this.VK_IOS_APP_ID];
  }
}
