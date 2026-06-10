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

1. Scaffold `apps/<name>` mirroring `apps/user` (`main.ts` → `bootstrapService`,
   an `app.module.ts`, a feature module with `@MessagePattern` handlers).
2. Register it in `nest-cli.json`.
3. Add its queue/token/exchange in `libs/common/src/constants/queue.constants.ts`
   (`QUEUES`, `SERVICE_TOKENS`, `MSG`) and to `ALL_SERVICES` / `QUEUE_BY_TOKEN`
   in `libs/messaging/src/messaging.module.ts`.
4. Add a routing helper on `RpcClientService` mirroring `user()` and extend the
   `ServiceName` union.
5. Add a typed config (extend `ServiceConfig`) and an `apps/<name>/.env.example`.

## Scripts

`build` · `start:dev[:gateway|:user]` · `lint` · `lint:env` · `test`
`test:cov` · `test:ci` · `e2e:smoke` · `format`
