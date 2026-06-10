import { assertRequiredEnv, bootstrapService, QUEUES } from '@app/common';
import { UserAppModule } from './app.module';

assertRequiredEnv(['MONGO', 'MONGO_DB', 'RABBITMQ_URL']);

void bootstrapService(UserAppModule, {
  queue: QUEUES.USER_SERVICE,
  serviceName: 'user',
});
