import { MicroservicesEnum } from '@bootstrap';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.CORE;
}
