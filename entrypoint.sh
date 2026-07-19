#!/bin/sh
set -e

mkdir -p /data
cd /data

inochi-backend &
BACK=$!
bun --smol /app/web/server.js &
FRONT=$!
caddy run --config /data/Caddyfile --adapter caddyfile &
CADDY=$!

stop_all() {
  kill "$CADDY" "$FRONT" "$BACK" 2>/dev/null || true
  wait "$CADDY" "$FRONT" "$BACK" 2>/dev/null || true
}

trap stop_all INT TERM

while kill -0 "$BACK" 2>/dev/null && kill -0 "$FRONT" 2>/dev/null && kill -0 "$CADDY" 2>/dev/null; do
  sleep 2
done

stop_all
exit 1
