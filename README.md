# NestJS Microservice Monorepo Boilerplate

Production-shaped starter for a NestJS microservice backend: an HTTP **gateway**
that proxies to RabbitMQ-backed **microservices**, with batteries included —
JWT + OAuth auth, MikroORM/MongoDB, typed config, observability, health checks,
rate limiting, a transactional outbox, and k8s task runners.

It ships with one example microservice (`user`) and a complete auth flow so you
can clone it, rename the namespace, and start adding domain services.

## Stack

| Concern         | Choice |
|-----------------|--------|
| Framework       | NestJS 11 (monorepo via `nest-cli` projects) |
| Language / RT   | TypeScript 5.8, Node 22.17+, pnpm |
| HTTP            | Express 5 + Helmet + `@nestjs/throttler` |
| Transport (RPC) | RabbitMQ (`@nestjs/microservices`, durable queues, topic-exchange events) |
| Database        | MongoDB 8 via MikroORM 7 (Repository pattern, soft-delete) |
| Auth            | JWT access/refresh/device + Passport, argon2 hashing, VK/Yandex OAuth |
| Cache / tokens  | Redis (`ioredis`) — refresh-token blacklist |
| Docs            | Swagger / OpenAPI at `/docs` |
| Observability   | Winston logging, Sentry, Prometheus `/metrics`, `@nestjs/terminus` health |
| Tests           | Jest + Supertest |

## Layout

```
apps/
  gateway/        HTTP edge — auth, users proxy, health, /metrics, Swagger
  user/           example microservice — owns the User collection + auth RPC
libs/
  common/         bootstrap, config, DTOs, enums, exceptions, filters,
                  interceptors, observability, RpcClientService, MSG constants
  database/       MikroORM config + entities (User, Device, OutboxEvent)
  messaging/      RabbitMQ wiring: CustomAmqpProxy, EventBus, outbox dispatcher
tasks/
  db-migrate/     k8s Job — applies tools/migrations/*.cjs (raw mongodb driver)
  user-purge/     k8s CronJob — hard-deletes soft-deleted users past grace
tools/
  migrations/     versioned migration scripts
  audit-env.mjs   cross-check typed config ↔ runtime reads ↔ .env.example
  e2e-smoke.sh    curl smoke suite against a running gateway
```

Path aliases (`tsconfig.json`): `@app/common`, `@app/database`, `@app/messaging`.

## Architecture

- The **gateway** speaks HTTP, holds no database. Every read/write is an RPC
  call to a microservice via `RpcClientService` (`rpc.user(MSG.X, payload)`).
  Errors cross the wire as a typed `RpcErrorPayload` and are rehydrated into the
  correct `HttpException` on the gateway.
- **Microservices** are RMQ consumers bootstrapped by `bootstrapService()`:
  durable queue, `noAck`, global validation pipe, trace-id context, RPC
  exception filter, Prometheus metrics, graceful shutdown.
- **Events**: `RpcClientService.publishEvent()` fans out over a topic exchange;
  failed handlers land in a per-service dead-letter queue. For at-least-once
  delivery, stage rows through the **outbox** (`OutboxModule`) instead.
- **Config** is class-validated at boot (`validateEnvWith(SomeConfig)`), so a
  misconfigured pod fails fast with a single aggregated error.

## Auth flow

JWT access (short) + refresh (long, device-bound, `tokenVersion`-gated) +
device token. Endpoints: `/v1/auth/autoreg`, `/login`, `/upgrade`, `/refresh`,
`/logout`, `/forgot`, `/reset`, `/oauth/:provider` (VK, Yandex). See
`docs/AUTH-FLOW.md` for the decision tree.

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill JWT secrets: openssl rand -hex 64
docker compose up -d mongodb redis rabbitmq

pnpm start:dev:gateway        # http://localhost:3000  (Swagger at /docs)
pnpm start:dev:user           # in another terminal

pnpm test                     # unit tests
bash tools/e2e-smoke.sh       # smoke the running stack
```

Or build & run everything in containers: `docker compose up --build`.

## Adding a microservice

```bash
pnpm scaffold billing      # any kebab-case name
pnpm exec nest build billing
```

The generator (`tools/scaffold-service.mjs`) creates `apps/<name>` (bootstrap,
app module, feature module with a PING handler, tsconfig, .env.example) and
wires it everywhere: `nest-cli.json`, queue constants (`QUEUES` /
`SERVICE_TOKENS`), `MessagingModule` (`ALL_SERVICES` / `QUEUE_BY_TOKEN`),
`RpcClientService` (`rpc.<name>()` helper), `package.json` scripts,
`docker-compose.yml`, and the deploy workflow. Edits are anchored — if a file
has diverged from the template the script aborts before writing and tells you
what to wire manually.

Afterwards: add `MSG.*` patterns + `@MessagePattern` handlers, optionally a
typed config class extending `ServiceConfig`, and a `pingService('<name>')`
entry in the gateway health controller.

## Scripts

`build` · `start:dev[:gateway|:user]` · `scaffold <name>` · `lint` · `lint:env`
`test` · `test:cov` · `test:ci` · `e2e:smoke` · `format`
