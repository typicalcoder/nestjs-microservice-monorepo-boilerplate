import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MongoDriver } from '@mikro-orm/mongodb';
import { defineConfig } from '@mikro-orm/core';
import { MongoTaskConfig, requireEnv, validateEnvWith } from '@app/common';
import { User } from './entities/user.entity';
import { Device } from './entities/device.entity';
import { OutboxEvent } from './entities/outbox-event.entity';

export interface DatabaseModuleOptions {
  uri: string;
  dbName: string;
}

const ENTITIES = [User, Device, OutboxEvent];

@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      imports: [
        MikroOrmModule.forRoot(
          defineConfig({
            driver: MongoDriver,
            clientUrl: options.uri,
            dbName: options.dbName,
            entities: ENTITIES,
            allowGlobalContext: false,
            // Auto-sync indexes / DB in dev only. Prod schema changes go
            // through the explicit db-migrate task.
            ensureIndexes: process.env['NODE_ENV'] !== 'production',
            ensureDatabase: process.env['NODE_ENV'] !== 'production',
          }),
        ),
      ],
    };
  }

  static forFeature(entities: Parameters<typeof MikroOrmModule.forFeature>[0]) {
    return MikroOrmModule.forFeature(entities);
  }

  /**
   * Standard task-app bootstrap: validates MONGO + MONGO_DB env vars
   * against MongoTaskConfig, brings up the MikroORM connection, and
   * registers the entity repositories the task touches.
   *
   * `db-migrate` deliberately does NOT use this — it bypasses MikroORM
   * entirely (raw MongoClient) so `ensureIndexes` can't race the
   * migration runner. See tasks/db-migrate/src/app.module.ts.
   */
  static forTask(
    entities: Parameters<typeof MikroOrmModule.forFeature>[0],
  ): Array<DynamicModule | Promise<DynamicModule>> {
    return [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['.env.local', '.env'],
        validate: validateEnvWith(MongoTaskConfig),
      }),
      DatabaseModule.forRoot({
        uri: requireEnv('MONGO'),
        dbName: requireEnv('MONGO_DB'),
      }),
      MikroOrmModule.forFeature(entities),
    ];
  }
}

export { ENTITIES };
