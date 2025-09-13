import { BaseConfig } from "@bootstrap/base-config";
import { MicroservicesEnum } from "@microservice";

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.CORE;
}
