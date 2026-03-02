#!/bin/bash
# Take a screenshot of current session
# Usage: screenshot.sh [name]
set -e

NAME="${1:-$(date +%H%M%S)}"

# Base dir = where this script lives
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

SESSION_DIR="${BASE_DIR}/sessions"
CURRENT_FILE="${SESSION_DIR}/current.json"

if [ ! -f "$CURRENT_FILE" ]; then
    echo '{"error": "No active session"}' >&2
    exit 1
fi

RECORDING_DIR=$(cat "$CURRENT_FILE" | grep -o '"dir": "[^"]*"' | cut -d'"' -f4)
SCREENSHOT_PATH="${RECORDING_DIR}/screenshots/${NAME}.png"

export DISPLAY=:99
import -window root "$SCREENSHOT_PATH"

echo "{\"screenshot\": \"${SCREENSHOT_PATH}\"}"
