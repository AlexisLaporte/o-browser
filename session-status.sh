#!/bin/bash
# Get current session status or list all sessions
# Usage: session-status.sh [session_id]
set -e

# Base dir = where this script lives
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

SESSION_DIR="${BASE_DIR}/sessions"
SESSION_ID="$1"

if [ -n "$SESSION_ID" ]; then
    # Get specific session
    SESSION_FILE="${SESSION_DIR}/${SESSION_ID}.json"
    if [ -f "$SESSION_FILE" ]; then
        cat "$SESSION_FILE"
    else
        echo '{"error": "Session not found"}' >&2
        exit 1
    fi
elif [ -f "${SESSION_DIR}/current.json" ]; then
    # Get current session
    cat "${SESSION_DIR}/current.json"
else
    # List all sessions
    echo '{"sessions": ['
    FIRST=true
    for f in ${SESSION_DIR}/ses_*.json; do
        if [ -f "$f" ]; then
            if [ "$FIRST" = true ]; then
                FIRST=false
            else
                echo ","
            fi
            cat "$f"
        fi
    done
    echo ']}'
fi
