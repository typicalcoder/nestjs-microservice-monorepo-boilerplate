import { MicroservicesEnum } from '@bootstrap';
import { IsOptional, IsPort, IsString } from 'class-validator';
import { BaseConfig } from '@bootstrap/base-config';

export class Config extends BaseConfig {
  SERVICE_NAME = MicroservicesEnum.GATEWAY;

  @IsString() @IsOptional() SWAGGER_USER?: string;
  @IsString() @IsOptional() SWAGGER_PASS?: string;

  @IsString() AT_SECRET!: string;
  @IsString() RT_SECRET!: string;

  @IsPort() readonly PORT: string = '3000';
}
