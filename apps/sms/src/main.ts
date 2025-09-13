import { bootstrapService } from "@bootstrap";

import { Config } from "./config";
import { SmsModule } from "./sms.module";

void bootstrapService(SmsModule, Config);
