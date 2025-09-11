import { MicroservicesEnum } from '@microservice';
import { IsString } from 'class-validator';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  @IsString() SMSRU_API_KEY!: string;

  SERVICE_NAME = MicroservicesEnum.SMS;
}
