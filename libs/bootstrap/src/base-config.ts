import { join } from 'path';
import { MicroservicesEnum } from '@microservice';
import { ClassConstructor } from 'class-transformer';
import { IsEnum, IsOptional, IsPort, IsString, IsUrl } from 'class-validator';
import {
  dotenvLoader,
  selectConfig,
  TypedConfigModule,
} from 'nest-typed-config';
import { LixException } from '@bootstrap/errors';

import { DynamicModule, Injectable } from '@nestjs/common';

export enum EnvType {
  LOCAL = 'LOCAL',
  DEV = 'DEV',
  PROD = 'PROD',
}

@Injectable()
export class BaseConfig {
  @IsEnum(EnvType)
  readonly NODE_ENV!: EnvType;

  @IsUrl({ protocols: ['mongodb', 'mongodb+srv'], require_tld: false })
  @IsOptional()
  readonly MONGO?: string;

  @IsString()
  @IsOptional()
  readonly POD_NAME?: string;

  @IsUrl({ protocols: ['amqp'], require_tld: false })
  readonly RABBIT_MQ!: string;

  @IsPort() @IsOptional() readonly SERVICE_PORT: string = '3000';

  @IsString()
  protected readonly SERVICE_NAME!: MicroservicesEnum;

  get serviceName(): MicroservicesEnum {
    if (
      !Object.values(MicroservicesEnum).includes(
        this.SERVICE_NAME.toUpperCase() as MicroservicesEnum,
      )
    ) {
      throw new LixException('NotValidServiceName');
    }
    return MicroservicesEnum[this.SERVICE_NAME];
  }
  static normalize(config: Record<string, unknown>): Record<string, unknown> {
    return config as unknown as Record<string, unknown>;
  }

  getQueueName(name?: MicroservicesEnum): string {
    return `${this.NODE_ENV}-${name ?? this.serviceName}`.toLowerCase();
  }
}

export function ConfigModuleFactory<T extends typeof BaseConfig>(
  schema: T,
  filepath: string | undefined = undefined,
): DynamicModule {
  return TypedConfigModule.forRoot({
    isGlobal: true,
    schema,
    normalize: (config: Record<string, unknown>): Record<string, unknown> =>
      schema.normalize(config),
    load: [
      dotenvLoader({
        envFilePath:
          filepath ??
          join(process.cwd(), './secrets/.env').replace('/dist', ''),
        ignoreEnvVars: false,
      }),
    ],
  });
}

export function getConfig<T extends typeof BaseConfig>(configSchema: T): T {
  return selectConfig(
    ConfigModuleFactory(configSchema),
    configSchema as unknown as ClassConstructor<T>,
  );
}
