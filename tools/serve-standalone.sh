#!/usr/bin/env bash
# Serve a production Next build locally, the way the audits need it.
#
# `next build` produces a standalone server that does NOT include `.next/static`
# or `public` — Next expects the deploy step to copy them. Miss that and the
# server still answers 200 for every page while every JS chunk 404s, so the app
# never hydrates and each screen renders only its Suspense fallback.
#
# That is worth a script rather than a remembered incantation, because the
# failure is silent in exactly the way that matters: the theme audit once
# walked a whole console of unhydrated "…" placeholders and reported it clean.
#
# Usage: tools/serve-standalone.sh [web|partner] [port]
set -euo pipefail
APP_NAME="${1:-web}"
PORT="${2:-$([ "$APP_NAME" = "partner" ] && echo 3112 || echo 3111)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/$APP_NAME"
DIST="$APP/.next/standalone/apps/$APP_NAME"

[ -f "$DIST/server.js" ] || {
  echo "No standalone build — run: pnpm --filter @ciao/$APP_NAME build"
  exit 1
}

mkdir -p "$DIST/.next"
rm -rf "$DIST/.next/static" "$DIST/public"
cp -r "$APP/.next/static" "$DIST/.next/static"
[ -d "$APP/public" ] && cp -r "$APP/public" "$DIST/public"

# Kill whatever holds this port, so web and partner can run side by side.
#
# By port, not by command line: Next renames its process to "next-server
# (vX.Y.Z)" once it boots, so `pkill -f server.js` matches nothing and the old
# server survives a rebuild. It then serves HTML from the previous build while
# the freshly-copied static directory has new chunk hashes — every script 404s
# and the app renders as a blank Suspense fallback. Exactly the failure this
# script exists to prevent, arrived at from the other direction.
# Two ways, because each one misses a case on its own. `lsof` did not report a
# server whose working directory had been deleted by a clean rebuild — that
# process happily went on serving HTML out of deleted inodes, referencing chunk
# hashes that no longer existed on disk. Walking /proc for anything rooted in
# this app's dist catches it, "(deleted)" suffix and all.
if command -v lsof >/dev/null 2>&1; then
  holder=$(lsof -ti:"$PORT" 2>/dev/null || true)
  [ -n "$holder" ] && kill -9 $holder 2>/dev/null || true
fi
for pid in /proc/[0-9]*; do
  cwd=$(readlink "$pid/cwd" 2>/dev/null || true)
  case "$cwd" in
    "$DIST"|"$DIST "*|"$DIST (deleted)") kill -9 "$(basename "$pid")" 2>/dev/null || true ;;
  esac
done
sleep 1
cd "$DIST"
PORT="$PORT" HOSTNAME=0.0.0.0 setsid nohup node server.js > "/tmp/ciao-$APP_NAME-$PORT.log" 2>&1 < /dev/null &

code=000
for _ in $(seq 1 25); do
  sleep 1
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" || true)
  [ "$code" = "200" ] && break
done
# Prove a hashed chunk actually resolves — a 200 on the page proves nothing.
chunk=$(curl -s "http://localhost:$PORT/" | grep -o '_next/static/chunks/webpack-[a-z0-9]*\.js' | head -1)
chunk_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/$chunk")
echo "$APP_NAME on :$PORT — page $code, chunk $chunk_code"
[ "$chunk_code" = "200" ] || { echo "Static assets are not being served."; exit 1; }
