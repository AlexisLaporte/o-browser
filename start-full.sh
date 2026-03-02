#!/bin/bash
# Chrome with CDP + VNC (visual debugging)
set -e

DISPLAY_NUM=99
VNC_PORT=5900
NOVNC_PORT=6080
CDP_PORT=9222
CHROME_DATA_DIR=/tmp/chrome-o-browser

export DISPLAY=:${DISPLAY_NUM}

# Cleanup
pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "x11vnc.*:${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "websockify.*${NOVNC_PORT}" 2>/dev/null || true
pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
sleep 1

# 1. Virtual display
echo "Starting Xvfb..."
Xvfb :${DISPLAY_NUM} -screen 0 1920x1080x24 &
sleep 1

# 2. VNC server
echo "Starting x11vnc..."
x11vnc -display :${DISPLAY_NUM} -forever -shared -nopw -rfbport ${VNC_PORT} -bg -o /tmp/x11vnc.log
sleep 1

# 3. noVNC (web)
echo "Starting noVNC..."
websockify --web=/usr/share/novnc ${NOVNC_PORT} localhost:${VNC_PORT} > /tmp/novnc.log 2>&1 &
sleep 1

# 4. Chrome (headful, visible in VNC)
echo "Starting Chrome..."
google-chrome \
  --no-sandbox \
  --remote-debugging-port=${CDP_PORT} \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-dev-shm-usage \
  --user-data-dir=${CHROME_DATA_DIR} \
  --window-size=1920,1080 \
  --window-position=0,0 \
  "about:blank" &
sleep 2

echo ""
echo "=== Browser ready ==="
echo "CDP:   http://127.0.0.1:${CDP_PORT}"
echo "VNC:   http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=true"
curl -s http://127.0.0.1:${CDP_PORT}/json/version | head -1
