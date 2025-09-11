import process from 'process';
import { HttpModuleGlobal } from '@bootstrap';
import { MicroservicesEnum } from '@microservice';
import { useContainer } from 'class-validator';
import compression from 'compression';
import { selectConfig } from 'nest-typed-config';
import { ConfigModuleFactory } from '@bootstrap/base-config';
import { LixException } from '@bootstrap/errors';
import { AllExceptionsFilter } from '@bootstrap/errors/all-exceptions.filter';
import { AtGuard } from '@bootstrap/guards';
import { AtModule, RtModule } from '@bootstrap/guards/at/strategies';
import { EventInterceptor } from '@bootstrap/interceptors/event.interceptor';
import { TransformResponseInterceptor } from '@bootstrap/interceptors/transform-response.interceptor';
import { getLogger, MyLogger } from '@bootstrap/logger';

import { buildClientProvider } from '@microservice/lib/build-client-provider';
import { RmqDeserializer } from '@microservice/lib/rmq-deserializer';
import { RmqSerializer } from '@microservice/lib/rmq-serializer';

import {
  DynamicModule,
  HttpStatus,
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  NestFactory,
} from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { FallbackController } from './common/fallback.controller';
import { HandleUserInterceptor } from './common/interceptors/handle-user.interceptor';
import { AsyncStorageMiddleware } from './common/middlewares/async-storage.middleware';
import { RequestLoggingMiddleware } from './common/middlewares/request-logging.middleware';
import { setupSwagger } from './common/swagger/setup-swagger';
import { Config } from './config';
import { GatewayModule } from './gateway.module';

async function bootstrap(): Promise<void> {
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

  const configModule = ConfigModuleFactory(Config);

  const config = selectConfig(configModule, Config);
  @Module({
    imports: [
      configModule,
      HttpModuleGlobal,
      GatewayModule,
      AtModule.register({ AT_SECRET: config.AT_SECRET }),
      RtModule.register({ RT_SECRET: config.RT_SECRET }),
    ],
    controllers: [FallbackController],
    providers: [
      buildClientProvider(MicroservicesEnum.USERS, Config),
      { provide: APP_INTERCEPTOR, useClass: HandleUserInterceptor },
      {
        provide: AtGuard,
        useClass: AtGuard,
      },
      {
        provide: APP_GUARD,
        useClass: AtGuard,
      },
      {
        provide: APP_FILTER,
        useValue: new AllExceptionsFilter(config.serviceName),
      },
      { provide: APP_INTERCEPTOR, useClass: EventInterceptor },
      { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
    ],
  })
  class BootstrapModule implements NestModule {
    static registerAsync(): DynamicModule {
      return {
        module: BootstrapModule,
        imports: [GatewayModule, configModule],
      };
    }

    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AsyncStorageMiddleware).forRoutes('{*path}');
      consumer.apply(RequestLoggingMiddleware).forRoutes('{*path}');
    }
  }

  const app = await NestFactory.create(BootstrapModule, {
    logger: new MyLogger(),
    rawBody: true,
    bodyParser: true,
    cors: true,
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBIT_MQ],
      queue: config.getQueueName(),
      serializer: new RmqSerializer(),
      deserializer: new RmqDeserializer(),
      consumerTag: config.POD_NAME,
      prefetchCount: 10,
      noAck: true,
      queueOptions: {
        durable: false,
      },
    },
  });

  await app.startAllMicroservices();

  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: (errors): LixException =>
        new LixException(
          'ValidationError',
          HttpStatus.NOT_ACCEPTABLE,
          errors.flatMap(err => Object.values(err.constraints)).join(', '),
          errors,
        ),
    }),
  );
  useContainer(app.select(GatewayModule), { fallbackOnErrors: true });
  app.enableVersioning();
  app.enableShutdownHooks();
  app.use(compression());
  setupSwagger(app, config, { name: 'BuddJet', version: '1.0' });

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.listen(config.PORT ?? 3000);
}
void bootstrap();
