# o-browser — Headless Chrome Service

Remote Chrome with API, VNC, CDP proxy, and session recording.

## Stack

- **Runtime**: Node.js 20 + Bash
- **Browser**: Google Chrome stable (default), configurable via `BROWSER` build arg
- **Recording**: rrweb DOM replay + HAR with bodies + browser state snapshots
- **Dependencies**: ws, @rrweb/record

## Structure

```
o-browser/
├── api-server.js           # HTTP API (sessions, recordings, screenshots)
├── session-recorder.js     # rrweb DOM + HAR + browser state via CDP
├── start-session.sh        # Launches Chrome + Xvfb + VNC + ffmpeg + recorder
├── end-session.sh          # Stops session, saves recordings
├── ui/                     # Status page (index.html, app.js, style.css)
├── Dockerfile              # ARG BROWSER=chrome|chrome-beta|chromium
├── docker-compose.yml
├── docker-entrypoint.sh
├── nginx.conf              # Reverse proxy: /api, /vnc, /cdp on port 8080
└── package.json
```

## Docker

```bash
docker build -t o-browser .                              # Chrome stable (default)
docker build --build-arg BROWSER=chrome-beta -t o-browser .  # Chrome Beta
docker build --build-arg BROWSER=chromium -t o-browser .     # Chromium
```

## API (port 8080 via nginx)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Start session `{workflow, profile}` |
| `GET` | `/api/sessions/current` | Current session (CDP URL, VNC, status) |
| `DELETE` | `/api/sessions/current` | End session |
| `POST` | `/api/sessions/current/screenshot` | X11 screenshot `{name}` |
| `GET` | `/api/sessions/:id/files` | List recordings (screencast, HAR, rrweb, state) |
| `GET` | `/api/recordings/:id/:file` | Serve recording file (Range support) |
| `GET` | `/api/profiles` | List Chrome profiles |
| `GET` | `/health` | Health check |

## Profiles

- `profiles/` — persistent Chrome profiles (volume-mounted)
- `profiles-seed/` — initial profile data, copied on first use if profile doesn't exist

## Recording

Per-session output in `recordings/<session_id>/`:
- `rrweb-events.json` — DOM interactions (replay format)
- `network.har` — HAR 1.2 with response bodies
- `browser-state.jsonl` — cookies/localStorage/sessionStorage snapshots
- `screencast.mp4` — X11 video capture
- `screenshots/` — step snapshots (from automation)

## Downstream

- `roundtable/browser-service` — fork with Wise profile seeds
