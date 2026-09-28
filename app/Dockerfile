FROM oven/bun:1.4.2-alpine AS buncli

# Node 26.9.0 is only in Alpine edge. Both edge repositories are supplied for
# the package and its shared-library dependencies; the version is pinned.
FROM alpine:3.24
RUN apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    nodejs-current=26.9.0-r0 \
    && apk add --no-cache python3 vips-tools libavif-apps

WORKDIR /web
ARG APP_VERSION=dev
ARG BUILD_DATE=
ARG GIT_SHA=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE \
    NEXT_PUBLIC_GIT_SHA=$GIT_SHA
COPY --from=buncli /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . ./
RUN scripts/generate-inochi-wordmark.sh
# Next traces sharp into the standalone bundle, but nothing renders through it
# (image work goes through vips-tools).
RUN bun run build \
    && rm -rf .next/standalone/node_modules/@img/sharp-linux-* \
              .next/standalone/node_modules/@img/sharp-libvips-linux-*
