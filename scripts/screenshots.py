#!/usr/bin/env python3
"""Takes the README screenshots (docs/screenshots/) and the social preview image
(docs/logo/social.png) from the site, using whatever data is in data/.

Not part of the Action: run it by hand whenever the site's look changes.
Needs Playwright with Chromium, and Pillow:

    pip install playwright pillow
    playwright install chromium

First fetch the published data so the screenshots show something real:

    git fetch origin data
    for f in status history incidents; do git show origin/data:data/$f.json > data/$f.json; done
    python3 scripts/screenshots.py
"""

import asyncio
import functools
import http.server
import json
import tempfile
import threading
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
LOGO = ROOT / "docs" / "logo"
PORT = 8766
SITE = f"http://localhost:{PORT}/"
QUALITY = 82


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("localhost", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def to_webp(png, name, crop=None):
    im = Image.open(png).convert("RGB")
    if crop:
        im = im.crop(crop)
    im.save(SHOTS / f"{name}.webp", "WEBP", quality=QUALITY, method=6)
    print(f"docs/screenshots/{name}.webp", im.size)


async def type_commands(page, *commands):
    await page.click("#command")
    for c in commands:
        await page.keyboard.type(c)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(250)
    await page.evaluate("document.querySelector('#session').scrollTop = 0")


async def screenshots(browser, tmp):
    pg = await browser.new_page(viewport={"width": 1280, "height": 1060}, reduced_motion="reduce")
    await pg.goto(SITE + "?lang=en")
    await pg.wait_for_timeout(2000)

    await pg.screenshot(path=tmp / "hero.png")
    to_webp(tmp / "hero.png", "hero")

    await type_commands(pg, "status cloudflare", "geoiplookup singapore")
    await (await pg.query_selector(".console")).screenshot(path=tmp / "terminal.png")
    to_webp(tmp / "terminal.png", "terminal")
    await (await pg.query_selector("#map-block")).screenshot(path=tmp / "map.png")
    to_webp(tmp / "map.png", "map")

    await type_commands(pg, "clear", "services")
    await (await pg.query_selector(".console")).screenshot(path=tmp / "services.png")
    to_webp(tmp / "services.png", "services")

    await pg.click("#incidents details summary")
    await (await pg.query_selector("#incidents-block")).screenshot(path=tmp / "incidents.png")
    to_webp(tmp / "incidents.png", "incidents")

    # The racks, with the first (worst) server's drawer open
    await pg.click("#racks .server .open")
    await pg.wait_for_timeout(200)
    box = await pg.evaluate("(() => { const r = document.querySelector('#racks').getBoundingClientRect();"
                            " return {x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height}; })()")
    await pg.screenshot(path=tmp / "racks.png", full_page=True,
                        clip={"x": box["x"] - 4, "y": box["y"] - 70, "width": box["w"] + 8, "height": min(box["h"] + 74, 1500)})
    to_webp(tmp / "racks.png", "racks")
    to_webp(tmp / "racks.png", "racks-card", crop=(0, 60, 1200, 780))

    await (await pg.query_selector(".pair")).screenshot(path=tmp / "history.png")
    to_webp(tmp / "history.png", "history")
    await (await pg.query_selector(".psu-switch")).hover()
    await pg.wait_for_timeout(200)
    await (await pg.query_selector(".psu")).screenshot(path=tmp / "psu.png")
    to_webp(tmp / "psu.png", "psu")

    es = await browser.new_page(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    await es.goto(SITE + "?lang=es")
    await es.wait_for_timeout(1800)
    await es.screenshot(path=tmp / "spanish.png", clip={"x": 0, "y": 0, "width": 1280, "height": 560})
    to_webp(tmp / "spanish.png", "spanish")

    mobile = await browser.new_page(viewport={"width": 390, "height": 844}, reduced_motion="reduce", device_scale_factor=2)
    await mobile.goto(SITE + "?lang=en")
    await mobile.wait_for_timeout(1800)
    await mobile.screenshot(path=tmp / "mobile.png")
    to_webp(tmp / "mobile.png", "mobile")


def social_html():
    """The LED map with the failures in data/status.json, the logo and the tagline."""
    world = json.loads((ROOT / "data" / "map.json").read_text("utf-8"))
    d = ""
    for y, row in enumerate(world["rows"]):
        offset = 0.5 if y % 2 else 0
        for i, ch in enumerate(row):
            n = int(ch, 16)
            for b in range(4):
                if n & (8 >> b):
                    d += f"M{i*4+b+offset} {y}h0"
    color = {"maintenance": "#5AA9FF", "degraded": "#F2C230", "partial": "#FF8A2A", "major": "#FF4D4D"}
    rank = {"maintenance": 1, "degraded": 2, "partial": 3, "major": 4}
    dots = {}
    try:
        status = json.loads((ROOT / "data" / "status.json").read_text("utf-8"))
    except (OSError, ValueError):
        status = {"providers": []}
    for p in status["providers"]:
        for pl in p.get("places", []):
            g = dots.setdefault(pl["id"], [pl["lat"], pl["lon"], pl["level"]])
            if rank.get(pl["level"], 0) > rank.get(g[2], 0):
                g[2] = pl["level"]
    leds = "".join(
        f'<circle cx="{(lon+180)/1.5:.2f}" cy="{(82-lat)/1.5:.2f}" r="2.4" fill="{color.get(n, "#43D17F")}" opacity=".18"/>'
        f'<circle cx="{(lon+180)/1.5:.2f}" cy="{(82-lat)/1.5:.2f}" r="0.95" fill="{color.get(n, "#43D17F")}"/>'
        for lat, lon, n in sorted(dots.values(), key=lambda v: rank.get(v[2], 0)))
    total = len(status["providers"]) or 27
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:640px;background:#0F151B;overflow:hidden;font-family:"DejaVu Sans Mono",monospace;position:relative}}
.map{{position:absolute;left:40px;top:150px;width:1200px;opacity:.95}}
.veil{{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,21,27,.96) 0%,rgba(15,21,27,.55) 38%,rgba(15,21,27,.25) 70%,rgba(15,21,27,.9) 100%)}}
.logo{{position:absolute;left:72px;top:58px;height:118px}}
.tagline{{position:absolute;left:78px;top:196px;color:#DCE6EE;font-family:"DejaVu Sans",sans-serif;font-size:40px;font-weight:700;letter-spacing:-.5px}}
.sub{{position:absolute;left:80px;top:254px;color:#8494A3;font-size:21px}}
.footer{{position:absolute;left:80px;bottom:46px;color:#6FB7FF;font-size:22px}}
.footer span{{color:#4C5A67}}
</style></head><body>
<svg class="map" viewBox="-1 -1 242 95"><path d="{d}" fill="none" stroke="#34475A" stroke-width=".62" stroke-linecap="round"/>{leds}</svg>
<div class="veil"></div>
<img class="logo" src="{SITE}docs/logo/logo-dark.svg">
<div class="tagline">Is it down, or is it just me?</div>
<div class="sub">GitHub, Azure, AWS, Google Cloud, Red Hat, Cloudflare and {total - 6} more</div>
<div class="footer">bendi@noc:~$ <span>uptime.bendi.dev</span></div>
</body></html>'''


async def social(browser, tmp):
    (ROOT / ".social.html").write_text(social_html(), "utf-8")
    try:
        pg = await browser.new_page(viewport={"width": 1280, "height": 640})
        await pg.goto(SITE + ".social.html")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=tmp / "social.png")
    finally:
        (ROOT / ".social.html").unlink(missing_ok=True)
    Image.open(tmp / "social.png").save(LOGO / "social.png", optimize=True)
    print("docs/logo/social.png")


async def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    server = serve()
    try:
        with tempfile.TemporaryDirectory() as t:
            async with async_playwright() as p:
                browser = await p.chromium.launch()
                await screenshots(browser, Path(t))
                await social(browser, Path(t))
                await browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
