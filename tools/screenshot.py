"""Render Wing Lab headlessly and save a screenshot, printing any page or WebGPU errors.

Optional helper for automated checks after a change.

  pip install playwright && python3 -m playwright install chromium
  python3 -m http.server 8000                                   # in the project folder, in another terminal
  python3 tools/screenshot.py "http://localhost:8000/#place=canyon&time=golden" canyon.png [wait_seconds]

`readback` is added to the link so the WebGPU frame is copied into a normal canvas that screenshots can see.
"""
import asyncio, sys
from playwright.async_api import async_playwright


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/'
    out = sys.argv[2] if len(sys.argv) > 2 else 'shot.png'
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 20
    if '#' not in url:
        url += '#'
    url += ('' if url.endswith('#') else '&') + 'readback'
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        msgs = []
        page.on('pageerror', lambda e: msgs.append(f'PAGE ERROR: {e}'))
        page.on('console', lambda m: msgs.append(f'{m.type}: {m.text[:400]}') if m.type in ('error', 'warning') else None)
        await page.goto(url)
        await page.wait_for_timeout(wait * 1000)
        gpu_errors = await page.evaluate('window.WL_SNAP ? window.WL_SNAP() : ["WebGPU renderer not running"]')
        await page.screenshot(path=out)
        print('saved', out)
        for m in list(gpu_errors) + msgs:
            print(m)
        await browser.close()

asyncio.run(main())
