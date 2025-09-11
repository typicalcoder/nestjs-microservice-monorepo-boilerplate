import {
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
} from '@microservice/lib/commands/auth/request-code.command-payload';

import {
  AuthenticateCommandRequestPayload,
  AuthenticateCommandResponsePayload,
} from './authenticate.command-payload';
import {
  RefreshTokenCommandRequestPayload,
  RefreshTokenCommandResponsePayload,
} from './refresh-token.command-payload';

export * from './authenticate.command-payload';
export * from './refresh-token.command-payload';

export enum AuthCommands {
  authenticate = 'auth.authenticate',
  refreshToken = 'auth.refreshToken',
  requestCode = 'auth.requestCode',
}

export type AuthCommandPayload<T extends AuthCommands> =
  T extends AuthCommands.authenticate
    ? {
        req: AuthenticateCommandRequestPayload;
        resp: AuthenticateCommandResponsePayload;
      }
    : T extends AuthCommands.refreshToken
      ? {
          req: RefreshTokenCommandRequestPayload;
          resp: RefreshTokenCommandResponsePayload;
        }
      : T extends AuthCommands.requestCode
        ? {
            req: RequestCodeCommandRequestPayload;
            resp: RequestCodeCommandResponsePayload;
          }
        : never;

export const AuthCommandTypeMap = {
  AuthenticateCommandResponsePayload,
  AuthenticateCommandRequestPayload,
  RefreshTokenCommandResponsePayload,
  RefreshTokenCommandRequestPayload,
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
};
