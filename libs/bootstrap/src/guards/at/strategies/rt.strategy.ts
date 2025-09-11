import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { LixException } from '@bootstrap/errors';
import { JwtPayload, JwtPayloadWithRt } from '@bootstrap/types';

import { HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

export type RtConfig = { RT_SECRET: string };

@Injectable()
export class RtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: RtConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.RT_SECRET,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: JwtPayload): JwtPayloadWithRt {
    const refreshToken = req
      ?.get('authorization')
      ?.replace(/^Bearer/i, '')
      .trim();

    if (!refreshToken) {
      throw new LixException('RefreshTokenMalformed', HttpStatus.BAD_REQUEST);
    }

    return {
      ...payload,
      refreshToken,
    };
  }
}
