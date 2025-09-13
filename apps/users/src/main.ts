import { bootstrapService } from "@bootstrap";

import { Config } from "./config";
import { UsersModule } from "./users.module";

void bootstrapService(UsersModule, Config);
