#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"

# Ensure PostgreSQL is running via Docker Compose
if ! docker compose ps --status running --format '{{.Name}}' 2>/dev/null | grep -q postgres; then
  echo "Starting PostgreSQL via docker compose..."
  docker compose up -d --wait
fi

# Check if the port is already in use before starting
if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PID=$(lsof -ti :"$PORT" -sTCP:LISTEN)
  PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "unknown")
  echo "ERROR: Port $PORT is already in use by '$PROC' (PID $PID)"
  echo "  Kill it with: kill $PID"
  echo "  Or use a different port: PORT=3001 pnpm dev:tunnel"
  exit 1
fi

if [ "${WITH_DEV:-}" = "1" ]; then
  pnpm exec tsx watch src/index.ts &
  DEV_PID=$!

  for i in $(seq 1 30); do
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "ERROR: Dev server crashed on startup."
      exit 1
    fi
    if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
      echo "Dev server is ready on port $PORT"
      break
    fi
    sleep 0.5
  done

  if ! curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "ERROR: Dev server did not become ready in time."
    exit 1
  fi
fi

if ! command -v ngrok &>/dev/null; then
  echo "ngrok not found. Install it with: brew install ngrok"
  exit 1
fi

# Kill any existing ngrok process to avoid ERR_NGROK_108 (free tier allows 1 session)
if pgrep -x ngrok >/dev/null 2>&1; then
  echo "Killing existing ngrok process..."
  pkill -x ngrok
  sleep 1
fi

if [ -f .env ]; then
  WEBHOOK_SECRET=$(grep -E '^WEBHOOK_SECRET=' .env | cut -d'=' -f2- | tr -d '"' || true)
fi

if [ -z "${WEBHOOK_SECRET:-}" ]; then
  echo "Warning: WEBHOOK_SECRET not found in .env"
fi

ngrok http "$PORT" --log=stdout --log-format=json > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

cleanup() {
  kill "$NGROK_PID" 2>/dev/null || true
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting ngrok tunnel on port $PORT..."

# Wait for ngrok to start and verify it didn't crash
for i in $(seq 1 30); do
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo ""
    echo "ERROR: ngrok exited unexpectedly."
    if grep -q "ERR_NGROK_108" /tmp/ngrok.log 2>/dev/null; then
      echo "  Another ngrok session is active (free tier limit)."
      echo "  Kill it: killall ngrok — or disconnect at https://dashboard.ngrok.com/agents"
    elif grep -q "authentication failed" /tmp/ngrok.log 2>/dev/null; then
      echo "  Authentication failed. Check: ngrok config add-authtoken YOUR_TOKEN"
    else
      echo "  Check /tmp/ngrok.log for details."
    fi
    exit 1
  fi

  URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [ -n "$URL" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "${URL:-}" ]; then
  echo "Failed to start ngrok. Check: ngrok config add-authtoken YOUR_TOKEN"
  exit 1
fi

echo ""
echo "======================================"
echo "  ngrok tunnel is running"
echo "======================================"
echo ""
echo "  Public URL:  $URL"
echo ""
if [ -n "${WEBHOOK_SECRET:-}" ]; then
  echo "  Simplo webhook URL (copy this):"
  echo "  $URL/webhooks/simplo?token=$WEBHOOK_SECRET"
else
  echo "  Simplo webhook URL:"
  echo "  $URL/webhooks/simplo?token=YOUR_WEBHOOK_SECRET"
fi
echo ""
echo "  ngrok inspector: http://localhost:4040"
echo "======================================"
echo ""
echo "Press Ctrl+C to stop the tunnel."
echo ""

# Monitor both processes — exit if either dies
if [ -n "${DEV_PID:-}" ]; then
  while true; do
    if ! kill -0 "$NGROK_PID" 2>/dev/null; then
      echo "ngrok process exited."
      break
    fi
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "Dev server exited unexpectedly."
      break
    fi
    sleep 1
  done
else
  wait "$NGROK_PID" || true
fi
