import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthResponseDto,
  ERROR_CODES,
  SuccessDto,
  TokenPairDto,
} from '@app/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CurrentUser } from '@app/common';
import type { JwtRefreshPayload } from '@app/common';
import {
  AutoregDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  OAuthDto,
  ResetPasswordDto,
  UpgradeAccountDto,
} from './dto/auth.dto';

// every auth endpoint that issues or rotates a refresh token
// requires the client to identify the device via `X-Device-Id`. We bake
// the value into the refresh JWT so a stolen token used from another
// device fails the match on /refresh.
const DEVICE_ID_HEADER = 'x-device-id';

function requireDeviceId(headerValue: string | undefined): string {
  const v = (headerValue ?? '').trim();
  if (!v) {
    throw new BadRequestException({
      code: 'device_id_required',
      message: `${DEVICE_ID_HEADER} header is required`,
    });
  }
  return v;
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Per-fingerprint cap stacks on top of the per-IP one so a single device
  // can't spam account creation even from rotating IPs, and a single IP can
  // still cover many legitimate fingerprints behind NAT up to the IP cap.
  @Throttle({
    auth: { limit: 5, ttl: 60_000 },
    fingerprint: { limit: 3, ttl: 60_000 },
  })
  @Post('autoreg')
  @ApiOperation({
    summary: 'Create autoreg account by device fingerprint',
    description:
      'Call on cold start with no stored credentials. See `docs/AUTH-FLOW.md`.\n\nCreates or returns an anonymous account tied to the device. Same fingerprint always returns the same account. Rate-limited: 3/min per fingerprint, 5/min per IP.',
  })
  @ApiBody({ type: AutoregDto })
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  @ApiCreatedResponse({ type: AuthResponseDto })
  autoreg(
    @Body() dto: AutoregDto,
    @Headers(DEVICE_ID_HEADER) deviceId?: string,
    // `req.ip` resolves to the real client thanks to `trust proxy` in
    // main.ts. AuthService hashes it before it crosses the message bus.
    @Ip() clientIp?: string,
  ) {
    return this.authService.autoreg(dto, requireDeviceId(deviceId), clientIp);
  }

  @Post('upgrade')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upgrade autoreg account to full user',
    description:
      'Call when: current account is `accountType=autoreg` (anon access in Bearer) and the user enters email/password OR taps an OAuth button.\n\nLinks an email/OAuth identity to an existing autoreg account, preserving all account data. Cannot be undone.',
  })
  @ApiBody({ type: UpgradeAccountDto })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  upgrade(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpgradeAccountDto,
    @Headers(DEVICE_ID_HEADER) deviceId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.upgrade(
      user.userId,
      dto,
      requireDeviceId(deviceId),
      { userAgent },
    );
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Login with email + password',
    description:
      'Call when recovering an account on a new device: storage is empty and the user entered email+password. If an anon (autoreg) session exists — use `/upgrade`, not `/login`. See `docs/AUTH-FLOW.md`.\n\nAuthenticates a registered account and returns a short-lived access token and a long-lived refresh token.',
  })
  @ApiBody({ type: LoginDto })
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto, @Headers(DEVICE_ID_HEADER) deviceId?: string) {
    return this.authService.login(dto, requireDeviceId(deviceId));
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Refresh access token using refresh token',
    description:
      'Call when the access token expired (`401 token_expired`) or is about to, and a refresh token is stored. If `/refresh` itself returns `401` (`token_invalid` / `device_mismatch`) — wipe both tokens and cold-start. See `docs/AUTH-FLOW.md`.\n\nRotates the token pair. The used refresh token is immediately invalidated. Send the refresh token in the Bearer header.',
  })
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  @ApiOkResponse({ type: TokenPairDto })
  refresh(
    @CurrentUser() user: JwtRefreshPayload & { userId: string },
    @Headers(DEVICE_ID_HEADER) headerDeviceId?: string,
  ) {
    if (!user.jti || !user.exp) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: 'Refresh token missing jti/exp',
      });
    }
    // the refresh JWT is bound to the device that received it.
    // A token rotated from another device fails the match — even if the
    // attacker has the bearer string, they don't have the matching
    // X-Device-Id from the original install.
    const headerId = requireDeviceId(headerDeviceId);
    if (user.deviceId !== headerId) {
      throw new UnauthorizedException({
        code: 'device_mismatch',
        message: 'Refresh token does not belong to this device',
      });
    }
    return this.authService.refresh(
      user.userId,
      user.jti,
      user.exp,
      user.deviceId,
      user.type,
      user.tv,
    );
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout — invalidate refresh token',
    description:
      'Call when the user taps "log out". Send the access token in Bearer and the refresh token in the body. See `docs/AUTH-FLOW.md`.\n\nBlacklists the refresh token until its natural expiry. The access token stays valid until it expires on its own.',
  })
  @ApiBody({ type: LogoutDto })
  @ApiOkResponse({ type: SuccessDto })
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('forgot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request password reset email',
    description:
      'Call when the user taps "forgot password" on the login screen. Follow up with `/auth/reset` after the email link is clicked.\n\nSends a reset link to the email if it belongs to a registered account. Always returns 200 to prevent user enumeration.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ type: SuccessDto })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('reset')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset password using token from email',
    description:
      'Call when the user followed the email link (after `/auth/forgot`) and entered a new password. The URL token is single-use, TTL 1 hour.\n\nValidates the single-use reset token and updates the password. Token expires in 1 hour.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ type: SuccessDto })
  reset(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('oauth/:provider')
  @HttpCode(200)
  @ApiOperation({
    summary: 'OAuth recovery — login (or first-time create) via provider',
    description:
      'Call when recovering on a new device: storage is empty and the user tapped an OAuth button. If an anon (autoreg) session exists — use `/upgrade` with `{ method:<provider>, oauthToken }`, not this endpoint. See `docs/AUTH-FLOW.md`.\n\nFinds or creates an account for the OAuth identity. New users get a fresh account; returning users get their existing one. Provider is google/apple/vk/yandex.',
  })
  @ApiParam({
    name: 'provider',
    enum: ['google', 'apple', 'vk', 'yandex'],
    description: 'OAuth provider — selects which token field is required',
  })
  @ApiBody({ type: OAuthDto })
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  @ApiOkResponse({ type: AuthResponseDto })
  oauth(
    @Param('provider') provider: string,
    @Body() dto: OAuthDto,
    @Headers(DEVICE_ID_HEADER) deviceId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.oauthLogin(
      provider,
      dto,
      requireDeviceId(deviceId),
      { userAgent },
    );
  }
}
