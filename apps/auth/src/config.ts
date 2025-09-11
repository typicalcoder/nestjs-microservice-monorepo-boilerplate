import { MicroservicesEnum } from '@bootstrap';
import { IsString, IsUrl } from 'class-validator';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.AUTH;

  @IsString() AT_SECRET!: string;
  @IsString() RT_SECRET!: string;
  @IsString() JWT_LIFETIME!: string;

  @IsString() YC_SMART_CAPTCHA_KEY!: string;

  @IsUrl({ protocols: ['mongodb', 'mongodb+srv'], require_tld: false })
  readonly MONGO: string;

  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  readonly REDIS_URL: string;
}
