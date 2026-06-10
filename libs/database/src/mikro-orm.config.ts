import { defineConfig } from '@mikro-orm/mongodb';
import { MongoDriver } from '@mikro-orm/mongodb';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { ENTITIES } from './database.module';

// Used only by the MikroORM CLI (`pnpm exec mikro-orm ...`) for ad-hoc
// schema operations. Runtime entity registration goes through
// `DatabaseModule.forRoot` — single source of truth for the entity list
// lives there as `ENTITIES`, imported here to avoid drift.

const mongoUri = process.env['MONGO'] ?? 'mongodb://localhost:27017';
const dbName = process.env['MONGO_DB'] ?? 'app-dev';

export default defineConfig({
  driver: MongoDriver,
  metadataProvider: ReflectMetadataProvider,
  clientUrl: mongoUri,
  dbName,
  entities: ENTITIES,
  allowGlobalContext: false,
  ensureIndexes: true,
  ensureDatabase: true,
});
