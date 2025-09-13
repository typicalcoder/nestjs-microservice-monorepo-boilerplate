import { bootstrapService } from "@bootstrap";

import { AppModule } from "./app.module";
import { Config } from "./config";

void bootstrapService(AppModule, Config);
