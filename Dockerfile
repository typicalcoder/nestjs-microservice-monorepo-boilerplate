# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only the manifests so the dependency layer caches well.
COPY package.json pnpm-lock.yaml .npmrc* ./

# corepack ships with node and reads the pinned version from the
# `packageManager` field — no jq / manual version extraction needed.
RUN corepack enable

# Install ALL deps (dev+prod) for the build, with a shared store cache.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN corepack enable

# Build one nest project (apps/* or tasks/*) and copy the artifact to a
# detectable location — the runtime stage doesn't care whether it was an
# app or a task. `node -p` replaces jq for reading nest-cli.json.
ARG SERVICE
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm build ${SERVICE} && \
    ROOT=$(node -p "require('./nest-cli.json').projects['${SERVICE}']?.root ?? ''") && \
    test -n "$ROOT" || (echo "Unknown nest project: ${SERVICE}"; exit 1) && \
    mkdir -p /app/dist/_final && \
    cp -r /app/dist/${ROOT}/. /app/dist/_final/ && \
    echo "✅ Built ${SERVICE} (root=${ROOT}) into dist/_final" && \
    ls -la /app/dist/_final

# Upload sourcemaps to Sentry with debug IDs so stacktraces resolve to
# original TS even though the .map files are stripped from the runtime
# image. Skipped when the SENTRY_AUTH_TOKEN secret is absent (local builds
# without `--secret id=sentry_auth_token,...`).
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

COPY package.json pnpm-lock.yaml .npmrc* ./

RUN corepack enable

# Production dependencies only.
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

# The build stage already copied the final artifact into dist/_final —
# one canonical path for both apps/* and tasks/*.
COPY --from=build /app/dist/_final ./dist

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json .

# task-db-migrate loads CommonJS migrations at runtime via Node's
# resolver (see tasks/db-migrate/src/task.service.ts). Webpack
# intentionally does not inline them — they live next to the bundle so
# the migration set can grow without rebuilding the image format.
COPY --from=build /app/tools/migrations ./tools/migrations

EXPOSE 3000
CMD ["node", "dist/main.js"]
