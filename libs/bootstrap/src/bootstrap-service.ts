import process from 'process';
import { useContainer } from 'class-validator';
import { selectConfig } from 'nest-typed-config';
import { AllExceptionsFilter } from '@bootstrap/errors/all-exceptions.filter';
import { EventInterceptor } from '@bootstrap/interceptors/event.interceptor';
import { enableCloudLogging, getLogger, MyLogger } from '@bootstrap/logger';

import { buildClientProvider } from '@microservice/lib/build-client-provider';
import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';
import { RmqDeserializer } from '@microservice/lib/rmq-deserializer';
import { RmqSerializer } from '@microservice/lib/rmq-serializer';

import { HttpModule } from '@nestjs/axios';
import { DynamicModule, Global, Module, Type } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';

import { BaseConfig, ConfigModuleFactory, EnvType } from './base-config';

@Global()
@Module({
  imports: [
    HttpModule.register({
      headers: { 'Accept-Encoding': 'gzip,deflate,compress' },
      global: true,
    }),
  ],
  exports: [HttpModule],
})
export class HttpModuleGlobal {}

export async function bootstrapService<T>(
  module: Type<T>,
  configSchema: typeof BaseConfig,
  noAck = true,
): Promise<void> {
  process.on('unhandledRejection', (reason: unknown) => {
    reason =
      reason instanceof Error
        ? { name: reason?.name, message: reason?.message, stack: reason?.stack }
        : reason;
    getLogger().error(
      JSON.stringify({
        message: 'Unhandled rejection',
        reason,
      }),
    );
  });

  const configModule = ConfigModuleFactory(configSchema);
  const config = selectConfig(configModule, configSchema);
  const allExceptionsFilter = new AllExceptionsFilter(config.serviceName);

  const queue = config.getQueueName();
  @Global()
  @Module({
    providers: [buildClientProvider(config.serviceName, configSchema)],
    exports: [{ provide: config.serviceName, useExisting: CustomAmqpProxy }],
  })
  class ClientRMQModuleGlobal {}

  @Module({
    imports: [
      configModule,
      HttpModuleGlobal,
      module,
      ScheduleModule.forRoot(),
      ClientRMQModuleGlobal,
    ],
    providers: [
      { provide: APP_INTERCEPTOR, useClass: EventInterceptor },
      {
        provide: APP_FILTER,
        useValue: allExceptionsFilter,
      },
    ],
  })
  class BootstrapModule {
    static registerAsync(): DynamicModule {
      return {
        module: BootstrapModule,
        imports: [module, configModule],
      };
    }
  }

  if (config.NODE_ENV !== EnvType.LOCAL) {
    enableCloudLogging();
  }

  await runApp(BootstrapModule, queue, config, noAck);
}

async function runApp<T>(
  module: Type<T>,
  queue: string,
  config: BaseConfig,
  noAck = true,
): Promise<void> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    module,
    {
      transport: Transport.RMQ,
      logger: new MyLogger(),
      options: {
        urls: [config.RABBIT_MQ],
        queue,
        noAck,
        prefetchCount: 10,
        consumerTag: config.POD_NAME,
        serializer: new RmqSerializer(),
        deserializer: new RmqDeserializer(),
        queueOptions: {
          durable: false,
        },
      },
    },
  );

  useContainer(app.select(module), { fallbackOnErrors: true });

  await app.listen();
}
