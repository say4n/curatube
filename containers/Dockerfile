FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

ENV BGUTIL_POT_VERSION=1.3.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    python3 \
    unzip \
  && corepack enable \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  # Deno is the JS runtime yt-dlp uses to solve YouTube's JS challenges.
  # The standalone yt-dlp binary bundles the yt-dlp-ejs solver scripts but
  # needs a supported JS runtime (deno by default) on PATH to run them.
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
  # Install the bgutil Proof-of-Origin token provider plugin and its
  # deno-based generation script. YouTube enforces PO tokens for GVS
  # (video-stream) requests; without one, medium/large downloads fail with
  # HTTP 403 mid-transfer. The script lives at the plugin's default home dir
  # and is invoked per download via deno.
  && mkdir -p /opt/yt-dlp-plugins /root/bgutil-ytdlp-pot-provider/server \
  && curl -fsSL -o /opt/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip \
    "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_VERSION}/bgutil-ytdlp-pot-provider.zip" \
  && curl -fsSL -o /tmp/bgutil.tgz \
    "https://codeload.github.com/Brainicism/bgutil-ytdlp-pot-provider/tar.gz/${BGUTIL_POT_VERSION}" \
  && tar -xzf /tmp/bgutil.tgz -C /root/bgutil-ytdlp-pot-provider/server --strip-components=2 \
      "bgutil-ytdlp-pot-provider-${BGUTIL_POT_VERSION}/server" \
  && rm -f /tmp/bgutil.tgz \
  && cd /root/bgutil-ytdlp-pot-provider/server \
  && deno install --allow-scripts=npm:canvas --frozen \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store

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
