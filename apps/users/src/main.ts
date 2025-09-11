import { bootstrapService, MicroservicesEnum } from '@bootstrap';

import { Config } from './config';
import { UsersModule } from './users.module';

void bootstrapService<MicroservicesEnum.AUTH, UsersModule>(UsersModule, Config);
