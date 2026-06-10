import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AccountType, ERROR_CODES, type JwtPayload } from '@app/common';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(
  Strategy,
  'jwt-access',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): JwtPayload & { userId: string } {
    if (!payload.sub) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Missing subject',
      });
    }
    // Reject refresh/device tokens presented as access tokens. They're signed
    // with different secrets so forging is already blocked, but a same-shape
    // token of the wrong type would otherwise pass this validate().
    if (
      payload.type !== AccountType.autoreg &&
      payload.type !== AccountType.user
    ) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Wrong token type for this endpoint',
      });
    }
    return { ...payload, userId: payload.sub };
  }
}
