import { assertRequiredEnv, bootstrapTask } from '@app/common';
import { DbMigrateModule } from './app.module';
import { DbMigrateTask } from './task.service';

assertRequiredEnv(['MONGO', 'MONGO_DB']);

void bootstrapTask(
  DbMigrateModule,
  { serviceName: 'task:db-migrate' },
  async (app) => {
    await app.get(DbMigrateTask).run();
  },
);
