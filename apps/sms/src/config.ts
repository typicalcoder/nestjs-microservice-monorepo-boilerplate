import { MicroservicesEnum } from '@bootstrap';
import { IsString } from 'class-validator';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.SMS;

  @IsString() SMSRU_API_KEY!: string;
}
