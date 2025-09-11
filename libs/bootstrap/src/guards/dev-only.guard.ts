import { EnvType } from '@bootstrap/base-config';

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class DevOnly implements CanActivate {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canActivate(_context: ExecutionContext): boolean {
    return process.env.NODE_ENV !== EnvType.PROD;
  }
}
