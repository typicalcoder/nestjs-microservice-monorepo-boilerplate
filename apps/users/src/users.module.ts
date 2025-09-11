import { defineConfig, MongoDriver } from '@mikro-orm/mongodb';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { Config } from './config';
import { RepositoryModule } from './repository/repository.module';
import { UsersService } from './users.service';

@Module({
  imports: [
    RepositoryModule,
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
  controllers: [],
  providers: [UsersService],
})
export class UsersModule {}
