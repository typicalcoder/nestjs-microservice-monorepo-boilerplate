#!/usr/bin/env node
/**
 * Scaffold a new RMQ microservice and wire it into the monorepo.
 *
 *   pnpm scaffold <name>          # e.g. pnpm scaffold billing
 *
 * What it does:
 *   1. apps/<name>/                — main.ts, app.module.ts, feature module
 *      with a PING handler, tsconfig.app.json, .env.example
 *   2. nest-cli.json               — registers the project
 *   3. libs/common  queue.constants.ts — QUEUES + SERVICE_TOKENS + MSG ping
 *      stays generic (PING is shared)
 *   4. libs/messaging messaging.module.ts — ALL_SERVICES + QUEUE_BY_TOKEN
 *   5. libs/common  rpc-client.service.ts — ServiceName union, injected
 *      client, `rpc.<camelName>()` routing helper, pickClient branch
 *   6. package.json                — start:dev:<name> script
 *   7. docker-compose.yml          — service entry
 *   8. .github/workflows/deploy.yml — dispatch choice + ALL_SERVICES
 *
 * Edits into existing files are anchored on exact strings from the template.
 * If an anchor is missing (file diverged), the script aborts BEFORE writing
 * anything and tells you which file to wire manually.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ─── name derivations ────────────────────────────────────────────────────────

const rawName = process.argv[2];
if (!rawName || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(rawName)) {
  console.error(
    'Usage: pnpm scaffold <kebab-case-name>   (e.g. billing, habit-tracker)',
  );
  process.exit(1);
}
const kebab = rawName; // habit-tracker
const snake = kebab.replaceAll('-', '_'); // habit_tracker
const CONST = `${snake.toUpperCase()}_SERVICE`; // HABIT_TRACKER_SERVICE
const camel = snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); // habitTracker
const pascal = camel[0].toUpperCase() + camel.slice(1); // HabitTracker
const queue = `${snake}_service_queue`;

const appDir = join(ROOT, 'apps', kebab);
if (existsSync(appDir)) {
  console.error(`apps/${kebab} already exists — aborting.`);
  process.exit(1);
}

// ─── anchored edits (validated before any write) ─────────────────────────────

/** Accumulated per-file contents so several edits to one file compose
 *  instead of the last one overwriting the rest. */
const edited = new Map(); // abs path → current content
function planEdit(relPath, anchor, replacement) {
  const file = join(ROOT, relPath);
  const src = edited.get(file) ?? readFileSync(file, 'utf8');
  if (!src.includes(anchor)) {
    console.error(
      `Anchor not found in ${relPath} — the file diverged from the template.\n` +
        `Wire the service into it manually (see README "Adding a microservice").\n` +
        `Missing anchor:\n---\n${anchor}\n---`,
    );
    process.exit(1);
  }
  edited.set(file, src.replace(anchor, replacement));
}

// 3. queue.constants.ts — QUEUES + SERVICE_TOKENS
planEdit(
  'libs/common/src/constants/queue.constants.ts',
  `export const QUEUES = {
  USER_SERVICE: 'user_service_queue',`,
  `export const QUEUES = {
  USER_SERVICE: 'user_service_queue',
  ${CONST}: '${queue}',`,
);
planEdit(
  'libs/common/src/constants/queue.constants.ts',
  `export const SERVICE_TOKENS = {
  USER_SERVICE: 'USER_SERVICE',`,
  `export const SERVICE_TOKENS = {
  USER_SERVICE: 'USER_SERVICE',
  ${CONST}: '${CONST}',`,
);

// 4. messaging.module.ts — ALL_SERVICES + QUEUE_BY_TOKEN
planEdit(
  'libs/messaging/src/messaging.module.ts',
  `const ALL_SERVICES: ServiceKey[] = ['USER_SERVICE'];`,
  `const ALL_SERVICES: ServiceKey[] = ['USER_SERVICE', '${CONST}'];`,
);
planEdit(
  'libs/messaging/src/messaging.module.ts',
  `  [SERVICE_TOKENS.USER_SERVICE]: QUEUES.USER_SERVICE,`,
  `  [SERVICE_TOKENS.USER_SERVICE]: QUEUES.USER_SERVICE,
  [SERVICE_TOKENS.${CONST}]: QUEUES.${CONST},`,
);

