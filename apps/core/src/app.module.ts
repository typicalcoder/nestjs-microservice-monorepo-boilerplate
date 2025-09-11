import { MicroservicesEnum } from '@bootstrap';

import { buildClientProvider } from '@microservice/lib/build-client-provider';

import { defineConfig, MongoDriver } from '@mikro-orm/mongodb';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Config } from './config';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      inject: [Config],
      driver: MongoDriver,
      useFactory: (config: Config) => ({
        ...defineConfig({
          clientUrl: config.MONGO,
          allowGlobalContext: true,
          ensureIndexes: true,
          ensureDatabase: true,
          dbName: `${config.NODE_ENV.toLowerCase()}-buddjet-${config.SERVICE_NAME.toLowerCase()}`,
        }),
        autoLoadEntities: true,
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService, buildClientProvider(MicroservicesEnum.AUTH, Config)],
})
export class AppModule {}
