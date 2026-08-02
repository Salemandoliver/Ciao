#!/usr/bin/env bash
# Serve the production web build locally, the way the audits need it.
#
# `next build` produces a standalone server that does NOT include `.next/static`
# or `public` — Next expects the deploy step to copy them in. Miss that and the
# server still answers 200 for every page while every JS chunk 404s, so the app
# never hydrates and each screen renders only its Suspense fallback.
#
# That is worth a script rather than a remembered incantation, because the
# failure is silent in exactly the way that matters: the theme audit walked a
# whole console of unhydrated "…" placeholders and reported it clean.
#
# Usage: tools/serve-standalone.sh [port]
set -euo pipefail
PORT="${1:-3111}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/web"
DIST="$APP/.next/standalone/apps/web"

[ -f "$DIST/server.js" ] || { echo "No standalone build — run: pnpm --filter @ciao/web build"; exit 1; }

rm -rf "$DIST/.next/static" "$DIST/public"
cp -r "$APP/.next/static" "$DIST/.next/static"
cp -r "$APP/public" "$DIST/public"

pkill -f "next-server" 2>/dev/null || true
sleep 1
cd "$DIST"
PORT="$PORT" HOSTNAME=0.0.0.0 setsid nohup node server.js > /tmp/ciao-web-$PORT.log 2>&1 < /dev/null &
for _ in $(seq 1 20); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true)
  [ "$code" = "200" ] && break
done
# Prove a hashed chunk actually resolves — a 200 on the page proves nothing.
chunk=$(curl -s "http://localhost:$PORT/" | grep -o '_next/static/chunks/webpack-[a-z0-9]*\.js' | head -1)
chunk_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/$chunk")
echo "web on :$PORT — page $code, chunk $chunk_code"
[ "$chunk_code" = "200" ] || { echo "Static assets are not being served."; exit 1; }
