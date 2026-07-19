FROM oven/bun:canary-alpine AS web
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

# node:26-alpine is Alpine 3.24-based, so the runtime below must stay on 3.24 to
# keep the copied binary's musl ABI matched. Bump both tags together.
FROM node:26-alpine AS nodedist

FROM alpine:3.24 AS runtime
# Only the interpreter comes across, not the rest of node:26-alpine: npm, the
# C++ headers and friends are build-time tooling worth ~18MB that nothing here
# invokes, since entrypoint.sh execs server.js directly. The binary declares
# exactly three NEEDED libs - libstdc++.so.6, libgcc_s.so.1, libc.musl - and
# interpreter /lib/ld-musl-x86_64.so.1; musl is in the base and libstdc++ pulls
# libgcc in with it, so this apk line is the complete runtime closure.
COPY --from=nodedist /usr/local/bin/node /usr/local/bin/node
RUN apk add --no-cache ca-certificates caddy vips-tools libavif-apps libstdc++

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
