import { MicroservicesEnum } from "@microservice";

import { buildClientProvider } from "@microservice/lib/build-client-provider";

import KeyvRedis, { RedisClientOptions } from "@keyv/redis";
import { defineConfig, MongoDriver } from "@mikro-orm/mongodb";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { CacheModule } from "@nestjs/cache-manager";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { Config } from "./config";
import { RefreshTokenEntity } from "./refresh/refresh-token.entity";
import { RefreshService } from "./refresh/refresh.service";

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
    MikroOrmModule.forFeature([RefreshTokenEntity]),
    JwtModule.register({}),
    CacheModule.registerAsync({
      inject: [Config],
      isGlobal: true,
      useFactory: (config: Config) => ({
        stores: [
          new KeyvRedis({
            url: config.REDIS_URL,
            socket: {
              keepAlive: true,
              connectTimeout: 5000,
            },
          } as RedisClientOptions),
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    buildClientProvider(MicroservicesEnum.USERS, Config),
    buildClientProvider(MicroservicesEnum.SMS, Config),
    RefreshService,
  ],
})
export class AppModule {}
