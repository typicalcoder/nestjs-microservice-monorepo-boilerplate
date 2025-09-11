import {
  AuthCommands,
  AuthenticateCommandRequestPayload,
  AuthenticateCommandResponsePayload,
  RefreshTokenCommandRequestPayload,
  RefreshTokenCommandResponsePayload,
} from '@microservice';

import {
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
} from '@microservice/lib/commands/auth/request-code.command-payload';

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern(AuthCommands.authenticate)
  auth(
    @Payload() data: AuthenticateCommandRequestPayload,
  ): Promise<AuthenticateCommandResponsePayload> {
    return this.appService.auth(data);
  }

  @MessagePattern(AuthCommands.refreshToken)
  refresh(
    @Payload() data: RefreshTokenCommandRequestPayload,
  ): Promise<RefreshTokenCommandResponsePayload> {
    return this.appService.refresh(data);
  }

  @MessagePattern(AuthCommands.requestCode)
  requestCode(
    @Payload() data: RequestCodeCommandRequestPayload,
  ): Promise<RequestCodeCommandResponsePayload> {
    return this.appService.requestCode(data);
  }
}
