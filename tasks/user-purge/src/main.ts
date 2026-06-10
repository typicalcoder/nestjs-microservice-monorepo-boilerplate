import { assertRequiredEnv, bootstrapTask } from '@app/common';
import { UserPurgeModule } from './app.module';
import { UserPurgeTask } from './task.service';

assertRequiredEnv(['MONGO', 'MONGO_DB']);

void bootstrapTask(
  UserPurgeModule,
  { serviceName: 'task:user-purge' },
  async (app) => {
    await app.get(UserPurgeTask).run();
  },
);
