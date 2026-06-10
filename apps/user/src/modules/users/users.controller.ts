import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateRequestContext, MikroORM } from '@mikro-orm/core';
import { UsersService } from './users.service';
import { MicroserviceException, MSG, OAuthProvider } from '@app/common';

interface UserPayload {
  userId?: string;
  email?: string;
  /**
   * Set by the OAuth verifier when the provider itself attests the user
   * controls `email`. Only verified emails are eligible for cross-account
   * auto-merge in `findOrCreateOAuthUser`.
   */
  emailVerified?: boolean;
  password?: string;
  name?: string;
  fingerprint?: string;
  platform?: 'android' | 'ios';
  ipHash?: string;
  provider?: string;
  providerUserId?: string;
  method?: 'email' | 'google' | 'apple' | 'vk' | 'yandex';
  token?: string;
  newPassword?: string;
  [key: string]: unknown;
}

@Controller()
export class UsersController {
  constructor(
    readonly orm: MikroORM,
    private readonly usersService: UsersService,
  ) {}

  /** Ping handler for the gateway deep /health probe. */
  @MessagePattern(MSG.PING)
  ping() {
    return { ok: true, service: 'user' };
  }

  @MessagePattern(MSG.CREATE_AUTOREG_USER)
  @CreateRequestContext()
  createAutoregUser(@Payload() data: UserPayload) {
    // The fingerprint is the recovery anchor for autoreg accounts. Falling
    // back to anything else would silently key Device rows on the wrong value.
    if (!data.fingerprint) {
      throw MicroserviceException.badRequest('fingerprint is required');
    }
    return this.usersService.createAutoregUser({
      fingerprint: data.fingerprint,
      platform: data.platform,
      ipHash: data.ipHash,
    });
  }

  @MessagePattern(MSG.LOGIN_USER)
  @CreateRequestContext()
  login(@Payload() data: UserPayload) {
    return this.usersService.login(data.email!, data.password!);
  }

  @MessagePattern(MSG.UPGRADE_USER_ACCOUNT)
  @CreateRequestContext()
  upgradeAccount(@Payload() data: UserPayload) {
    return this.usersService.upgradeAccount(data.userId!, {
      method: data.method ?? 'email',
      email: data.email,
      password: data.password,
      name: data.name,
      providerUserId: data.providerUserId,
    });
  }

  @MessagePattern(MSG.FIND_OR_CREATE_OAUTH_USER)
  @CreateRequestContext()
  findOrCreateOAuthUser(@Payload() data: UserPayload) {
    return this.usersService.findOrCreateOAuthUser({
      provider: data.provider as OAuthProvider,
      providerUserId: data.providerUserId!,
      email: data.email,
      emailVerified: data.emailVerified ?? false,
      name: data.name,
    });
  }

  @MessagePattern(MSG.FORGOT_PASSWORD)
  @CreateRequestContext()
  forgotPassword(@Payload() data: UserPayload) {
    return this.usersService.forgotPassword(data.email!);
  }

  @MessagePattern(MSG.RESET_PASSWORD)
  @CreateRequestContext()
  resetPassword(@Payload() data: UserPayload) {
    return this.usersService.resetPassword(data.token!, data.newPassword!);
  }

  @MessagePattern(MSG.GET_USER_BY_ID)
  @CreateRequestContext()
  async getUserById(@Payload() data: UserPayload) {
    const u = await this.usersService.findById(data.userId!);
    return this.usersService.toDto(u);
  }

  @MessagePattern(MSG.GET_USER_TOKEN_VERSION)
  @CreateRequestContext()
  async getUserTokenVersion(
    @Payload() data: UserPayload,
  ): Promise<{ tokenVersion: number }> {
    const u = await this.usersService.findById(data.userId!);
    // findById throws on soft-deleted, so a refresh attempt for a deleted
    // user surfaces as MicroserviceException → 401 in the gateway.
    return { tokenVersion: u.tokenVersion ?? 0 };
  }

  @MessagePattern(MSG.UPDATE_USER)
  @CreateRequestContext()
  updateUser(@Payload() data: UserPayload) {
    const {
      userId,
      email: _e,
      password: _p,
      token: _t,
      newPassword: _n,
      ...rest
    } = data;
    void _e;
    void _p;
    void _t;
    void _n;
    return this.usersService.updateUser(userId!, rest);
  }

  @MessagePattern(MSG.DELETE_USER)
  @CreateRequestContext()
  async deleteUser(@Payload() data: UserPayload) {
    await this.usersService.deleteUser(data.userId!);
    // ClientRMQ drops `undefined` replies — return an explicit ack object.
    return { success: true };
  }
}
