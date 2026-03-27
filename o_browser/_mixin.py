"""
PageMixin — Shared browser page interactions.

All methods depend only on self._page / self._context.
Inherited by BrowserClient (direct) and RemoteBrowser (CDP).
"""

import asyncio
import os
from typing import Any


class PageMixin:
    """Mixin providing navigation, interactions, scrolling, waiting, selectors, and GIF recording."""

    _page: Any
    _context: Any

    @property
    def page(self):
        if not self._page:
            raise RuntimeError("Browser not started. Use 'async with' or call start() first.")
        return self._page

    @property
    def context(self):
        if not self._context:
            raise RuntimeError("Browser not started. Use 'async with' or call start() first.")
        return self._context

    # === Navigation ===

    async def goto(self, url: str, wait_until: str = "domcontentloaded", timeout: int = 30000) -> bool:
        """Navigate to URL. Returns True if status 200."""
        try:
            response = await self.page.goto(url, wait_until=wait_until, timeout=timeout)
            return response and response.status == 200
        except Exception:
            return False

    async def wait(self, seconds: float):
        """Wait for specified seconds."""
        await asyncio.sleep(seconds)

    async def get_text(self) -> str:
        """Get page text content."""
        return await self.page.evaluate("() => document.body.innerText")

    async def get_html(self) -> str:
        """Get page HTML."""
        return await self.page.content()

    async def screenshot(self, path: str, full_page: bool = True) -> str:
        """Take screenshot and return path."""
        await self.page.screenshot(path=path, full_page=full_page)
        return path

    # === Scrolling ===

    async def scroll_to_bottom(self, times: int = 3, delay: float = 2.0) -> None:
        """Scroll to bottom multiple times to load dynamic content."""
        for _ in range(times):
            await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(delay)

    async def scroll_element(self, selector: str, times: int = 3, delay: float = 2.0) -> None:
        """Scroll inside a specific element (infinite scroll containers)."""
        for _ in range(times):
            await self.page.evaluate(f"""
                const el = document.querySelector('{selector}');
                if (el) el.scrollTop = el.scrollHeight;
            """)
            await asyncio.sleep(delay)

    async def scroll_by(self, y: int):
        """Scroll page by Y pixels."""
        await self.page.evaluate(f"window.scrollBy(0, {y})")

    # === Waiting ===

    async def wait_for_content(self, min_length: int = 500, max_attempts: int = 10, delay: float = 2.0) -> bool:
        """Wait for page content to load (not showing 'Loading...')."""
        for _ in range(max_attempts):
            text = await self.get_text()
            if "Loading" not in text and len(text) > min_length:
                return True
            await asyncio.sleep(delay)
        return False

    async def wait_for_selector(self, selector: str, timeout: int = 30000):
        """Wait for element to appear."""
        return await self.page.wait_for_selector(selector, timeout=timeout)

    # === Interactions ===

    async def click(self, selector: str) -> None:
        """Click element by selector."""
        await self.page.click(selector)

    async def fill(self, selector: str, value: str) -> None:
        """Fill input field."""
        await self.page.fill(selector, value)

    async def type(self, selector: str, text: str, delay: int = 50) -> None:
        """Type text with realistic delay between keystrokes."""
        await self.page.type(selector, text, delay=delay)

    async def press(self, key: str) -> None:
        """Press a key (e.g., 'Enter', 'Tab')."""
        await self.page.keyboard.press(key)

    # === Selectors ===

    async def query_selector(self, selector: str):
        """Query single element."""
        return await self.page.query_selector(selector)

    async def query_selector_all(self, selector: str):
        """Query all elements matching selector."""
        return await self.page.query_selector_all(selector)

    async def evaluate(self, expression: str) -> Any:
        """Evaluate JavaScript expression."""
        return await self.page.evaluate(expression)

    # === GIF Recording ===

    def _init_recording(self):
        """Initialize recording state if needed."""
        if not hasattr(self, '_frames'):
            self._frames = []
            self._rec_dir = None

    async def capture_frame(self, duration: float = 0.5, full_page: bool = False):
        """Capture a screenshot frame for GIF recording."""
        self._init_recording()
        if not self._rec_dir:
            import tempfile
            self._rec_dir = tempfile.mkdtemp(prefix="browser_gif_")

        frame_path = os.path.join(self._rec_dir, f"frame_{len(self._frames):03d}.png")
        await self.page.screenshot(path=frame_path, full_page=full_page)
        self._frames.append((frame_path, int(duration * 100)))

    async def type_animated(self, selector: str, text: str, frame_every: int = 5,
                            frame_duration: float = 0.15, type_delay: int = 40):
        """Type text capturing frames periodically for GIF."""
        await self.page.click(selector)
        for i, char in enumerate(text):
            await self.page.keyboard.type(char, delay=type_delay)
            if (i + 1) % frame_every == 0 or i == len(text) - 1:
                await self.capture_frame(duration=frame_duration)

    def save_gif(self, output_path: str, resize: str = None, optimize: bool = True) -> str:
        """Assemble captured frames into an animated GIF using ImageMagick."""
        import subprocess
        import shutil

        self._init_recording()
        if not self._frames:
            raise RuntimeError("No frames captured. Use capture_frame() first.")

        if not shutil.which("convert"):
            raise RuntimeError("ImageMagick 'convert' not found. Install with: apt install imagemagick")

        cmd = ["convert"]
        for path, delay_cs in self._frames:
            cmd.extend(["-delay", str(delay_cs), path])
        cmd.extend(["-loop", "0"])
        if resize:
            cmd.extend(["-resize", resize])
        if optimize:
            cmd.extend(["-layers", "Optimize"])
        cmd.append(output_path)

        subprocess.run(cmd, check=True)

        if self._rec_dir:
            shutil.rmtree(self._rec_dir, ignore_errors=True)
        self._frames = []
        self._rec_dir = None

        return output_path
