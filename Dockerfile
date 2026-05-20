# syntax=docker/dockerfile:1

ARG BUN_VERSION=1.3.0

FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY bunfig.toml tsconfig.json tsconfig.types.json ./
COPY scripts ./scripts
COPY src ./src
RUN bun run build:cli

FROM oven/bun:${BUN_VERSION}-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION}-alpine
ARG CREATED="unknown"
ARG REVISION="unknown"
ARG VERSION="dev"

LABEL org.opencontainers.image.title="Nectar" \
  org.opencontainers.image.description="Ghost-theme-compatible static site generator powered by Markdown and Bun" \
  org.opencontainers.image.url="https://github.com/t09tanaka/nectar" \
  org.opencontainers.image.source="https://github.com/t09tanaka/nectar" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.created="${CREATED}" \
  org.opencontainers.image.revision="${REVISION}" \
  org.opencontainers.image.version="${VERSION}"

WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules /opt/nectar/node_modules
COPY --from=build /app/dist /opt/nectar/dist
COPY package.json README.md CHANGELOG.md LICENSE /opt/nectar/

RUN ln -s /opt/nectar/dist/cli.mjs /usr/local/bin/nectar

ENTRYPOINT ["nectar", "build"]
