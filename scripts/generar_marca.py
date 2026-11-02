#!/usr/bin/env python3
"""Genera los ficheros de la marca en docs/logo/. Se ejecuta a mano cuando cambia el diseño.

  uptime-oscuro.svg   logo para fondo oscuro (marca + palabra)
  uptime-claro.svg    logo para fondo claro
  uptime-marca.svg    marca cuadrada, para avatares
  uptime-favicon.svg  marca simplificada para 16-32 px
  terminal.svg        la terminal animada de la cabecera del README

La palabra "uptime" se dibuja con trazos (sin fuentes), así que se ve igual en todas partes.
El punto de la i es el LED de estado. Solo usa la biblioteca estándar.

La imagen para compartir (uptime-social.png) y las capturas del README necesitan un
navegador: las genera scripts/capturas.py.
"""

from html import escape
from pathlib import Path

LOGO = Path(__file__).resolve().parent.parent / "docs" / "logo"

VERDE, AZUL, AMBAR, NARANJA, ROJO = "#43D17F", "#6FB7FF", "#F2C230", "#FF8A2A", "#FF4D4D"
TINTA, TENUE, APAGADO, SALA = "#DCE6EE", "#8494A3", "#4C5A67", "#0F151B"


# ---------------------------------------------------------------- la palabra

def palabra():
    """Trazos de "uptime": x-height de 20 a 60, ascendente en 6, descendente en 78."""
    x, trazos = 0, []
    trazos.append(f"M{x} 20V44a16 16 0 0 0 32 0V20M{x+32} 20V60"); x += 46                        # u
    trazos.append(f"M{x} 20V78M{x} 40a16 20 0 0 1 32 0a16 20 0 0 1-32 0"); x += 46                # p
    trazos.append(f"M{x+8} 6V46a14 14 0 0 0 14 14h4M{x-2} 22H{x+24}"); x += 38                   # t
    i_x = x
    trazos.append(f"M{x} 22V60"); x += 14                                                         # i (sin punto)
    trazos.append(f"M{x} 60V20M{x} 34a11 12 0 0 1 22 0V60M{x+22} 34a11 12 0 0 1 22 0V60"); x += 58  # m
    trazos.append(f"M{x+1} 40H{x+32}A16 20 0 1 0 {x+27.5} 54"); x += 32                           # e
    return " ".join(trazos), i_x, x


# ---------------------------------------------------------------- la marca

BARRAS = [0.34, 0.34, 0.34, 0.66, 0.34, 0.34, 0.34, 0.34, 1.0, 0.34, 0.34, 0.34, 0.84, 0.34, 0.34]
COLOR_BARRA = {0.34: "#2E9A60", 0.66: AMBAR, 0.84: NARANJA, 1.0: ROJO}


def marca(ox, oy, ids):
    """Servidor 1U: caja, orejas con taladros, LED y la gráfica de 90 días."""
    w, h = 112, 52
    partes = [
        f'<g transform="translate({ox} {oy}) scale(1.0)">',
        f'<rect x="0" y="0" width="{w}" height="{h}" rx="9" fill="#18212A"/>',
        f'<rect x="10" y="6" width="{w-20}" height="{h-12}" rx="5" fill="#253241"/>',
        f'<rect x="10" y="6" width="{w-20}" height="3" rx="1.5" fill="#33445A"/>',
        '<circle cx="5" cy="16" r="1.8" fill="#070B0F"/><circle cx="5" cy="36" r="1.8" fill="#070B0F"/>',
        f'<circle cx="{w-5}" cy="16" r="1.8" fill="#070B0F"/><circle cx="{w-5}" cy="36" r="1.8" fill="#070B0F"/>',
        f'<circle cx="25" cy="26" r="9" fill="{VERDE}" opacity=".25" filter="url(#{ids}b)"/>',
        f'<circle cx="25" cy="26" r="5.2" fill="{VERDE}"/>',
        '<circle cx="23.4" cy="24.4" r="1.6" fill="#C9F5DB"/>',
        f'<rect x="40" y="13" width="{w-56}" height="26" rx="3" fill="#0A1016"/>',
    ]
    ancho, hueco, base = 2.6, 0.97, 35
    for k, b in enumerate(BARRAS):
        alto = 20 * b
        partes.append(f'<rect x="{43 + k*(ancho+hueco):.2f}" y="{base-alto:.2f}" width="{ancho}" '
                      f'height="{alto:.2f}" rx=".6" fill="{COLOR_BARRA[b]}"/>')
    partes.append("</g>")
    return "\n".join(partes)


