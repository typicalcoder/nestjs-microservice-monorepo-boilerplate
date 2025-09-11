import { bootstrapService, MicroservicesEnum } from '@bootstrap';

import { AppModule } from './app.module';
import { Config } from './config';

void bootstrapService<MicroservicesEnum.AUTH, AppModule>(AppModule, Config);
