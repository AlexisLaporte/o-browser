#!/bin/bash
cd "$(dirname "$0")"
PORT=${PORT:-3100}
echo "Browser UI on http://localhost:$PORT/?token=YOUR_TOKEN"
echo "Note: API calls use relative paths, point browser to Cloud Run URL for remote"
npx serve -l $PORT .
