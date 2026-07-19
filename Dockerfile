FROM oven/bun:1.3.14-alpine AS web
WORKDIR /web
ARG APP_VERSION=dev
ARG BUILD_DATE=
ARG GIT_SHA=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE \
    NEXT_PUBLIC_GIT_SHA=$GIT_SHA
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./
# Next traces sharp into the standalone bundle, but nothing renders through it
# (image work goes through vips-tools). Drop it here rather than in the runtime
# stage, where a later `rm` would only whiteout the layer, not shrink the image.
RUN bun run build \
    && rm -rf .next/standalone/node_modules/@img/sharp-linux-* \
              .next/standalone/node_modules/@img/sharp-libvips-linux-*

FROM rust:1.96.0-alpine AS backend
RUN apk add --no-cache build-base openssl-dev openssl-libs-static pkgconfig
ENV OPENSSL_STATIC=1
WORKDIR /src
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --release && strip target/release/inochi-backend

FROM alpine:latest AS runtime
# alpine:latest ships no Bun, so install it from bun.com and switch to the
# canary channel. BUN_INSTALL=/usr/local puts the binary on PATH at
# /usr/local/bin/bun; install-only tools go in a virtual package dropped
# afterward, leaving just the musl runtime libs Bun links against.
ENV BUN_INSTALL=/usr/local
RUN apk add --no-cache ca-certificates caddy vips-tools libavif-apps libgcc libstdc++ \
    && apk add --no-cache --virtual .bun-deps bash curl unzip \
    && curl -fsSL https://bun.com/install | bash \
    && bun upgrade --canary \
    && apk del .bun-deps

WORKDIR /app

COPY --from=web /web/.next/standalone ./web
COPY --from=backend /src/target/release/inochi-backend /usr/local/bin/inochi-backend

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# HOSTNAME keeps the Next server on loopback, so Caddy stays the only way in;
# it would otherwise default to 0.0.0.0. NODE_ENV is not set here: the
# standalone server.js hardcodes production and nothing else reads it.
ENV NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    XDG_CONFIG_HOME=/data/.caddy/config \
    XDG_DATA_HOME=/data/.caddy/data

VOLUME ["/data"]

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
