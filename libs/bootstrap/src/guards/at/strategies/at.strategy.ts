import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@bootstrap/types';

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

export type AtConfig = { AT_SECRET: string };

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt-access') {
  constructor(config: AtConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.AT_SECRET,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
