#!/bin/bash
# Start a browser session with recordings (screencast + HAR)
# Usage: start-session.sh [workflow_name] [profile_name]
set -e

WORKFLOW="${1:-manual}"
PROFILE="${2:-main}"
SESSION_ID="ses_$(date +%Y%m%d_%H%M%S)"
TIMEOUT_MINUTES=30

DISPLAY_NUM=99
VNC_PORT=5900
NOVNC_PORT=6080
CDP_PORT=9222

# VNC URL base - configurable for local vs remote mode
# Default: relative path (works on Cloud Run). Override with BROWSER_URL env var.
VNC_BASE_URL="${VNC_BASE_URL:-/vnc}"

# Base dir = where this script lives
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Persistent Chrome profile directory
PROFILES_BASE_DIR="${BASE_DIR}/profiles"
CHROME_DATA_DIR="${PROFILES_BASE_DIR}/${PROFILE}"
mkdir -p "${CHROME_DATA_DIR}/Default"
echo "Using Chrome profile: ${PROFILE} (${CHROME_DATA_DIR})"

# Remove stale Chrome lock files (left by unclean shutdown)
rm -f "${CHROME_DATA_DIR}/SingletonLock" "${CHROME_DATA_DIR}/SingletonCookie" "${CHROME_DATA_DIR}/SingletonSocket"

# Disable password manager popups
PREFS_FILE="${CHROME_DATA_DIR}/Default/Preferences"
if [ ! -f "$PREFS_FILE" ]; then
  echo '{}' > "$PREFS_FILE"
fi
python3 -c "
import json, sys
p = json.load(open('$PREFS_FILE'))
p.setdefault('credentials_enable_service', False)
p.setdefault('profile', {})['password_manager_enabled'] = False
json.dump(p, open('$PREFS_FILE', 'w'))
"

SESSION_DIR="${BASE_DIR}/sessions"
RECORDING_DIR="${BASE_DIR}/recordings/${SESSION_ID}"
SESSION_FILE="${SESSION_DIR}/${SESSION_ID}.json"

export DISPLAY=:${DISPLAY_NUM}
unset WAYLAND_DISPLAY  # Force X11 mode for all processes

# Check if session already running
if [ -f "${SESSION_DIR}/current.json" ]; then
    echo '{"error": "Session already running"}' >&2
    cat "${SESSION_DIR}/current.json"
    exit 1
fi

# Cleanup any orphan processes (use exact patterns)
pkill -x "Xvfb" 2>/dev/null || true
pkill -f "x11vnc -display :${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "websockify.*${NOVNC_PORT}.*${VNC_PORT}" 2>/dev/null || true
pkill -f "google-chrome.*--remote-debugging-port=${CDP_PORT}" 2>/dev/null || true
pkill -f "ffmpeg -y -f x11grab" 2>/dev/null || true
pkill -f "node.*har-recorder" 2>/dev/null || true
sleep 1

# Create recording directory
mkdir -p "${RECORDING_DIR}/screenshots"

# 1. Virtual display (redirect output to avoid blocking execSync)
Xvfb :${DISPLAY_NUM} -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 1

# 2. VNC server
x11vnc -display :${DISPLAY_NUM} -forever -shared -nopw -rfbport ${VNC_PORT} -bg -o /tmp/x11vnc.log
sleep 1

# 3. noVNC (web)
# noVNC path: /opt/novnc (Docker) or /usr/share/novnc (bare-metal)
NOVNC_WEB="/opt/novnc"
[ ! -d "$NOVNC_WEB" ] && NOVNC_WEB="/usr/share/novnc"
websockify --web="$NOVNC_WEB" ${NOVNC_PORT} localhost:${VNC_PORT} > /tmp/novnc.log 2>&1 &
NOVNC_PID=$!
sleep 1

# 4. Chrome
# --ozone-platform=x11 forces Chrome into Xvfb on bare-metal (not needed in Docker)
CHROME_OZONE_FLAG=""
[ ! -f /.dockerenv ] && CHROME_OZONE_FLAG="--ozone-platform=x11"
google-chrome \
  $CHROME_OZONE_FLAG \
  --no-sandbox \
  --remote-debugging-port=${CDP_PORT} \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-dev-shm-usage \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --hide-crash-restore-bubble \
  --disable-gpu \
  --disable-save-password-bubble \
  --user-data-dir=${CHROME_DATA_DIR} \
  --window-size=1920,1080 \
  --window-position=0,0 \
  "about:blank" > /tmp/chrome.log 2>&1 &
