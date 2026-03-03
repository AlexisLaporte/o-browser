"""
RemoteBrowser — Connect to a running browser service via CDP.

Usage:
    async with RemoteBrowser("http://host:8080") as browser:
        await browser.goto("https://example.com")
        text = await browser.get_text()
"""

import re
from typing import Optional

from ._mixin import PageMixin


class RemoteBrowser(PageMixin):
    """
    Connects to a remote Chrome instance via CDP WebSocket.

    Does NOT launch or kill the browser — only connects/disconnects.
    """

    def __init__(self, endpoint: str):
        """
        Args:
            endpoint: HTTP base URL (http://host:8080) or direct WS URL (ws://host:9222/devtools/...)
        """
        self.endpoint = endpoint
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def _discover_ws_url(self) -> str:
        """Auto-discover WebSocket URL from HTTP endpoint."""
        import urllib.request
        import json

        # Strip trailing slash
        base = self.endpoint.rstrip("/")

        # Try /api/sessions/current first (o-browser service)
        try:
            with urllib.request.urlopen(f"{base}/api/sessions/current", timeout=5) as resp:
                session = json.loads(resp.read())
                ws_url = session.get("cdp", {}).get("ws_url")
                if ws_url:
                    return ws_url
        except Exception:
            pass

        # Fallback: direct CDP /json/version
        cdp_base = re.sub(r":\d+", ":9222", base)
        with urllib.request.urlopen(f"{cdp_base}/json/version", timeout=5) as resp:
            data = json.loads(resp.read())
            return data["webSocketDebuggerUrl"]

    async def start(self) -> "RemoteBrowser":
        """Connect to remote browser."""
        from patchright.async_api import async_playwright

        self._playwright = await async_playwright().start()

        if self.endpoint.startswith("ws://") or self.endpoint.startswith("wss://"):
            ws_url = self.endpoint
        else:
            ws_url = await self._discover_ws_url()

        self._browser = await self._playwright.chromium.connect_over_cdp(ws_url)
        contexts = self._browser.contexts
        self._context = contexts[0] if contexts else await self._browser.new_context()
        self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()

        return self

    async def close(self):
        """Disconnect (does NOT kill the remote browser)."""
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
