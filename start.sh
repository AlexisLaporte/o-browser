#!/bin/bash
# Start Chrome with CDP on localhost:9222
set -e

CDP_PORT=9222
CHROME_DATA_DIR=/tmp/chrome-o-browser

pkill -f "chrome.*remote-debugging-port" 2>/dev/null || true
sleep 1

google-chrome   --headless=new   --no-sandbox   --remote-debugging-port=${CDP_PORT}   --remote-debugging-address=127.0.0.1   --no-first-run   --no-default-browser-check   --disable-background-timer-throttling   --disable-backgrounding-occluded-windows   --disable-renderer-backgrounding   --disable-dev-shm-usage   --disable-gpu   --user-data-dir=${CHROME_DATA_DIR}   --window-size=1920,1080 &

sleep 2
curl -s http://127.0.0.1:${CDP_PORT}/json/version | head -1 && echo 'Chrome CDP ready on 127.0.0.1:9222'
