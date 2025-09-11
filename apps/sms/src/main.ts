import { bootstrapService, MicroservicesEnum } from '@bootstrap';

import { Config } from './config';
import { SmsModule } from './sms.module';

void bootstrapService<MicroservicesEnum.SMS, SmsModule>(SmsModule, Config);
