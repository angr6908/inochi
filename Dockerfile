FROM oven/bun:alpine AS web
WORKDIR /web
ARG APP_VERSION=dev
ARG BUILD_DATE=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE
COPY app/package.json app/bun.lock ./
RUN bun install
COPY app/ ./
RUN bun run build

FROM rust:alpine AS backend
RUN apk add --no-cache build-base openssl-dev openssl-libs-static pkgconfig
ENV OPENSSL_STATIC=1
WORKDIR /src
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --release && strip target/release/inochi-backend

FROM alpine:latest AS web-runtime
WORKDIR /web
COPY --from=web /web/.next/standalone ./
COPY --from=web /web/.next/static ./.next/static
RUN rm -rf node_modules/@img/sharp-linux-* node_modules/@img/sharp-libvips-linux-*

FROM alpine:latest AS runtime
RUN apk add --no-cache ca-certificates caddy nodejs vips-tools libavif-apps

WORKDIR /app

COPY --from=web-runtime /web ./web
COPY --from=backend /src/target/release/inochi-backend /usr/local/bin/inochi-backend

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    XDG_CONFIG_HOME=/data/.caddy/config \
    XDG_DATA_HOME=/data/.caddy/data

VOLUME ["/data"]

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
