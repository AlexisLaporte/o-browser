#!/bin/bash
# Start browser API locally (same as prod, with VNC)
set -e
cd "$(dirname "$0")"

PORT=${PORT:-8080}

echo "=== Browser Local ==="

# Cleanup
pkill -f "node.*api-server" 2>/dev/null || true
mkdir -p sessions recordings

AUTH_TOKEN=local-dev-token node api-server.js &

echo "  API:  http://localhost:${PORT}"
echo "  VNC:  http://localhost:6080/vnc.html (quand une session est active)"
echo ""
echo "Ctrl+C pour arrêter"

trap "pkill -f 'node.*api-server'; exit" INT TERM
wait
