import { BaseConfig } from "@bootstrap/base-config";
import { MicroservicesEnum } from "@microservice";
import { IsUrl } from "class-validator";

export class Config extends BaseConfig {
  @IsUrl({ protocols: ["mongodb", "mongodb+srv"], require_tld: false })
  readonly MONGO: string;

  SERVICE_NAME = MicroservicesEnum.USERS;
}
