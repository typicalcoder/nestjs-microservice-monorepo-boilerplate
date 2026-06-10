import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoClient, type Db } from 'mongodb';
import { MongoTaskConfig, requireEnv, validateEnvWith } from '@app/common';
import { DbMigrateTask, MONGO_DB_TOKEN } from './task.service';

/**
 * Wrapper that owns the MongoClient lifecycle. We deliberately bypass
 * MikroORM here — entity-aware ORMs run `ensureIndexes()` on init in
 * dev, which would race the migration runner: a pending dedup migration
 * (e.g. a de-duplication migration) cannot create the unique index it
 * targets while duplicates are still in the collection, so the ORM
 * crash-loops the pod before the migration ever gets to clean them up.
 *
 * Raw `mongodb` driver, no entity definitions, no index sync.
 */
class MongoDbProvider implements OnApplicationShutdown {
  constructor(
    private readonly client: MongoClient,
    public readonly db: Db,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvWith(MongoTaskConfig),
    }),
  ],
  providers: [
    {
      provide: MongoDbProvider,
      useFactory: async (): Promise<MongoDbProvider> => {
        const client = new MongoClient(requireEnv('MONGO'));
        await client.connect();
        return new MongoDbProvider(client, client.db(requireEnv('MONGO_DB')));
      },
    },
    {
      provide: MONGO_DB_TOKEN,
      useFactory: (provider: MongoDbProvider): Db => provider.db,
      inject: [MongoDbProvider],
    },
    DbMigrateTask,
  ],
})
export class DbMigrateModule {}
