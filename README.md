# o-browser

Generic headless Chrome browser service with VNC, CDP, and session management.

## Quick start

```bash
AUTH_TOKEN=your-secret-token docker compose up -d
```

Open http://localhost:8080/?token=your-secret-token

## Features

- Chrome headful in virtual display (Xvfb)
- VNC access via WebSocket (noVNC)
- CDP endpoint for Playwright/Puppeteer
- Session management API (start/stop, recordings)
- Web UI for manual control
- Anti-detection via Patchright (patched Chromium)

## Endpoints

| Path | Auth | Description |
|------|------|-------------|
| `/` | - | Web UI |
| `/api/*` | Bearer token | Session management API |
| `/vnc?token=xxx` | Query param | VNC WebSocket |
| `/cdp/*` | Bearer token | Chrome DevTools Protocol |

## API

### Start session
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"profile":"default"}' \
  http://localhost:8080/api/sessions
```

### Get current session
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/sessions/current
```

### Stop session
```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/sessions/current
```

### Take screenshot
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"step1"}' \
  http://localhost:8080/api/sessions/current/screenshot
```

## Deployment (Cloud Run)

```bash
docker compose build
docker tag o-browser-browser:latest europe-west1-docker.pkg.dev/PROJECT/docker/o-browser
docker push europe-west1-docker.pkg.dev/PROJECT/docker/o-browser

gcloud run deploy o-browser \
  --image=europe-west1-docker.pkg.dev/PROJECT/docker/o-browser:latest \
  --region=europe-west1 \
  --execution-environment=gen2 \
  --memory=4Gi --cpu=2 \
  --no-cpu-throttling \
  --min-instances=1 --max-instances=1 \
  --timeout=3600 \
  --session-affinity \
  --allow-unauthenticated \
  --port=8080 \
  --set-env-vars=AUTH_TOKEN=xxx
```

Key flags:
- `gen2`: full Linux kernel (needed for Chrome)
- `no-cpu-throttling`: Chrome needs CPU even idle
- `min-instances=1`: no cold start
- `session-affinity`: sticky VNC/CDP connections
