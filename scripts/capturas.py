#!/usr/bin/env python3
"""Genera las capturas del README (docs/screenshots/) y la imagen para compartir
(docs/logo/uptime-social.png) a partir de la web con los datos que haya en data/.

No forma parte de la Action: se ejecuta a mano cuando cambia el aspecto de la web.
Necesita Playwright con Chromium y Pillow:

    pip install playwright pillow
    playwright install chromium

Antes, trae los datos publicados para que las capturas enseñen algo real:

    git fetch origin datos
    for f in estado historial incidencias; do git show origin/datos:data/$f.json > data/$f.json; done
    python3 scripts/capturas.py
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

RAIZ = Path(__file__).resolve().parent.parent
CAPTURAS = RAIZ / "docs" / "screenshots"
LOGO = RAIZ / "docs" / "logo"
PUERTO = 8766
WEB = f"http://localhost:{PUERTO}/"
CALIDAD = 82


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def servir():
    manejador = functools.partial(Silencioso, directory=str(RAIZ))
    servidor = http.server.ThreadingHTTPServer(("localhost", PUERTO), manejador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor


def a_webp(png, nombre, recorte=None):
    im = Image.open(png).convert("RGB")
    if recorte:
        im = im.crop(recorte)
    im.save(CAPTURAS / f"{nombre}.webp", "WEBP", quality=CALIDAD, method=6)
    print(f"docs/screenshots/{nombre}.webp", im.size)


async def escribir(pagina, *ordenes):
    await pagina.click("#orden")
    for o in ordenes:
        await pagina.keyboard.type(o)
        await pagina.keyboard.press("Enter")
        await pagina.wait_for_timeout(250)
    await pagina.evaluate("document.querySelector('#sesion').scrollTop = 0")


async def capturas(navegador, tmp):
    pg = await navegador.new_page(viewport={"width": 1280, "height": 1060}, reduced_motion="reduce")
    await pg.goto(WEB + "?lang=en")
    await pg.wait_for_timeout(2000)

    await pg.screenshot(path=tmp / "hero.png")
    a_webp(tmp / "hero.png", "hero")

    await escribir(pg, "status cloudflare", "geoiplookup singapore")
    await (await pg.query_selector(".consola")).screenshot(path=tmp / "terminal.png")
    a_webp(tmp / "terminal.png", "terminal")
    await (await pg.query_selector("#bloque-mapa")).screenshot(path=tmp / "map.png")
    a_webp(tmp / "map.png", "map")

    await escribir(pg, "clear", "services")
    await (await pg.query_selector(".consola")).screenshot(path=tmp / "services.png")
    a_webp(tmp / "services.png", "services")

    await pg.click("#activas details summary")
    await (await pg.query_selector("#bloque-activas")).screenshot(path=tmp / "incidents.png")
    a_webp(tmp / "incidents.png", "incidents")

    # Los racks con el primer servidor con fallos abierto
    await pg.click("#racks .servidor .abrir")
    await pg.wait_for_timeout(200)
    caja = await pg.evaluate("(() => { const r = document.querySelector('#racks').getBoundingClientRect();"
                             " return {x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height}; })()")
    await pg.screenshot(path=tmp / "racks.png", full_page=True,
                        clip={"x": caja["x"] - 4, "y": caja["y"] - 70, "width": caja["w"] + 8, "height": min(caja["h"] + 74, 1500)})
    a_webp(tmp / "racks.png", "racks")
    a_webp(tmp / "racks.png", "racks-card", recorte=(0, 60, 1200, 780))

    await (await pg.query_selector(".pareja")).screenshot(path=tmp / "history.png")
    a_webp(tmp / "history.png", "history")
    await (await pg.query_selector(".psu-interruptor")).hover()
    await pg.wait_for_timeout(200)
    await (await pg.query_selector(".psu")).screenshot(path=tmp / "psu.png")
    a_webp(tmp / "psu.png", "psu")

    es = await navegador.new_page(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    await es.goto(WEB + "?lang=es")
    await es.wait_for_timeout(1800)
    await es.screenshot(path=tmp / "spanish.png", clip={"x": 0, "y": 0, "width": 1280, "height": 560})
    a_webp(tmp / "spanish.png", "spanish")

    movil = await navegador.new_page(viewport={"width": 390, "height": 844}, reduced_motion="reduce", device_scale_factor=2)
    await movil.goto(WEB + "?lang=en")
    await movil.wait_for_timeout(1800)
    await movil.screenshot(path=tmp / "mobile.png")
    a_webp(tmp / "mobile.png", "mobile")


def html_social():
    """El mapa de LED con los fallos de data/estado.json, el logo y el lema."""
    mapa = json.loads((RAIZ / "data" / "mapa.json").read_text("utf-8"))
    d = ""
    for y, fila in enumerate(mapa["filas"]):
        desplazamiento = 0.5 if y % 2 else 0
        for i, ch in enumerate(fila):
            n = int(ch, 16)
            for b in range(4):
                if n & (8 >> b):
                    d += f"M{i*4+b+desplazamiento} {y}h0"
    color = {"mantenimiento": "#5AA9FF", "degradado": "#F2C230", "parcial": "#FF8A2A", "grave": "#FF4D4D"}
    rango = {"mantenimiento": 1, "degradado": 2, "parcial": 3, "grave": 4}
    puntos = {}
    try:
        estado = json.loads((RAIZ / "data" / "estado.json").read_text("utf-8"))
    except (OSError, ValueError):
        estado = {"proveedores": []}
    for p in estado["proveedores"]:
        for lu in p.get("lugares", []):
            g = puntos.setdefault(lu["id"], [lu["lat"], lu["lon"], lu["nivel"]])
            if rango.get(lu["nivel"], 0) > rango.get(g[2], 0):
                g[2] = lu["nivel"]
    leds = "".join(
        f'<circle cx="{(lon+180)/1.5:.2f}" cy="{(82-lat)/1.5:.2f}" r="2.4" fill="{color.get(n, "#43D17F")}" opacity=".18"/>'
        f'<circle cx="{(lon+180)/1.5:.2f}" cy="{(82-lat)/1.5:.2f}" r="0.95" fill="{color.get(n, "#43D17F")}"/>'
        for lat, lon, n in sorted(puntos.values(), key=lambda v: rango.get(v[2], 0)))
    total = len(estado["proveedores"]) or 27
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:640px;background:#0F151B;overflow:hidden;font-family:"DejaVu Sans Mono",monospace;position:relative}}
.mapa{{position:absolute;left:40px;top:150px;width:1200px;opacity:.95}}
.velo{{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,21,27,.96) 0%,rgba(15,21,27,.55) 38%,rgba(15,21,27,.25) 70%,rgba(15,21,27,.9) 100%)}}
.logo{{position:absolute;left:72px;top:58px;height:118px}}
.lema{{position:absolute;left:78px;top:196px;color:#DCE6EE;font-family:"DejaVu Sans",sans-serif;font-size:40px;font-weight:700;letter-spacing:-.5px}}
.sub{{position:absolute;left:80px;top:254px;color:#8494A3;font-size:21px}}
.pie{{position:absolute;left:80px;bottom:46px;color:#6FB7FF;font-size:22px}}
.pie span{{color:#4C5A67}}
</style></head><body>
<svg class="mapa" viewBox="-1 -1 242 95"><path d="{d}" fill="none" stroke="#34475A" stroke-width=".62" stroke-linecap="round"/>{leds}</svg>
<div class="velo"></div>
<img class="logo" src="{WEB}docs/logo/uptime-oscuro.svg">
<div class="lema">Is it down, or is it just me?</div>
<div class="sub">GitHub, Azure, AWS, Google Cloud, Red Hat, Cloudflare and {total - 6} more</div>
<div class="pie">bendi@noc:~$ <span>uptime.bendi.dev</span></div>
</body></html>'''


async def social(navegador, tmp):
    (RAIZ / ".social.html").write_text(html_social(), "utf-8")
    try:
        pg = await navegador.new_page(viewport={"width": 1280, "height": 640})
        await pg.goto(WEB + ".social.html")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=tmp / "social.png")
    finally:
        (RAIZ / ".social.html").unlink(missing_ok=True)
    Image.open(tmp / "social.png").save(LOGO / "uptime-social.png", optimize=True)
    print("docs/logo/uptime-social.png")


async def main():
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    servidor = servir()
    try:
        with tempfile.TemporaryDirectory() as t:
            async with async_playwright() as p:
                navegador = await p.chromium.launch()
                await capturas(navegador, Path(t))
                await social(navegador, Path(t))
                await navegador.close()
    finally:
        servidor.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
