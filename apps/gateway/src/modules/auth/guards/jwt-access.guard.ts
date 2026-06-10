import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_CODES } from '@app/common';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

@Injectable()
export class JwtAccessGuard extends AuthGuard('jwt-access') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: Error | null, user: T, info?: unknown): T {
    if (err || !user) {
      // passport-jwt reports verification failures via `info`, not `err`.
      // Distinguish an expired-but-otherwise-valid access token so the
      // client knows to hit /auth/refresh instead of forcing a re-login
      // (docs/AUTH-FLOW.md — the client branches on this code).
      if ((info as Error | undefined)?.name === 'TokenExpiredError') {
        throw new UnauthorizedException({
          code: ERROR_CODES.TOKEN_EXPIRED,
          message: 'Access token expired — refresh it',
        });
      }
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Authentication required',
      });
    }
    return user;
  }
}
