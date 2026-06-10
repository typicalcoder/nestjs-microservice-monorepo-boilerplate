# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# Устанавливаем необходимые инструменты
RUN apk add --no-cache git jq bash curl

# Копируем только package.json, pnpm-lock.yaml и .npmrc (для кэша)
COPY package.json pnpm-lock.yaml .npmrc* ./

# Установим pnpm (берём версию из package.json.engines.pnpm, иначе дефолт)
RUN PNPM_VERSION=$(jq -r '.engines.pnpm // empty' package.json) && \
    if [ -z "$PNPM_VERSION" ] || [ "$PNPM_VERSION" = "null" ]; then PNPM_VERSION=9.15.4; fi && \
    corepack enable && corepack prepare pnpm@$PNPM_VERSION --activate

# Устанавливаем все зависимости (dev+prod) для сборки, с кешем
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache git jq bash curl

# Копируем node_modules из deps
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Устанавливаем pnpm в этом stage, чтобы команда была доступна
RUN PNPM_VERSION=$(jq -r '.engines.pnpm // empty' package.json) && \
    if [ -z "$PNPM_VERSION" ] || [ "$PNPM_VERSION" = "null" ]; then PNPM_VERSION=9.15.4; fi && \
    corepack enable && corepack prepare pnpm@$PNPM_VERSION --activate

# Строим конкретный nest-project (apps/* или tasks/*). Копируем билд в
# detectable location — рантайм-stage не знает, было это app или task.
ARG SERVICE
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm build ${SERVICE} && \
    ROOT=$(jq -r ".projects[\"${SERVICE}\"].root" nest-cli.json) && \
    test -n "$ROOT" && test "$ROOT" != "null" || (echo "Unknown nest project: ${SERVICE}"; exit 1) && \
    mkdir -p /app/dist/_final && \
    cp -r /app/dist/${ROOT}/. /app/dist/_final/ && \
    echo "✅ Built ${SERVICE} (root=${ROOT}) into dist/_final" && \
    ls -la /app/dist/_final

# Upload sourcemaps to self-hosted Sentry with debug IDs so stacktraces
# resolve to original TS even though the .map files are stripped from
# the runtime image. Skipped when SENTRY_AUTH_TOKEN secret is absent
# (local builds without `--secret id=sentry_auth_token,...`).
ARG RELEASE_TAG=dev
ARG SENTRY_URL=https://sentry.lix.su
ARG SENTRY_ORG=lix
ARG SENTRY_PROJECT=app-be
RUN --mount=type=secret,id=sentry_auth_token \
    if [ -s /run/secrets/sentry_auth_token ] && [ -f /app/dist/_final/main.js.map ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)" && \
      export SENTRY_URL="${SENTRY_URL}" && \
      ./node_modules/.bin/sentry-cli sourcemaps inject /app/dist/_final && \
      ./node_modules/.bin/sentry-cli sourcemaps upload \
        --org "${SENTRY_ORG}" --project "${SENTRY_PROJECT}" \
        --release "${RELEASE_TAG}" --dist "${SERVICE}" \
        /app/dist/_final && \
      echo "✅ Uploaded sourcemaps for ${SERVICE} @ ${RELEASE_TAG} to ${SENTRY_URL}"; \
    else \
      echo "⏭  Skipping Sentry sourcemap upload (no token or no .map files)"; \
    fi && \
    find /app/dist/_final -name '*.map' -delete

# ---------- Stage 3: prod-deps ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache git jq bash curl

COPY package.json pnpm-lock.yaml .npmrc* ./

# Устанавливаем pnpm
RUN PNPM_VERSION=$(jq -r '.engines.pnpm // empty' package.json) && \
    if [ -z "$PNPM_VERSION" ] || [ "$PNPM_VERSION" = "null" ]; then PNPM_VERSION=9.15.4; fi && \
    corepack enable && corepack prepare pnpm@$PNPM_VERSION --activate

# Ставим только production зависимости
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm install --frozen-lockfile --prod

# ---------- Stage 4: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
USER node

ARG SERVICE

# Build metadata baked into the image. RELEASE_TAG is consumed by
# `initSentry` (libs/common/src/bootstrap/telemetry.ts) as the Sentry
# `release` identifier — maps errors/traces to the exact commit. CI
# passes `--build-arg RELEASE_TAG=${{ github.sha }}`; local builds
# default to `dev` so Sentry still groups them distinctly from prod.
ARG RELEASE_TAG=dev
ENV RELEASE_TAG=${RELEASE_TAG}

# Билд-stage уже скопировал финальный артефакт в dist/_final — каноничный
# путь одинаков и для apps/*, и для tasks/*.
COPY --from=build /app/dist/_final ./dist

# Копируем только прод-зависимости
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json .

# task-db-migrate loads CommonJS migrations at runtime via Node's
# resolver (see tasks/db-migrate/src/task.service.ts). Webpack
# intentionally does not inline them — they live next to the bundle so
# the migration set can grow without rebuilding the image format.
COPY --from=build /app/tools/migrations ./tools/migrations

EXPOSE 3000
CMD ["node", "dist/main.js"]
