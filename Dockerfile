# Bun remains the package manager, but is copied only into the web build stage.
FROM oven/bun:1.4.2-alpine AS buncli

# Node 26.9.0 is only in Alpine edge. Both edge repositories are supplied for
# the package and its shared-library dependencies; the version is pinned.
FROM alpine:3.24 AS nodebase
RUN apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    nodejs-current=26.9.0-r0

FROM nodebase AS web
WORKDIR /web
ARG APP_VERSION=dev
ARG BUILD_DATE=
ARG GIT_SHA=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE \
    NEXT_PUBLIC_GIT_SHA=$GIT_SHA
COPY --from=buncli /usr/local/bin/bun /usr/local/bin/bun
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./
# Next traces sharp into the standalone bundle, but nothing renders through it
# (image work goes through vips-tools). Drop it here rather than in the runtime
# stage, where a later `rm` would only whiteout the layer, not shrink the image.
RUN bun run build \
    && rm -rf .next/standalone/node_modules/@img/sharp-linux-* \
              .next/standalone/node_modules/@img/sharp-libvips-linux-*

FROM rust:1.98.1-alpine AS backend
RUN apk add --no-cache build-base openssl-dev openssl-libs-static pkgconfig
ENV OPENSSL_STATIC=1
WORKDIR /src
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --release && strip target/release/inochi-backend

FROM nodebase AS runtime
RUN apk add --no-cache caddy vips-tools libavif-apps

WORKDIR /app

COPY --from=web /web/.next/standalone ./web
COPY --from=backend /src/target/release/inochi-backend /usr/local/bin/inochi-backend

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# HOSTNAME keeps the Next server on loopback, so Caddy stays the only way in;
# it would otherwise default to 0.0.0.0. NODE_ENV is set because transitive deps
# (React among them) branch on it for dev-only warnings and bookkeeping, even
# though the standalone server.js itself hardcodes production.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    XDG_CONFIG_HOME=/data/.caddy/config \
    XDG_DATA_HOME=/data/.caddy/data

VOLUME ["/data"]

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
