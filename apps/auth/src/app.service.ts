import { randomUUID } from 'crypto';
import {
  AuthenticateCommandRequestPayload,
  AuthenticateCommandResponsePayload,
  MicroservicesEnum,
  RefreshTokenCommandRequestPayload,
  RefreshTokenCommandResponsePayload,
} from '@microservice';
import { firstValueFrom } from 'rxjs';
import { EnvType } from '@bootstrap/base-config';
import { LixRpcException } from '@bootstrap/errors';
import { UserEntity } from '@bootstrap/repository/entities/user.entity';

import {
  RequestCodeCommandRequestPayload,
  RequestCodeCommandResponsePayload,
} from '@microservice/lib/commands/auth/request-code.command-payload';
import {
  SendSmsCommandRequestPayload,
  SendSmsCommandResponsePayload,
  SmsCommands,
} from '@microservice/lib/commands/sms';
import {
  GetUserCommandRequestPayload,
  UsersCommands,
} from '@microservice/lib/commands/users';
import { CreateUserCommandRequestPayload } from '@microservice/lib/commands/users/create.users.command-payload';
import { CustomAmqpProxy } from '@microservice/lib/custom-amqp-proxy';

import { HttpService } from '@nestjs/axios';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { Config } from './config';
import { RefreshService } from './refresh/refresh.service';

@Injectable()
export class AppService {
  constructor(
    @Inject(MicroservicesEnum.USERS)
    private readonly clientUsers: CustomAmqpProxy<MicroservicesEnum.USERS>,

    @Inject(MicroservicesEnum.SMS)
    private readonly clientSms: CustomAmqpProxy<MicroservicesEnum.SMS>,

    private readonly jwtService: JwtService,
    private readonly httpService: HttpService,
    private readonly refreshService: RefreshService,

    private readonly config: Config,

    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async auth(
    data: AuthenticateCommandRequestPayload,
  ): Promise<AuthenticateCommandResponsePayload> {
    await this.validateCode(data.phone, data.code);

    const user = await this.getUser({ phone: data.phone });

    const { accessToken, refreshToken } = await this.getTokens(user);

    await this.refreshService.add(user.id, refreshToken);

    return new AuthenticateCommandResponsePayload(accessToken, refreshToken);
  }

  async refresh(
    data: RefreshTokenCommandRequestPayload,
  ): Promise<RefreshTokenCommandResponsePayload> {
    const user = await this.getUser({ id: data.userId });

    try {
      await this.refreshService.invalidateOrThrow({
        refreshToken: data.refresh_token,
      });

      const { accessToken, refreshToken } = await this.getTokens(user);

      await this.refreshService.add(user.id, refreshToken);

      return new RefreshTokenCommandResponsePayload(accessToken, refreshToken);
    } catch (error) {
      throw new LixRpcException(
        'AccessForbidden',
        HttpStatus.FORBIDDEN,
        undefined,
        error,
      );
    }
  }

  async requestCode(
    data: RequestCodeCommandRequestPayload,
  ): Promise<RequestCodeCommandResponsePayload> {
    if (
      this.config.NODE_ENV === EnvType.PROD &&
      !(await this.verifyCaptchaOrThrow(data.token, data.ip))
    ) {
      throw new LixRpcException('AccessForbidden', HttpStatus.FORBIDDEN);
    }

    let user: UserEntity;
    try {
      user = await this.getUser({ phone: data.phone });
    } catch {
      user = await this.createUser(data.phone);
    }

    const code = await this.newOtpCode(user.phone);
    let sentResult: SendSmsCommandResponsePayload;
    if (this.config.NODE_ENV === EnvType.LOCAL) {
      sentResult = new SendSmsCommandResponsePayload(0);
    } else {
      sentResult = await firstValueFrom(
        this.clientSms.message(
          SmsCommands.send,
          new SendSmsCommandRequestPayload(
            user.phone,
            `Ваш код: ${code}`,
            data.ip,
          ),
        ),
      );
    }

    return new RequestCodeCommandResponsePayload(
      sentResult.balance >= 0 ? 1 : 0,
    );
  }

  async getUser(dto: { id?: string; phone?: string }): Promise<UserEntity> {
    return (
      await firstValueFrom(
        this.clientUsers.message(
          UsersCommands.get,
          new GetUserCommandRequestPayload(dto),
        ),
      )
    ).user;
  }

  async createUser(phone: string): Promise<UserEntity> {
    return (
      await firstValueFrom(
        this.clientUsers.message(
          UsersCommands.create,
          new CreateUserCommandRequestPayload(phone),
        ),
      )
    ).user;
  }

  async getTokens(
    user: UserEntity,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = {
      sub: user.id,
      salt: randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.AT_SECRET,
        expiresIn: this.config.JWT_LIFETIME || '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.RT_SECRET,
        expiresIn: '14d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async verifyCaptchaOrThrow(token: string, ip?: string): Promise<boolean> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get('https://smartcaptcha.yandexcloud.net/validate', {
          params: {
            secret: this.config.YC_SMART_CAPTCHA_KEY,
            token,
            ip,
          },
        }),
      );

      if (
        resp?.data &&
        typeof resp.data === 'object' &&
        resp.data !== null &&
        'status' in resp.data &&
        (resp.data as { status: unknown }).status === 'ok'
      ) {
        return true;
      }
    } catch {
      /* empty */
    }

    return false;
  }

  async newOtpCode(phone: string): Promise<string> {
    const code = `${Math.floor(Math.random() * 10000)}`.padStart(4, '0');

    await this.cacheManager.set(`otp:${phone}`, code, 600_000);

    return code;
  }

  async validateCode(phone: string, codeToValidate: string): Promise<void> {
    const code = await this.cacheManager.get<string>(`otp:${phone}`);
    if (code !== null && codeToValidate === code) {
      return;
    }
    throw new LixRpcException('InvalidCode', HttpStatus.FORBIDDEN);
  }
}