// 5. rpc-client.service.ts — union, ctor inject, routing method, pickClient
planEdit(
  'libs/common/src/services/rpc-client.service.ts',
  `export type ServiceName = 'user';`,
  `export type ServiceName = 'user' | '${camel}';`,
);
planEdit(
  'libs/common/src/services/rpc-client.service.ts',
  `    @Inject(SERVICE_TOKENS.USER_SERVICE)
    private readonly userClient: ClientProxy,`,
  `    @Inject(SERVICE_TOKENS.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(SERVICE_TOKENS.${CONST})
    private readonly ${camel}Client: ClientProxy,`,
);
planEdit(
  'libs/common/src/services/rpc-client.service.ts',
  `    return this.send<T>('user', this.userClient, pattern, payload, timeoutMs);
  }`,
  `    return this.send<T>('user', this.userClient, pattern, payload, timeoutMs);
  }

  ${camel}<T = unknown>(
    pattern: string,
    payload: object = {},
    timeoutMs?: number,
  ): Promise<T> {
    return this.send<T>(
      '${camel}',
      this.${camel}Client,
      pattern,
      payload,
      timeoutMs,
    );
  }`,
);
planEdit(
  'libs/common/src/services/rpc-client.service.ts',
  `    if (service === 'user') return this.userClient;`,
  `    if (service === 'user') return this.userClient;
    if (service === '${camel}') return this.${camel}Client;`,
);

// 7. docker-compose.yml — service entry before the volumes block
planEdit(
  'docker-compose.yml',
  `
volumes:
  mongo-data:`,
  `
  ${kebab}:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        SERVICE: ${kebab}
        RELEASE_TAG: \${RELEASE_TAG:-dev-local}
    container_name: app-${kebab}
    restart: unless-stopped
    env_file: .env
    environment:
      MONGO: mongodb://mongodb:27017
      RABBITMQ_URL: amqp://\${RABBITMQ_USER:-guest}:\${RABBITMQ_PASS:-guest}@rabbitmq:5672
    depends_on:
      mongodb:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

volumes:
  mongo-data:`,
);

// 8. deploy.yml — workflow_dispatch choice + ALL_SERVICES
planEdit(
  '.github/workflows/deploy.yml',
  `          - gateway
          - user`,
  `          - gateway
          - user
          - ${kebab}`,
);
planEdit(
  '.github/workflows/deploy.yml',
  `  ALL_SERVICES: gateway,user`,
  `  ALL_SERVICES: gateway,user,${kebab}`,
);

// 2. nest-cli.json + 6. package.json (JSON edits, also pre-validated)
const nestCliPath = join(ROOT, 'nest-cli.json');
const nestCli = JSON.parse(readFileSync(nestCliPath, 'utf8'));
if (nestCli.projects[kebab]) {
  console.error(`nest-cli.json already has a project '${kebab}' — aborting.`);
  process.exit(1);
}
nestCli.projects[kebab] = {
  type: 'application',
  root: `apps/${kebab}`,
  entryFile: 'main',
  sourceRoot: `apps/${kebab}/src`,
  compilerOptions: { tsConfigPath: `apps/${kebab}/tsconfig.app.json` },
};

const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.scripts[`start:dev:${kebab}`] = `nest start ${kebab} --watch`;

// ─── generated files ─────────────────────────────────────────────────────────

