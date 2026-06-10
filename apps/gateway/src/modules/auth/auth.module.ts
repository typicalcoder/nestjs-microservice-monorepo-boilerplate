import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { TokenStoreService } from './services/token-store.service';
import { OAuthVerifierFactory } from './oauth/oauth-verifier.factory';
import { VkOAuthVerifierService } from './oauth/vk-oauth-verifier.service';
import { YandexOAuthVerifierService } from './oauth/yandex-oauth-verifier.service';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenStoreService,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    JwtAccessGuard,
    VkOAuthVerifierService,
    YandexOAuthVerifierService,
    OAuthVerifierFactory,
  ],
  exports: [JwtAccessGuard, TokenStoreService],
})
export class AuthModule {}