def filtros(ids):
    return f'''<defs>
  <filter id="{ids}b" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="{ids}g" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>'''


def logo(tinta, nombre):
    trazos, i_x, ancho = palabra()
    tx = 6 + 112 + 26
    total, alto = tx + ancho + 10, 84
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 {total} {alto+8}" width="{total*2}" height="{(alto+8)*2}" role="img" aria-label="uptime">
<title>uptime</title>
{filtros(nombre)}

{marca(6, 16, nombre)}
<path d="{trazos}" transform="translate({tx} 0)" fill="none" stroke="{tinta}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="{tx+i_x}" cy="9.5" r="11" fill="{VERDE}" opacity=".35" filter="url(#{nombre}g)"/>
<circle cx="{tx+i_x}" cy="9.5" r="6.3" fill="{VERDE}"/>
<circle cx="{tx+i_x-1.9}" cy="7.6" r="1.9" fill="#C9F5DB"/>
</svg>'''


def marca_cuadrada():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="512" height="512" role="img" aria-label="uptime">
<title>uptime</title>
{filtros("q")}
<rect width="128" height="128" rx="28" fill="{SALA}"/>
{marca(8, 38, "q")}
</svg>'''


FAVICON = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="uptime">
<title>uptime</title>
<rect x="1" y="6" width="30" height="20" rx="4" fill="#18212A"/>
<rect x="3.5" y="8.5" width="25" height="15" rx="2.5" fill="#253241"/>
<circle cx="9.5" cy="16" r="3.6" fill="{VERDE}"/>
<rect x="15" y="15" width="2.6" height="5" rx=".8" fill="#2E9A60"/>
<rect x="18.6" y="13" width="2.6" height="7" rx=".8" fill="{AMBAR}"/>
<rect x="22.2" y="11" width="2.6" height="9" rx=".8" fill="{ROJO}"/>
</svg>
'''


# ---------------------------------------------------------------- la terminal animada

def terminal():
    """Una sesión que se escribe sola en bucle, con animación CSS (sin JavaScript)."""
    W, FS, LH, CW = 880, 15, 23, 9.03
    X0, Y0, CICLO = 26, 70, 18.0
    PROMPT = "bendi@noc:~$ "
    lineas, t = [], 0.6

    def orden(texto, dur):
        nonlocal t
        lineas.append((t, [(PROMPT, AZUL, 400), (texto, TINTA, 400)], "escribe", dur))
        t += dur + 0.45

    def salida(trozos, pausa=0.18):
        nonlocal t
        lineas.append((t, trozos, "aparece", 0))
        t += pausa

    orden("uptime", 0.5)
    salida([(" 17:42:08 up 90 days,  27 services,  2 failing,  load average: 0.07, 0.04, 0.03", TINTA, 400)], 0.7)
    orden("systemctl --failed", 1.1)
    salida([("[FAILED]", ROJO, 700), (" Cloudflare and AWS are having problems.", TINTA, 700)], 0.3)
    salida([("  ● ", ROJO, 400), ("cloudflare    ", TINTA, 400), ("major outage    ", ROJO, 400),
            ("62 of 473 components affected", TENUE, 400)])
    salida([("  ● ", NARANJA, 400), ("aws           ", TINTA, 400), ("partial outage  ", NARANJA, 400),
            ("Multiple services (UAE): Region Availability", TENUE, 400)], 0.8)
    orden("geoiplookup singapore", 1.2)
    salida([("● ", AMBAR, 400), ("Singapore  ", TINTA, 400), ("1.35°N 103.82°E  ", APAGADO, 400), ("linode", AZUL, 400),
            (" (degraded), ", AMBAR, 400), ("akamai", AZUL, 400), (" (degraded)", AMBAR, 400)], 0.8)
    lineas.append((t, [(PROMPT, AZUL, 400)], "cursor", 0))

    H = Y0 + LH * (len(lineas) - 1) + 34
    FIN = CICLO - 0.6
    pct = lambda s: f"{min(max(s / CICLO * 100, 0), 99.9):.3f}%"
    css = [f"""
.t {{ font-family: ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace; font-size: {FS}px; white-space: pre; }}
.x {{ opacity: 0; animation-duration: {CICLO}s; animation-iteration-count: infinite; animation-timing-function: steps(1, end); }}
@keyframes parpadeo {{ 0%, 49% {{ opacity: 1 }} 50%, 100% {{ opacity: 0 }} }}
@media (prefers-reduced-motion: reduce) {{ .x {{ animation: none !important; opacity: 1 !important; }} .c {{ animation: none !important; }} }}
"""]
    contador = 0

    def clase(inicio):
        nonlocal contador
        contador += 1
        n = f"k{contador}"
        css.append(f"@keyframes {n} {{ 0%, {pct(inicio)} {{ opacity: 0 }} {pct(inicio + 0.001)}, {pct(FIN)} "
                   f"{{ opacity: 1 }} {pct(FIN + 0.001)}, 100% {{ opacity: 0 }} }}\n.{n} {{ animation-name: {n}; }}")
        return n

    cuerpo = []
    for idx, (ini, trozos, tipo, dur) in enumerate(lineas):
        y = Y0 + idx * LH
        partes = []
        if tipo == "escribe":
            (p, cp, _), (texto, ct, _) = trozos
            partes.append(f'<tspan class="x {clase(ini - 0.35)}" fill="{cp}">{escape(p)}</tspan>')
            paso = dur / max(len(texto), 1)
            for k, ch in enumerate(texto):
                partes.append(f'<tspan class="x {clase(ini + k * paso)}" fill="{ct}">{escape(ch)}</tspan>')
        elif tipo == "aparece":
            c = clase(ini)
            for texto, color, peso in trozos:
                partes.append(f'<tspan class="x {c}" fill="{color}" font-weight="{peso}">{escape(texto)}</tspan>')
        else:
            c = clase(ini)
            partes.append(f'<tspan class="x {c}" fill="{AZUL}">{escape(PROMPT)}</tspan>')
            cx = X0 + len(PROMPT) * CW
            cuerpo.append(f'<rect class="x {c}" x="{cx:.1f}" y="{y - FS + 2}" width="{CW:.1f}" height="{FS + 3}" fill="{TINTA}">'
                          '<animate attributeName="fill-opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1.05s" repeatCount="indefinite"/></rect>')
        cuerpo.append(f'<text class="t" x="{X0}" y="{y}" xml:space="preserve">{"".join(partes)}</text>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="An uptime terminal session: uptime, systemctl --failed and geoiplookup singapore">
<title>uptime terminal</title>
<style>{"".join(css)}</style>
<rect width="{W}" height="{H}" rx="12" fill="#0A1016"/>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="11.5" fill="none" stroke="#1E2933"/>
<path d="M12 0.5H{W-12}A11.5 11.5 0 0 1 {W-0.5} 12V34H0.5V12A11.5 11.5 0 0 1 12 0.5Z" fill="#141C24"/>
<line x1="0.5" y1="34" x2="{W-0.5}" y2="34" stroke="#1E2933"/>
<text class="t" x="18" y="22" font-size="13" fill="{TENUE}">bendi@noc: ~</text>
<text class="t" x="150" y="22" font-size="13" fill="{APAGADO}">LANG=<tspan fill="{AZUL}">en_US</tspan></text>
<text class="t" x="{W-18}" y="22" font-size="13" fill="{TENUE}" text-anchor="end">updated 2 minutes ago</text>
{chr(10).join(cuerpo)}
</svg>'''


def main():
    LOGO.mkdir(parents=True, exist_ok=True)
    ficheros = {
        "uptime-oscuro.svg": logo(TINTA, "oscuro"),
        "uptime-claro.svg": logo(SALA, "claro"),
        "uptime-marca.svg": marca_cuadrada(),
        "uptime-favicon.svg": FAVICON,
        "terminal.svg": terminal(),
    }
    for nombre, contenido in ficheros.items():
        (LOGO / nombre).write_text(contenido, "utf-8")
        print(f"docs/logo/{nombre}")
    print("Si cambia el favicon, copia su dibujo al <link rel=\"icon\"> de index.html y a pintarConsola() en js/app.js.")


if __name__ == "__main__":
    main()
