import { NestFactory, Reflector } from '@nestjs/core';
import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, getSchemaPath, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import {
  assertRequiredEnv,
  buildLogger,
  ErrorResponseDto,
  initSentry,
  installProcessErrorHandlers,
  optionalEnv,
} from '@app/common';
import { AppModule } from './app.module';

initSentry('gateway');

// Fail-fast at the earliest point: before NestFactory touches modules. Any
// missing var prints a single aggregated error so a misconfigured pod is
// diagnosed in seconds from `kubectl logs`.
assertRequiredEnv([
  'RABBITMQ_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'REDIS_URL',
]);

// VK OAuth audiences (VK_ANDROID_APP_ID / VK_IOS_APP_ID) are OPTIONAL — the
// typed `GatewayConfig` schema validates their shape when set; unset means
// the VK provider answers "not configured". Docs in `.env.example`.

async function bootstrap() {
  // No `bufferLogs: true`: NestFactory.create implicitly runs `app.init()`,
  // which fires `OnApplicationBootstrap` hooks. If any of those hooks await
  // an external dependency (e.g. RMQ connect in EventBusService) and the
  // dependency is down, init never completes and the buffer never flushes —
  // pod stays "Ready" with empty stdout while the boot is wedged. Passing
  // `logger:` directly is enough to route Nest's own startup lines through
  // winston; the few lines emitted before the logger is applied are an
  // acceptable trade-off for boot-time observability of failed dependencies.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: buildLogger('gateway'),
  });

  // explicit body size limit. Default Express
  // limit is ~100 KB; we have no upload endpoints and the largest
  // legitimate JSON payload is small. 64 KB leaves ample headroom while shutting
  // the door on memory-pressure DoS via giant JSON.
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: true });

  // Disable Express's auto weak-ETag generator so endpoints that compute
  // their own strong ETag don't get their headers overwritten with a
  // body-hash weak validator. We're explicit per-route about what's cacheable.
  const httpInstance = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (setting: string, value: unknown) => void;
  };
  if (typeof httpInstance.disable === 'function') {
    httpInstance.disable('etag');
  }
  // Trust the cluster ingress so req.ip resolves to the real client (the
  // leftmost address in X-Forwarded-For), not the ingress pod's overlay IP.
  // Without this every request from every user shared one tracker key and
  // the 100/min throttler treated the whole edge as a single client —
  // exactly the regression that killed the gateway with 429 on liveness
  // probes (2026-05-25). "1" = trust one hop (the ingress); we explicitly
  // do NOT want `true` (trust any X-Forwarded-For), which would let a
  // malicious client forge an arbitrary tracker key per request.
  if (typeof httpInstance.set === 'function') {
    httpInstance.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy:
        process.env['NODE_ENV'] === 'production' ? undefined : false,
    }),
  );

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Class-transformer serialization
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // CORS — if your only clients are native mobile apps they send no Origin
  // header, so CORS is a browser-only concern that
  // doesn't apply to our threat model. Wildcard hardcoded; if we ever
  // expose a web admin or browser SDK, narrow this here. Never enable
  // credentials with wildcard (browsers reject the combination per spec).
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Client-Version',
      'X-Platform',
      'X-Device-Id',
      'X-Idempotency-Key',
      'X-Trace-Id',
      'Accept-Language',
    ],
    credentials: false,
  });

  // Swagger — available on /api/docs
  if (process.env['NODE_ENV'] !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('App API')
      .setDescription('Backend API gateway')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag(
        'auth',
        // Tag description renders at the top of the auth section in Swagger UI.
        [
          'Authentication & identity.',
          '',
          'Which endpoint to call when:',
          '  • have a refreshToken → `/auth/refresh`',
          '  • cold start, no input → `/auth/autoreg`',
          '  • anonymous user enters email/OAuth → `/auth/upgrade`',
          '  • recover on a new device by email → `/auth/login`',
          '  • recover on a new device via OAuth → `/auth/oauth/:provider`',
          '',
          'Every endpoint that issues a refresh token requires the `X-Device-Id` header.',
        ].join('\n'),
      )
      .addTag('users', 'User profile')
      .addTag('health', 'Service health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      extraModels: [ErrorResponseDto],
    });
    attachCommonErrorResponses(document);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // SIGTERM/SIGINT → drain in-flight HTTP + close RPC clients + ORM. k8s
  // defaults to 30s grace; we finish fast (no long polling) so the default
  // is plenty.
  app.enableShutdownHooks();
  const shutdown = async (signal: string) => {
    console.log(`Gateway: ${signal} received — closing`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      console.error('Gateway shutdown error', err);
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // Last-resort capture for promise rejections that escaped every Nest
  // filter and for synchronous throws on the event loop. The Sentry node
  // SDK installs its own handlers, but having an explicit one means a
  // local console line accompanies every event — silent crashes have
  // already cost hours of diagnosis here.
  installProcessErrorHandlers('gateway', new Logger('gateway'));

  const port = parseInt(optionalEnv('PORT', '3000'), 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Gateway running on port ${port}`);
}

/**
 * Injects shared error-response schemas (400/401/404/429/500) onto every
 * operation in the Swagger document. NestJS only auto-documents status codes
 * the controller returns via @HttpCode or explicit @ApiResponse, so without
 * this our generated clients have no type for the ubiquitous error envelope.
 */
function attachCommonErrorResponses(doc: OpenAPIObject) {
  const errorRef = { $ref: getSchemaPath(ErrorResponseDto) };
  const commonErrors: Record<string, { description: string }> = {
    '400': { description: 'Validation failed or malformed request' },
    '401': { description: 'Missing or invalid authentication' },
    '403': { description: 'Authenticated but not authorized' },
    '404': { description: 'Resource not found' },
    '409': { description: 'Conflict with existing state' },
    '429': { description: 'Rate limit exceeded' },
    '500': { description: 'Unexpected server error' },
  };

  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
  for (const pathItem of Object.values(doc.paths ?? {})) {
    for (const method of methods) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | { responses?: Record<string, unknown> }
        | undefined;
      if (!op) continue;
      op.responses ??= {};
      for (const [code, meta] of Object.entries(commonErrors)) {
        if (op.responses[code]) continue;
        op.responses[code] = {
          description: meta.description,
          content: { 'application/json': { schema: errorRef } },
        };
      }
    }
  }
}

void bootstrap();
