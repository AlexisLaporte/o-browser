#!/bin/bash
set -e

echo "Starting Browser container..."

# Trap SIGTERM for graceful shutdown (Cloud Run scale-down)
cleanup() {
  echo "SIGTERM received, cleaning up..."
  /app/end-session.sh sigterm 2>/dev/null || true
  nginx -s quit 2>/dev/null || true
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# Start socat CDP relay (Chrome binds to localhost, socat exposes it)
echo "Starting socat CDP relay..."
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

# Start API server on internal port (nginx proxies to it)
echo "Starting API server on port 3080 (internal)..."
PORT=3080 node /app/api-server.js &

# Start nginx (background — not exec, so trap works)
echo "Starting nginx on port 8080..."
nginx &
NGINX_PID=$!

# Wait for nginx (keeps container alive, allows trap to fire)
wait $NGINX_PID
