import {
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  AccountType,
  ERROR_CODES,
  type JwtPayload,
  type JwtRefreshPayload,
  MSG,
  OAuthProvider,
  RpcClientService,
  warnAndCapture,
} from '@app/common';
import { TokenStoreService } from './services/token-store.service';
import { OAuthVerifierFactory } from './oauth/oauth-verifier.factory';
import type { OAuthVerifyHints } from './oauth/oauth-verifier.interface';
import { parsePlatformFromUserAgent } from '../../common/utils/parse-platform';

interface RequestContextHints {
  userAgent?: string;
}
import type {
  AuthResponseDto,
  AutoregDto,
  ForgotPasswordDto,
  LoginDto,
  OAuthDto,
  ResetPasswordDto,
  TokenPairDto,
  UpgradeAccountDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly rpc: RpcClientService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
    private readonly oauthFactory: OAuthVerifierFactory,
  ) {}

  async autoreg(dto: AutoregDto, deviceId: string): Promise<AuthResponseDto> {
    const result = await this.rpc.user<{
      id: string;
      tokenVersion: number;
    }>(MSG.CREATE_AUTOREG_USER, {
      fingerprint: dto.deviceFingerprint,
      platform: dto.platform,
    });
    // The public device binding for refresh/device JWTs is the client-owned
    // X-Device-Id header (stable install UUID), not the internal Mongo _id
    // of the Device row created in user-service.
    const pair = this.issueTokenPair(
      result.id,
      AccountType.autoreg,
      deviceId,
      result.tokenVersion,
    );
    const deviceToken = this.issueDeviceToken(result.id, deviceId);
    return {
      ...pair,
      userId: result.id,
      accountType: AccountType.autoreg,
      deviceToken,
    };
  }

  async login(dto: LoginDto, deviceId: string): Promise<AuthResponseDto> {
    const user = await this.rpc.user<{
      id: string;
      accountType: AccountType;
      tokenVersion: number;
    }>(MSG.LOGIN_USER, { email: dto.email, password: dto.password });
    const pair = this.issueTokenPair(
      user.id,
      AccountType.user,
      deviceId,
      user.tokenVersion,
    );
    return { ...pair, userId: user.id, accountType: user.accountType };
  }

  async upgrade(
    userId: string,
    dto: UpgradeAccountDto,
    deviceId: string,
    ctx: RequestContextHints = {},
  ): Promise<AuthResponseDto> {
    const providerUserId = dto.oauthToken
      ? await this.resolveOAuthProviderUserId(
          dto.method as unknown as OAuthProvider,
          dto.oauthToken,
          this.hintsFromCtx(ctx),
        )
      : undefined;

    const result = await this.rpc.user<{ tokenVersion: number }>(
      MSG.UPGRADE_USER_ACCOUNT,
      {
        userId,
        method: dto.method,
        email: dto.email,
        password: dto.password,
        name: dto.name,
        providerUserId,
      },
    );
    // upgrade bumped tokenVersion on the user-service side.
    // Re-mint the pair with the new tv so the client's freshly-issued
    // refresh JWT continues to work; the pre-upgrade autoreg refresh
    // (tv=0) is now stale and gets rejected on the next /refresh.
    const pair = this.issueTokenPair(
      userId,
      AccountType.user,
      deviceId,
      result.tokenVersion,
    );
    return { ...pair, userId, accountType: AccountType.user };
  }

  async oauthLogin(
    provider: string,
    dto: OAuthDto,
    deviceId: string,
    ctx: RequestContextHints = {},
  ): Promise<AuthResponseDto> {
    const token = dto.idToken ?? dto.accessToken ?? '';
    const { providerUserId, email, emailVerified, name } =
      await this.verifyOAuthToken(
        provider as OAuthProvider,
        token,
        this.hintsFromCtx(ctx),
      );

    // only the provider-verified email travels as
    // `email` (and pairs with `emailVerified: true`). A client-supplied
    // `dto.email` is never auto-merged into an existing account; it
    // can only seed a NEW account's profile when the provider itself
    // returned no email at all.
    const user = await this.rpc.user<{
      id: string;
      accountType: AccountType;
      tokenVersion: number;
    }>(MSG.FIND_OR_CREATE_OAUTH_USER, {
      provider,
      providerUserId,
      email: email ?? dto.email,
      emailVerified: !!email && emailVerified === true,
      name: name ?? dto.name,
    });
    const pair = this.issueTokenPair(
      user.id,
      AccountType.user,
      deviceId,
      user.tokenVersion,
    );
    return { ...pair, userId: user.id, accountType: user.accountType };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ success: boolean }> {
    await this.rpc.user(MSG.FORGOT_PASSWORD, { email: dto.email });
    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean }> {
    await this.rpc.user(MSG.RESET_PASSWORD, {
      token: dto.token,
      newPassword: dto.password,
    });
    return { success: true };
  }

  async refresh(
    userId: string,
    oldJti: string,
    oldExp: number,
    deviceId: string,
    accountType: AccountType,
    presentedTv: number | undefined,
  ): Promise<TokenPairDto> {
    // reject refresh tokens whose `tv` claim is below the
    // user's current tokenVersion. Bumped on password reset, account
    // upgrade, and account delete — those flows revoke every old
    // refresh in flight, so a stolen-session attacker can't keep
    // rotating after the legitimate user reset their password.
    //
    // A refresh JWT can also outlive its user (account deleted, or — in
    // dev — minted against a since-wiped DB). The RPC surfaces that as a
    // NotFound from user-service, which would otherwise bubble out as a
    // 404 from /auth/refresh. Semantically the token is just no longer
    // valid, so map it to the same 401/`token_invalid` shape clients
    // already handle.
    let tokenVersion: number;
    try {
      ({ tokenVersion } = await this.rpc.user<{ tokenVersion: number }>(
        MSG.GET_USER_TOKEN_VERSION,
        { userId },
      ));
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 404) {
        throw new UnauthorizedException({
          code: ERROR_CODES.TOKEN_INVALID,
          message: 'Refresh token has been revoked',
        });
      }
      throw err;
    }
    // Older refreshes have no `tv` claim — treat as 0. They keep
    // working until tokenVersion bumps for any reason; first bump
    // forces re-login, which is the intended one-shot rollout cost.
    const claimedTv = presentedTv ?? 0;
    if (claimedTv !== tokenVersion) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token has been revoked',
      });
    }
    await this.tokenStore.blacklistRefreshToken(oldJti, oldExp);
    return this.issueTokenPair(userId, accountType, deviceId, tokenVersion);
  }

  async logout(refreshToken: string): Promise<{ success: boolean }> {
    try {
      const payload = this.jwtService.verify<JwtRefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.jti && payload.exp) {
        await this.tokenStore.blacklistRefreshToken(payload.jti, payload.exp);
      }
    } catch {
      // Expired/invalid token — already unusable, treat as idempotent success
    }
    return { success: true };
  }

  // ─── Token helpers ────────────────────────────────────────────────────────

  private issueTokenPair(
    userId: string,
    accountType: AccountType,
    deviceId: string,
    tokenVersion: number,
  ): TokenPairDto {
    const base: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      type: accountType,
    };
    const refresh: Omit<JwtRefreshPayload, 'iat' | 'exp'> = {
      ...base,
      jti: randomUUID(),
      deviceId,
      tv: tokenVersion,
    };

    const accessToken = this.jwtService.sign(
      { sub: base.sub, type: base.type },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ??
          '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: refresh.sub,
        type: refresh.type,
        jti: refresh.jti,
        deviceId: refresh.deviceId,
        tv: refresh.tv,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ??
          '30d') as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    return { accessToken, refreshToken };
  }

  private issueDeviceToken(userId: string, deviceId: string): string {
    return this.jwtService.sign(
      { sub: userId, deviceId, type: 'device' },
      {
        secret: this.config.getOrThrow<string>('JWT_DEVICE_SECRET'),
        expiresIn: (this.config.get<string>('JWT_DEVICE_EXPIRES_IN') ??
          '365d') as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  /** Build a verifier hint object from the request-context the controller
   *  collected. Untrusted by design — only used for ordering. */
  private hintsFromCtx(ctx: RequestContextHints): OAuthVerifyHints {
    const platform = parsePlatformFromUserAgent(ctx.userAgent);
    return platform ? { platform } : {};
  }

  private async verifyOAuthToken(
    provider: OAuthProvider,
    token: string,
    hints: OAuthVerifyHints = {},
  ): Promise<{
    providerUserId: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
  }> {
    if (!token) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'OAuth token required',
      });
    }
    try {
      return await this.oauthFactory.for(provider).verify(token, hints);
    } catch (err) {
      // Ship every verifier failure to Sentry. Most are legitimate "user
      // sent a stale token" 401s, but rate-limits / network blips /
      // upstream 5xx hide here too — without this the only signal is
      // a generic 401 on the client and a single warn line in pod logs.
      // The exception is re-thrown unchanged so the caller still gets
      // the original status code.
      warnAndCapture(
        this.logger,
        `OAuth verify failed provider=${provider} err=${(err as Error).message}`,
        err,
        { tag: 'auth.oauth.verify_failed', provider },
      );
      throw err;
    }
  }

  /**
   * Verify the OAuth token and surface ANY verifier failure (rate-limit /
   * transient 5xx / expired token) to the caller. Previously we swallowed
   * everything and returned `undefined`, which made `upgrade()` send the
   * RPC with `providerUserId: undefined` — user-service then 400-ed with
   * "providerUserId required", a misleading error message that pointed
   * at the client instead of the failed provider call.
   */
  private async resolveOAuthProviderUserId(
    provider: OAuthProvider,
    token: string,
    hints: OAuthVerifyHints = {},
  ): Promise<string> {
    const { providerUserId } = await this.verifyOAuthToken(
      provider,
      token,
      hints,
    );
    return providerUserId;
  }
}
