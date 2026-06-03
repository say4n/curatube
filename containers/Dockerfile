FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3 \
  && corepack enable \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev", "--hostname", "0.0.0.0"]

FROM deps AS builder
ARG CURATUBE_BUILD_COMMIT=
ENV CURATUBE_BUILD_COMMIT=$CURATUBE_BUILD_COMMIT
COPY . .
RUN printf "%s" "$CURATUBE_BUILD_COMMIT" > .curatube-build-commit \
  && CURATUBE_DB_PATH=:memory: pnpm build

FROM base AS runner
LABEL org.opencontainers.image.source="https://github.com/say4n/curatube"
ARG CURATUBE_BUILD_COMMIT=

ENV NODE_ENV=production
ENV CURATUBE_DATA_DIR=/data
ENV CURATUBE_CONFIG_DIR=/data/config
ENV CURATUBE_MEDIA_DIR=/data/media
ENV CURATUBE_DB_PATH=/data/curatube.sqlite
ENV CURATUBE_BUILD_COMMIT=$CURATUBE_BUILD_COMMIT

WORKDIR /app

RUN mkdir -p /data/config /data/media

COPY --from=builder /app/public ./public
COPY --from=builder /app/.curatube-build-commit ./.curatube-build-commit

# Automatically leverage output traces to reduce image size
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
