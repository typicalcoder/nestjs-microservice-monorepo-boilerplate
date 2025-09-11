import {
  AuthCommands,
  AuthenticateCommandRequestPayload,
  AuthenticateCommandResponsePayload,
  MicroservicesEnum,
  RefreshTokenCommandRequestPayload,
  RefreshTokenCommandResponsePayload,
} from '@microservice';
import { Observable } from 'rxjs';

import {
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
} from '@microservice/lib/commands/auth/request-code.command-payload';
import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';

import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  constructor(
    @Inject(MicroservicesEnum.AUTH)
    private readonly clientAuth: CustomAmqpProxy<MicroservicesEnum.AUTH>,
  ) {}

  code(
    dto: RequestCodeCommandRequestPayload,
  ): Observable<RequestCodeCommandResponsePayload> {
    return this.clientAuth.message(AuthCommands.requestCode, dto);
  }

  auth(
    data: AuthenticateCommandRequestPayload,
  ): Observable<AuthenticateCommandResponsePayload> {
    return this.clientAuth.message(AuthCommands.authenticate, data);
  }

  refresh(
    userId: string,
    refreshToken: string,
  ): Observable<RefreshTokenCommandResponsePayload> {
    return this.clientAuth.message(
      AuthCommands.refreshToken,
      new RefreshTokenCommandRequestPayload(refreshToken, userId),
    );
  }
}
