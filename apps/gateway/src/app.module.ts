import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  ThrottlerModule,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { FingerprintThrottlerGuard } from './common/guards/fingerprint-throttler.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAccessGuard } from './modules/auth/guards/jwt-access.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { HttpLogInterceptor } from './common/interceptors/http-log.interceptor';
import { MessagingModule } from '@app/messaging';
import { requireEnv, validateEnvWith } from '@app/common';
import { GatewayConfig } from './config/gateway.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvWith(GatewayConfig),
    }),
    // gateway is an HTTP edge proxy — no direct DB access. All data goes
    // through microservices via RpcClientService. DatabaseModule deliberately
    // not imported here.
    MessagingModule.forRoot({
      url: requireEnv('RABBITMQ_URL'),
    }),
    // Rate limiting strategy:
    // - `default` applies globally to every endpoint via the fallback.
    // - `auth` and `fingerprint` are NAMED throttlers accessed by
    //   @Throttle({ auth: {...} }) on specific routes. They must NOT bleed onto
    //   unrelated endpoints (a 5/min cap on GET /health would block health-check
    //   scrapers). The `skipIf` callback restricts each named throttler to only
    //   the route group it was designed for; routes with an explicit @Throttle()
    //   decorator replace this logic entirely.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 200 },
      {
        name: 'auth',
        ttl: 60_000,
        limit: 5,
        skipIf: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ path?: string }>();
          return !req.path?.startsWith('/v1/auth/');
        },
      },
      {
        name: 'fingerprint',
        ttl: 60_000,
        limit: 3,
        skipIf: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ path?: string }>();
          return !req.path?.endsWith('/auth/autoreg');
        },
      },
    ] satisfies ThrottlerModuleOptions),
    AuthModule,
    UsersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAccessGuard },
    { provide: APP_GUARD, useClass: FingerprintThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: HttpLogInterceptor },
  ],
})
export class AppModule {}
