import { BaseConfig } from "@bootstrap/base-config";
import { MicroservicesEnum } from "@microservice";
import { IsString } from "class-validator";

export class Config extends BaseConfig {
  @IsString() SMSRU_API_KEY!: string;

  SERVICE_NAME = MicroservicesEnum.SMS;
}
