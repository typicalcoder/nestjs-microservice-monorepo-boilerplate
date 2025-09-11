import { I18nContext } from 'nestjs-i18n';
import { LixException } from '@bootstrap/errors';
import { LixRequest } from '@bootstrap/types';

import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AtGuard extends AuthGuard('jwt-access') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipAtGuard: boolean | undefined = this.reflector.getAllAndOverride(
      'skipAtGuard',
      [context.getHandler(), context.getClass()],
    );

    if (skipAtGuard) {
      return true;
    }

    const isPublic: boolean | undefined = this.reflector.getAllAndOverride(
      'isPublic',
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    // TODO: check if Auth header empty drop grace error
    const http = context.switchToHttp();
    const request = http.getRequest<LixRequest>();

    if ('authorization' in request.headers) {
      return (await super.canActivate(context)) as boolean;
    } else {
      throw new LixException(
        'AuthorizationTokenFailed',
        HttpStatus.UNAUTHORIZED,
        I18nContext.current().t('error.authorization'),
      );
    }
  }
}
