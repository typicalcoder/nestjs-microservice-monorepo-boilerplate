import { BaseConfig } from "@bootstrap/base-config";
import { MicroservicesEnum } from "@microservice";
import { IsOptional, IsPort, IsString } from "class-validator";

export class Config extends BaseConfig {
  @IsString() @IsOptional() SWAGGER_USER?: string;
  @IsString() @IsOptional() SWAGGER_PASS?: string;

  @IsString() AT_SECRET!: string;
  @IsString() RT_SECRET!: string;

  @IsPort() readonly PORT: string = "3000";

  SERVICE_NAME = MicroservicesEnum.GATEWAY;
}
