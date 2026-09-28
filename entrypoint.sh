#!/bin/sh
set -e

mkdir -p /data
cd /data

inochi-backend &
BACK=$!
caddy run --config /data/Caddyfile --adapter caddyfile &
CADDY=$!
FRONT=

stop_all() {
  kill "$CADDY" $FRONT "$BACK" 2>/dev/null || true
  wait "$CADDY" $FRONT "$BACK" 2>/dev/null || true
}

trap stop_all INT TERM

until node /usr/local/lib/inochi/fetch-web.mjs; do
  [ -e /data/web/current/server.js ] && break
  if ! kill -0 "$BACK" 2>/dev/null || ! kill -0 "$CADDY" 2>/dev/null; then
    stop_all
    exit 1
  fi
  sleep 15 & wait $! || true
done

rm -f /data/web/restart
node /data/web/current/server.js &
FRONT=$!

while kill -0 "$BACK" 2>/dev/null && kill -0 "$FRONT" 2>/dev/null && kill -0 "$CADDY" 2>/dev/null; do
  if [ -e /data/web/restart ]; then
    rm -f /data/web/restart
    kill "$FRONT" 2>/dev/null || true
    wait "$FRONT" 2>/dev/null || true
    node /data/web/current/server.js &
    FRONT=$!
  fi
  sleep 2
done

stop_all
exit 1
