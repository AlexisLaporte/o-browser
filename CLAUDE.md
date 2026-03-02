# o-browser — Generic Headless Chrome Service

Upstream project for headless Chrome containers with VNC, CDP, and session management.

## Stack

- **Runtime:** Node.js + Bash
- **Browser:** Patchright Chrome for Testing (anti-detection patched Chromium)
- **Services:** Xvfb, x11vnc, noVNC, ffmpeg (screencast), nginx (reverse proxy)
- **Port:** 8080 (nginx routes all traffic)

## Structure

```
o-browser/
├── Dockerfile              # node:20-slim + Patchright Chrome + VNC + ffmpeg
├── docker-compose.yml      # Local dev config (volume mounts, ports)
├── docker-entrypoint.sh    # Container startup (socat, API server, nginx)
├── start-session.sh        # Launches Chrome + Xvfb + VNC + ffmpeg per session
├── end-session.sh          # Stops session processes and saves recordings
├── api-server.js           # HTTP API (sessions, recordings, screenshots)
├── session-recorder.js     # Unified recorder: rrweb DOM + HAR with bodies + browser state
├── nginx.conf              # Reverse proxy: /api, /vnc, /cdp on port 8080
├── profiles/               # Chrome profiles (volume-mounted, gitignored)
├── recordings/             # Session recordings (gitignored)
├── sessions/               # Session state (gitignored)
└── index.html/style.css/app.js  # Status page UI
```

### Recording output per session
```
recordings/ses_YYYYMMDD_HHMMSS/
├── rrweb-events.json       # DOM + interactions (rejouable avec rrweb-player)
├── network.har             # HAR 1.2 with response bodies (compatible Playwright routeFromHAR)
├── browser-state.jsonl     # Cookies/localStorage/sessionStorage snapshots (JSONL)
├── screencast.mp4          # Video continue (ffmpeg x11grab)
├── session-recorder.log    # Recorder logs
└── screenshots/            # Manual screenshots via API
```

## Nginx Routing (port 8080)

| Path | Upstream | Notes |
|------|----------|-------|
| `/api/` | `127.0.0.1:3080` | API server |
| `/vnc/` | `127.0.0.1:6080` | noVNC static + WebSocket |
| `/cdp/` | `127.0.0.1:9222` | Chrome DevTools Protocol |
| `/` | `/app/ui` | Static status page |

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Start session (profile) |
| `GET` | `/api/sessions/current` | Current session info |
| `DELETE` | `/api/sessions/current` | End current session |
| `POST` | `/api/sessions/current/screenshot` | Take screenshot |
| `GET` | `/api/sessions/:id/files` | List session recordings |
| `GET` | `/api/recordings/:sessionId/:filename` | Serve recording file |
| `GET` | `/api/profiles` | List available profiles |
| `GET` | `/health` | Health check |

## Gotchas

- **Patchright Chrome**: Binary at `/app/.browsers/chromium-*/chrome-linux64/chrome`, symlinked to `/usr/bin/google-chrome`
- **Profile incompatibility**: Profiles from different Chromium builds may crash. Reset profile if "Trace/breakpoint trap"
- **Cookie encryption**: Chrome encrypts cookies per-build — cookies from a different build are unreadable
- **SingletonLock**: `start-session.sh` cleans stale locks before launch

## Downstream forks

- `roundtable/browser-service` — adds profile seeds and Roundtable-specific config
