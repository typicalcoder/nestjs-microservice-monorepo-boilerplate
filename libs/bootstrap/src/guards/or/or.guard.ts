import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  mixin,
  Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { LixException } from '../../errors';

export function OrGuard(guards: Type<CanActivate>[]): Type<CanActivate> {
  class OrMixinGuard implements CanActivate {
    private guards: CanActivate[] = [];

    constructor(@Inject(ModuleRef) private readonly modRef: ModuleRef) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      this.guards = guards.map(guard =>
        this.modRef.get(guard, { strict: false }),
      );

      const canActivateReturns = (
        await Promise.all(
          this.guards.map(async guard => {
            try {
              return await guard.canActivate(context);
            } catch (e: unknown) {
              if (e['__internal_type'] === 'LixException') {
                return e as LixException;
              } else {
                return new LixException(
                  'UNAUTHORIZED',
                  HttpStatus.UNAUTHORIZED,
                  'Unable to check auth status',
                  e,
                );
              }
            }
          }),
        )
      ).map(x => (x instanceof Boolean || typeof x === 'boolean' ? +x : x));

      const resolved = !!canActivateReturns.find(x => x === 1);
      if (resolved) {
        return true;
      } else {
        const errors: LixException[] = canActivateReturns
          .filter(x => x !== 0 && x !== 1)
          .filter(x => x instanceof LixException);
        throw errors.length > 0
          ? errors[0]
          : new LixException(
              'UNAUTHORIZED',
              HttpStatus.UNAUTHORIZED,
              'All methods are forbidden',
            );
      }
    }
  }
  return mixin(OrMixinGuard) as Type<CanActivate>;
}
