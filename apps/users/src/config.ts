import { MicroservicesEnum } from '@bootstrap';
import { IsUrl } from 'class-validator';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.USERS;

  @IsUrl({ protocols: ['mongodb', 'mongodb+srv'], require_tld: false })
  readonly MONGO: string;
}
