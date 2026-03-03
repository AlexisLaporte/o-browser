# o-browser — Browser Automation (Direct + Service)

Two modes:
1. **Direct** (Python) — `BrowserClient` launches Chrome, does the job, closes. `RemoteBrowser` connects via CDP.
2. **Service** (Node.js) — API + VNC + recording + dashboard in Docker.

## Stack

- **Python**: Patchright (anti-detection Playwright fork)
- **Node.js**: ws, @rrweb/record (service only)
- **Browser**: Chrome/Chromium via Patchright
- **CLI**: Typer (optional dep)

## Structure

```
o-browser/
├── o_browser/                  # Python package
│   ├── __init__.py             # Exports: BrowserClient, RemoteBrowser
│   ├── _mixin.py               # PageMixin (nav, interactions, scroll, GIF)
│   ├── client.py               # BrowserClient (direct mode)
│   ├── remote.py               # RemoteBrowser (CDP connect)
│   └── cli.py                  # CLI Typer subapp (fetch, screenshot, open, run)
├── pyproject.toml              # Package config — deps: patchright, optional: typer
│
├── service/                    # Node.js service (Docker only)
│   ├── api-server.js           # HTTP API (sessions, recordings, screenshots)
│   ├── session-recorder.js     # rrweb DOM + HAR + browser state recorder
│   ├── start-session.sh        # Launches Chrome + Xvfb + VNC + ffmpeg
│   ├── end-session.sh          # Stops session, saves recordings
│   └── ui/                     # Status page
│
├── Dockerfile                  # node:20-slim + Patchright Chrome + VNC + ffmpeg
├── docker-compose.yml
├── docker-entrypoint.sh
├── nginx.conf                  # Reverse proxy: /api, /vnc, /cdp on port 8080
└── package.json
```

## Python Package

```bash
pip install -e /path/to/o-browser        # Direct mode
pip install -e "/path/to/o-browser[cli]"  # + CLI (typer)
```

### BrowserClient — all modes

```python
from o_browser import BrowserClient

# Headless automation
async with BrowserClient() as browser:
    await browser.goto("https://example.com")
    text = await browser.get_text()

# With profile + proxy + recording
async with BrowserClient(
    profile_path="~/.browser/profiles/myprofile",
    proxy={"server": "http://host:port", "username": "u", "password": "p"},
    record=True, record_dir="./recordings",
) as browser:
    await browser.goto("https://example.com")
# → recordings/{network.har, *.webm, state.json}

# Interactive — Chrome visible, human navigates, recordings saved on close
async with BrowserClient(interactive=True, record=True) as browser:
    await browser.wait_closed()
```

### RemoteBrowser — connect to running service

```python
from o_browser import RemoteBrowser
async with RemoteBrowser("http://host:8080") as browser:
    await browser.goto("https://example.com")
```

### Key parameters (BrowserClient)

| Param | Default | Description |
|-------|---------|-------------|
| `profile_path` | None | Chrome profile dir (persistent session) |
| `headless` | True | Headless mode (forced False if interactive) |
| `proxy` | None | `{server, username, password}` — Patchright handles auth |
| `record` | False | Enable HAR + video + state recording |
| `record_dir` | auto | Recording output dir |
| `interactive` | False | Human mode: visible Chrome, wait_closed() |
| `cookies` | [] | Cookies to inject at start |
| `channel` | auto-detect | chrome, chrome-beta, chromium |

## CLI

```bash
otomata browser fetch URL [--html] [--record] [--proxy SERVER]
otomata browser screenshot URL [-o FILE] [--record]
otomata browser open [URL] [--profile PATH] [--record] [--proxy SERVER]
otomata browser run SCRIPT [--profile PATH] [--record]
```

Proxy format: `http://user:pass@host:port`

## Service (Docker)

For remote/headless server deployments. Not needed for local use.

| Nginx path | Upstream | Notes |
|------------|----------|-------|
| `/api/` | `:3080` | API server |
| `/vnc/` | `:6080` | noVNC |
| `/cdp/` | `:9222` | Chrome DevTools Protocol |

Recording output (service): `rrweb-events.json`, `network.har`, `browser-state.jsonl`, `screencast.mp4`

## Gotchas

- **Profile incompatibility**: Profiles from different Chromium builds may crash. Reset if "Trace/breakpoint trap"
- **Cookie encryption**: Chrome encrypts cookies per-build — cookies from a different build are unreadable
- **SingletonLock**: `start-session.sh` cleans stale locks before launch
- **ffmpeg for video**: Patchright needs `patchright install ffmpeg` for `record=True` video capture

## Downstream

- `otomata-tools/browser` — domain clients (LinkedIn, Crunchbase, Pappers, G2, Indeed) import `from o_browser import BrowserClient`
- `roundtable/browser-service` — adds profile seeds and Roundtable-specific config
