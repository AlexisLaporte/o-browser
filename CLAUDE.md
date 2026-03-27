# o-browser — Python Browser Automation Client

Async browser automation via Patchright (patched Playwright).

## Install

```bash
pip install o-browser        # from PyPI
pip install -e .             # editable local
```

## Usage

```python
# Headless
async with BrowserClient() as browser:
    await browser.goto("https://example.com")
    text = await browser.get_text()

# Persistent profile (cookies survive between runs)
async with BrowserClient(profile_path="~/.config/browser/linkedin") as browser:
    await browser.goto("https://linkedin.com")

# Connect to remote Chrome (e.g. o-browser-server)
async with RemoteBrowser("http://host:8080") as browser:
    await browser.goto("https://example.com")
```

## Structure

```
o_browser/
├── __init__.py    # exports BrowserClient, RemoteBrowser
├── _mixin.py      # PageMixin — shared methods (goto, click, get_text, scroll, screenshot)
├── client.py      # BrowserClient — launches Chrome locally via Patchright
└── remote.py      # RemoteBrowser — connects to remote Chrome via CDP WebSocket
```

## Dependencies

- `patchright` (Playwright fork with anti-detection patches)

## Related

- [o-browser-server](https://github.com/AlexisLaporte/o-browser-server) — Docker service (VNC + CDP + recording)