const files = {
  [`apps/${kebab}/src/main.ts`]: `import { assertRequiredEnv, bootstrapService, QUEUES } from '@app/common';
import { ${pascal}AppModule } from './app.module';

assertRequiredEnv(['MONGO', 'MONGO_DB', 'RABBITMQ_URL']);

void bootstrapService(${pascal}AppModule, {
  queue: QUEUES.${CONST},
  serviceName: '${kebab}',
});
`,
  [`apps/${kebab}/src/app.module.ts`]: `import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/database';
import { MessagingModule, OutboxModule } from '@app/messaging';
import { ServiceConfig, requireEnv, validateEnvWith } from '@app/common';
import { ${pascal}Module } from './modules/${kebab}/${kebab}.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      // Declare service-specific env vars on a class extending ServiceConfig
      // (see apps/user/src/config/user.config.ts for the pattern).
      validate: validateEnvWith(ServiceConfig),
    }),
    DatabaseModule.forRoot({
      uri: requireEnv('MONGO'),
      dbName: requireEnv('MONGO_DB'),
    }),
    // List peer service tokens this service calls via rpc.<peer>(), and add
    // \`subscribesTo: ['some.event']\` to receive topic-exchange events.
    MessagingModule.forPeers(
      {
        url: requireEnv('RABBITMQ_URL'),
        selfQueue: '${queue}',
      },
      [],
    ),
    OutboxModule,
    ${pascal}Module,
  ],
})
export class ${pascal}AppModule {}
`,
  [`apps/${kebab}/src/modules/${kebab}/${kebab}.module.ts`]: `import { Module } from '@nestjs/common';
import { ${pascal}Controller } from './${kebab}.controller';
import { ${pascal}Service } from './${kebab}.service';

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service],
  exports: [${pascal}Service],
})
export class ${pascal}Module {}
`,
  [`apps/${kebab}/src/modules/${kebab}/${kebab}.controller.ts`]: `import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { MSG } from '@app/common';
import { ${pascal}Service } from './${kebab}.service';

@Controller()
export class ${pascal}Controller {
  constructor(private readonly ${camel}Service: ${pascal}Service) {}

  /** Ping handler for the gateway deep /health probe. */
  @MessagePattern(MSG.PING)
  ping() {
    return { ok: true, service: '${kebab}' };
  }

  // Add @MessagePattern handlers here and the matching MSG.* constants in
  // libs/common/src/constants/queue.constants.ts. Entity-touching handlers
  // need @CreateRequestContext() (import from '@mikro-orm/decorators/legacy')
  // and must be async — see apps/user/src/modules/users/users.controller.ts.
}
`,
  [`apps/${kebab}/src/modules/${kebab}/${kebab}.service.ts`]: `import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ${pascal}Service {
  private readonly logger = new Logger(${pascal}Service.name);
}
`,
  [`apps/${kebab}/tsconfig.app.json`]: `{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "outDir": "../../dist/apps/${kebab}"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
`,
  [`apps/${kebab}/.env.example`]: `# ─── ${kebab}-service ─────────────────────────────────────────────────────────
# Consumes RPC on <prefix>_${queue}.

NODE_ENV=development

# ─── Database (*) ───
MONGO=mongodb://127.0.0.1:27017/?directConnection=true
MONGO_DB=app-dev

# ─── RabbitMQ (consumer) (*) ───
RABBITMQ_URL=amqp://localhost:5672
RMQ_QUEUE_PREFIX=dev

# ─── Observability ───
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.05
RELEASE_TAG=
LOG_LEVEL=
LOG_FORMAT=
METRICS_PORT=
`,
};

// ─── commit everything (validations passed) ─────────────────────────────────

for (const [file, content] of edited) writeFileSync(file, content);
writeFileSync(nestCliPath, JSON.stringify(nestCli, null, 2) + '\n');
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
for (const [rel, content] of Object.entries(files)) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

console.log(`✅ Scaffolded apps/${kebab} and wired it into:
   - nest-cli.json                 (project '${kebab}')
   - libs/common  queue.constants  (QUEUES.${CONST}, SERVICE_TOKENS.${CONST})
   - libs/messaging messaging.module (ALL_SERVICES, QUEUE_BY_TOKEN)
   - libs/common  rpc-client       (rpc.${camel}(...))
   - package.json                  (start:dev:${kebab})
   - docker-compose.yml            (service '${kebab}')
   - .github/workflows/deploy.yml  (dispatch choice + ALL_SERVICES)

Next steps:
   1. pnpm exec nest build ${kebab}     # verify it compiles
   2. pnpm start:dev:${kebab}           # run it (needs docker compose infra)
   3. Add MSG.* patterns + handlers; call them from the gateway via
      rpc.${camel}(MSG.X, payload). Add a gateway /health pingService('${camel}')
      entry if you want the deep probe to cover it.
   4. pnpm exec prettier --write на изменённые файлы / pnpm lint`);
