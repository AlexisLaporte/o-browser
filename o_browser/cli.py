"""
CLI subapp for o-browser, mountable by otomata CLI.

Commands:
    otomata browser fetch URL [--html] [--screenshot FILE] [--record] [--proxy SERVER]
    otomata browser screenshot URL [-o FILE] [--record] [--proxy SERVER]
    otomata browser run SCRIPT [--profile PATH] [--record] [--proxy SERVER]
    otomata browser open [--profile PATH] [--record] [--proxy SERVER]
"""

import asyncio
from typing import Optional

import typer

app = typer.Typer(help="Browser automation (direct mode)")


def _parse_proxy(proxy: Optional[str]) -> Optional[dict]:
    """Parse proxy string into dict. Format: http://user:pass@host:port or http://host:port"""
    if not proxy:
        return None
    result = {"server": proxy}
    if "@" in proxy:
        from urllib.parse import urlparse
        parsed = urlparse(proxy)
        result["server"] = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
        if parsed.username:
            result["username"] = parsed.username
        if parsed.password:
            result["password"] = parsed.password
    return result


@app.command("fetch")
def fetch(
    url: str = typer.Argument(..., help="URL to fetch"),
    html: bool = typer.Option(False, "--html", help="Output HTML instead of text"),
    screenshot: Optional[str] = typer.Option(None, "--screenshot", "-s", help="Save screenshot to file"),
    profile: Optional[str] = typer.Option(None, "--profile", "-p", help="Chrome profile path"),
    headless: bool = typer.Option(True, help="Run headless"),
    record: bool = typer.Option(False, "--record", "-r", help="Record session (HAR + video + state)"),
    record_dir: Optional[str] = typer.Option(None, "--record-dir", help="Recording output directory"),
    proxy: Optional[str] = typer.Option(None, "--proxy", help="Proxy server (http://user:pass@host:port)"),
):
    """Open URL, extract text (or HTML), optionally screenshot, then close."""
    from .client import BrowserClient

    async def run():
        async with BrowserClient(
            profile_path=profile, headless=headless,
            record=record, record_dir=record_dir,
            proxy=_parse_proxy(proxy),
        ) as browser:
            await browser.goto(url)
            if screenshot:
                await browser.screenshot(screenshot)
                typer.echo(f"Screenshot saved: {screenshot}", err=True)
            if html:
                return await browser.get_html()
            return await browser.get_text()

    result = asyncio.run(run())
    typer.echo(result)


@app.command("screenshot")
def screenshot_cmd(
    url: str = typer.Argument(..., help="URL to screenshot"),
    output: str = typer.Option("screenshot.png", "--output", "-o", help="Output file path"),
    full_page: bool = typer.Option(True, "--full-page/--viewport", help="Full page or viewport only"),
    profile: Optional[str] = typer.Option(None, "--profile", "-p", help="Chrome profile path"),
    headless: bool = typer.Option(True, help="Run headless"),
    record: bool = typer.Option(False, "--record", "-r", help="Record session"),
    proxy: Optional[str] = typer.Option(None, "--proxy", help="Proxy server"),
):
    """Take a screenshot of a URL."""
    from .client import BrowserClient

    async def run():
        async with BrowserClient(
            profile_path=profile, headless=headless,
            record=record, proxy=_parse_proxy(proxy),
        ) as browser:
            await browser.goto(url)
            await browser.screenshot(output, full_page=full_page)

    asyncio.run(run())
    typer.echo(f"Screenshot saved: {output}")


@app.command("run")
def run_script(
    script: str = typer.Argument(..., help="Python script path to execute"),
    profile: Optional[str] = typer.Option(None, "--profile", "-p", help="Chrome profile path"),
    headless: bool = typer.Option(True, help="Run headless"),
    record: bool = typer.Option(False, "--record", "-r", help="Record session"),
    proxy: Optional[str] = typer.Option(None, "--proxy", help="Proxy server"),
):
    """Run a Python script with a browser instance injected as 'browser'."""
    from pathlib import Path
    from .client import BrowserClient

    script_path = Path(script)
    if not script_path.exists():
        typer.echo(f"Script not found: {script}", err=True)
        raise typer.Exit(1)

    code = script_path.read_text()

    async def run():
        async with BrowserClient(
            profile_path=profile, headless=headless,
            record=record, proxy=_parse_proxy(proxy),
        ) as browser:
            exec(code, {"browser": browser, "asyncio": asyncio, "__name__": "__main__"})

    asyncio.run(run())


@app.command("open")
def open_browser(
    profile: Optional[str] = typer.Option(None, "--profile", "-p", help="Chrome profile path"),
    record: bool = typer.Option(False, "--record", "-r", help="Record session (HAR + video + state)"),
    record_dir: Optional[str] = typer.Option(None, "--record-dir", help="Recording output directory"),
    proxy: Optional[str] = typer.Option(None, "--proxy", help="Proxy server (http://user:pass@host:port)"),
    url: Optional[str] = typer.Argument(None, help="URL to open initially"),
):
    """Open Chrome for manual browsing. Optionally record the session."""
    from .client import BrowserClient

    async def run():
        async with BrowserClient(
            profile_path=profile, interactive=True,
            record=record, record_dir=record_dir,
            proxy=_parse_proxy(proxy),
        ) as browser:
            if url:
                await browser.goto(url)
            typer.echo("Chrome opened. Close the browser to end the session.", err=True)
            await browser.wait_closed()

    asyncio.run(run())
