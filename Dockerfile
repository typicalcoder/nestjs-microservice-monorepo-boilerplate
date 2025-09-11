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

# Строим конкретный сервис
ARG SERVICE
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm build ${SERVICE} && \
    echo "✅ Built ${SERVICE} into dist/apps/${SERVICE}" && \
    ls -la dist/apps/${SERVICE}

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

# Копируем билд конкретного сервиса
COPY --from=build /app/dist/apps/${SERVICE} ./dist

# Копируем только прод-зависимости
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json .

EXPOSE 3000
CMD ["node", "dist/main.js"]
