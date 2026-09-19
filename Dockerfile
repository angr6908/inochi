# Pinned to the same bun the runtime stage ships, so a build is reproducible
# and the version that compiles the bundle is the version that runs it.
FROM oven/bun:1.4.2-alpine AS web
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

FROM rust:1.98.1-alpine AS backend
RUN apk add --no-cache build-base openssl-dev openssl-libs-static pkgconfig
ENV OPENSSL_STATIC=1
WORKDIR /src
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --release && strip target/release/inochi-backend

# Bun is pinned exactly, because the runtime below must ship a libstdc++ at
# least as new as the one this binary was linked against. Bun 1.4.2's musl
# build links GCC 15.2, which is what alpine:3.24 ships (3.22 shipped 14.2 and
# fails with a GLIBCXX version error). Bump this and the runtime's alpine tag
# together, and check bun's own dockerhub/alpine/Dockerfile for the Alpine
# version it targets rather than assuming the newest one works.
FROM oven/bun:1.4.2-alpine AS bundist

FROM alpine:3.24 AS runtime
# Only the interpreter comes across, not the rest of oven/bun:1.4.2-alpine,
# since entrypoint.sh execs server.js directly. libgcc and libstdc++ are the
# pair bun's own Alpine image installs for its musl build; they are listed
# explicitly rather than leaning on libstdc++ pulling libgcc in, to match
# upstream and to make the dependency visible when the base is bumped.
COPY --from=bundist /usr/local/bin/bun /usr/local/bin/bun
# Some tooling shells out to a `node` binary by name. Nothing in this image is
# known to, but bun's own image ships the same fallback, and a symlink is
# cheaper than discovering the gap in production.
RUN apk add --no-cache ca-certificates caddy vips-tools libavif-apps libgcc libstdc++ \
    && ln -s /usr/local/bin/bun /usr/local/bin/node

WORKDIR /app

COPY --from=web /web/.next/standalone ./web
COPY --from=backend /src/target/release/inochi-backend /usr/local/bin/inochi-backend

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

# HOSTNAME keeps the Next server on loopback, so Caddy stays the only way in;
# it would otherwise default to 0.0.0.0. NODE_ENV is set because transitive deps
# (React among them) branch on it for dev-only warnings and bookkeeping, even
# though the standalone server.js itself hardcodes production. Bun reads both
# the same way node did.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1 \
    XDG_CONFIG_HOME=/data/.caddy/config \
    XDG_DATA_HOME=/data/.caddy/data

VOLUME ["/data"]

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
