import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES, type JwtRefreshPayload } from '@app/common';
import { TokenStoreService } from '../services/token-store.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    config: ConfigService,
    private readonly tokenStore: TokenStoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  async validate(
    payload: JwtRefreshPayload,
  ): Promise<JwtRefreshPayload & { userId: string }> {
    if (!payload.sub || !payload.jti) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Invalid refresh token',
      });
    }
    // refresh tokens issued before the deviceId binding rollout
    // are missing this claim. We reject them outright so the next /login
    // re-issues a properly bound pair. (User-visible: one re-login per
    // device after the rollout — accepted intentional cost.)
    if (!payload.deviceId) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token missing deviceId — re-login required',
      });
    }
    if (await this.tokenStore.isBlacklisted(payload.jti)) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Token has been revoked',
      });
    }
    return { ...payload, userId: payload.sub };
  }
}