CHROME_PID=$!

# Wait for Chrome to start (retry CDP endpoint)
for i in $(seq 1 10); do
  curl -s http://127.0.0.1:${CDP_PORT}/json/version > /dev/null 2>&1 && break
  sleep 1
done

# 5. Start screencast with ffmpeg
ffmpeg -y -f x11grab -video_size 1920x1080 -framerate 10 -i :${DISPLAY_NUM} \
  -c:v libx264 -preset ultrafast -crf 28 \
  "${RECORDING_DIR}/screencast.mp4" > /tmp/ffmpeg.log 2>&1 &
FFMPEG_PID=$!

# 6. Start HAR recorder
HAR_PID=0
if [ -f "${BASE_DIR}/har-recorder.js" ]; then
  node "${BASE_DIR}/har-recorder.js" "${RECORDING_DIR}/network.har" ${CDP_PORT} > "${RECORDING_DIR}/har-recorder.log" 2>&1 &
  HAR_PID=$!
  sleep 1
  if ! kill -0 "$HAR_PID" 2>/dev/null; then
    echo "WARNING: HAR recorder failed to start"
    HAR_PID=0
  fi
fi

# 7. Get CDP WebSocket URL
CDP_INFO=$(curl -s http://127.0.0.1:${CDP_PORT}/json/version)
WS_URL=$(echo "$CDP_INFO" | grep -o '"webSocketDebuggerUrl": "[^"]*"' | cut -d'"' -f4)

# Calculate timeout timestamp
TIMEOUT_AT=$(date -d "+${TIMEOUT_MINUTES} minutes" +%s)
TIMEOUT_ISO=$(date -d "+${TIMEOUT_MINUTES} minutes" --iso-8601=seconds)

# Save session info
cat > "${SESSION_FILE}" << EOF
{
  "id": "${SESSION_ID}",
  "workflow": "${WORKFLOW}",
  "profile": "${PROFILE}",
  "started_at": "$(date --iso-8601=seconds)",
  "timeout_at": "${TIMEOUT_ISO}",
  "timeout_minutes": ${TIMEOUT_MINUTES},
  "pids": {
    "xvfb": ${XVFB_PID},
    "chrome": ${CHROME_PID},
    "novnc": ${NOVNC_PID},
    "ffmpeg": ${FFMPEG_PID},
    "har": ${HAR_PID}
  },
  "cdp": {
    "port": ${CDP_PORT},
    "ws_url": "${WS_URL}"
  },
  "vnc": {
    "port": ${VNC_PORT},
    "novnc_port": ${NOVNC_PORT},
    "url": "${VNC_BASE_URL}/vnc.html?autoconnect=true"
  },
  "recordings": {
    "dir": "${RECORDING_DIR}",
    "screencast": "${RECORDING_DIR}/screencast.mp4",
    "har": "${RECORDING_DIR}/network.har",
    "screenshots": "${RECORDING_DIR}/screenshots"
  },
  "status": "running"
}
EOF

# Mark as current session
cp "${SESSION_FILE}" "${SESSION_DIR}/current.json"

# Start timeout watchdog in background (close fd to not block parent)
(
  sleep $((TIMEOUT_MINUTES * 60))
  if [ -f "${SESSION_DIR}/current.json" ]; then
    CURRENT_ID=$(cat "${SESSION_DIR}/current.json" | grep -o '"id": "[^"]*"' | cut -d'"' -f4)
    if [ "$CURRENT_ID" = "${SESSION_ID}" ]; then
      "${BASE_DIR}/end-session.sh" timeout
    fi
  fi
) > /dev/null 2>&1 &
WATCHDOG_PID=$!

# Update session with watchdog PID
sed -i "s/\"status\": \"running\"/\"status\": \"running\",\n  \"watchdog_pid\": ${WATCHDOG_PID}/" "${SESSION_FILE}"
sed -i "s/\"status\": \"running\"/\"status\": \"running\",\n  \"watchdog_pid\": ${WATCHDOG_PID}/" "${SESSION_DIR}/current.json"

# Output session info
cat "${SESSION_FILE}"
