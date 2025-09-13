import { MicroservicesEnum } from "@microservice";

import { buildClientProvider } from "@microservice/lib/build-client-provider";

import { Module } from "@nestjs/common";

import { Config } from "../config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  providers: [
    AuthService,
    buildClientProvider(MicroservicesEnum.AUTH, Config),
    buildClientProvider(MicroservicesEnum.USERS, Config),
  ],
  controllers: [AuthController],
})
export class AuthModule {}
