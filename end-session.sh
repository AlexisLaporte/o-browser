#!/bin/bash
# End current browser session
REASON="${1:-manual}"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_DIR="${BASE_DIR}/sessions"
CURRENT_FILE="${SESSION_DIR}/current.json"

if [ ! -f "$CURRENT_FILE" ]; then
    echo '{"error": "No active session"}' >&2
    exit 1
fi

# Read session info
SESSION_ID=$(jq -r .id "$CURRENT_FILE")
WORKFLOW=$(jq -r .workflow "$CURRENT_FILE")
STARTED_AT=$(jq -r .started_at "$CURRENT_FILE")
RECORDING_DIR=$(jq -r .recordings.dir "$CURRENT_FILE")

# Graceful Chrome shutdown first (let it save profile state)
CHROME_PID=$(jq -r ".pids.chrome // empty" "$CURRENT_FILE" 2>/dev/null)
if [ -n "$CHROME_PID" ] && [ "$CHROME_PID" != "null" ] && [ "$CHROME_PID" != "0" ]; then
    kill -TERM "$CHROME_PID" 2>/dev/null || true
    # Wait up to 3s for Chrome to save state
    for i in $(seq 1 6); do
        kill -0 "$CHROME_PID" 2>/dev/null || break
        sleep 0.5
    done
    kill -9 "$CHROME_PID" 2>/dev/null || true
fi

# Graceful ffmpeg shutdown (SIGTERM lets it write the moov atom to finalize the MP4)
FFMPEG_PID=$(jq -r ".pids.ffmpeg // empty" "$CURRENT_FILE" 2>/dev/null)
if [ -n "$FFMPEG_PID" ] && [ "$FFMPEG_PID" != "null" ] && [ "$FFMPEG_PID" != "0" ]; then
    kill -TERM "$FFMPEG_PID" 2>/dev/null || true
    for i in $(seq 1 10); do
        kill -0 "$FFMPEG_PID" 2>/dev/null || break
        sleep 0.5
    done
    kill -9 "$FFMPEG_PID" 2>/dev/null || true
fi

# Kill remaining processes
for pid_key in har xvfb novnc watchdog; do
    pid=$(jq -r ".pids.$pid_key // .${pid_key}_pid // empty" "$CURRENT_FILE" 2>/dev/null)
    if [ -n "$pid" ] && [ "$pid" != "null" ] && [ "$pid" != "0" ]; then
        kill -9 "$pid" 2>/dev/null || true
    fi
done

# Additional cleanup
pkill -9 -x Xvfb 2>/dev/null || true

# Get stats (with timeout to avoid hanging)
ENDED_AT=$(date --iso-8601=seconds)
VIDEO_SIZE=0
if [ -f "${RECORDING_DIR}/screencast.mp4" ]; then
    VIDEO_SIZE=$(stat -c%s "${RECORDING_DIR}/screencast.mp4" 2>/dev/null || echo 0)
fi

# Write final session file
SESSION_FILE="${SESSION_DIR}/${SESSION_ID}.json"
cat > "${SESSION_FILE}" << EOF
{
  "id": "${SESSION_ID}",
  "workflow": "${WORKFLOW}",
  "started_at": "${STARTED_AT}",
  "ended_at": "${ENDED_AT}",
  "end_reason": "${REASON}",
  "recordings": {
    "dir": "${RECORDING_DIR}",
    "screencast_size": ${VIDEO_SIZE}
  },
  "status": "completed"
}
EOF

rm -f "$CURRENT_FILE"
cat "${SESSION_FILE}"
