import { MicroservicesEnum } from '@microservice';

import { buildClientProvider } from '@microservice/lib/build-client-provider';

import { Module } from '@nestjs/common';

import { Config } from '../config';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  providers: [
    UserService,
    buildClientProvider(MicroservicesEnum.USERS, Config),
  ],
  controllers: [UserController],
})
export class UserModule {}
