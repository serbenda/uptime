#!/usr/bin/env python3
"""Builds the brand files in docs/logo/. Run it by hand whenever the design changes.

  logo-dark.svg      logo for dark backgrounds (mark + word)
  logo-light.svg     logo for light backgrounds
  mark.svg           square mark, for avatars
  favicon.svg        simplified mark for 16-32 px
  terminal.svg       the animated terminal at the top of the README

The word "uptime" is drawn with stroked paths (no fonts), so it looks the same everywhere.
The dot on the i is the status LED. Standard library only.

The social preview (social.png) and the README screenshots need a browser: they're made
by scripts/screenshots.py.
"""

from html import escape
from pathlib import Path

LOGO = Path(__file__).resolve().parent.parent / "docs" / "logo"

GREEN, BLUE, AMBER, ORANGE, RED = "#43D17F", "#6FB7FF", "#F2C230", "#FF8A2A", "#FF4D4D"
INK, DIM, MUTED, ROOM = "#DCE6EE", "#8494A3", "#4C5A67", "#0F151B"


# ---------------------------------------------------------------- the word

def word():
    """Strokes for "uptime": x-height from 20 to 60, ascender at 6, descender at 78."""
    x, strokes = 0, []
    strokes.append(f"M{x} 20V44a16 16 0 0 0 32 0V20M{x+32} 20V60"); x += 46                        # u
    strokes.append(f"M{x} 20V78M{x} 40a16 20 0 0 1 32 0a16 20 0 0 1-32 0"); x += 46                # p
    strokes.append(f"M{x+8} 6V46a14 14 0 0 0 14 14h4M{x-2} 22H{x+24}"); x += 38                   # t
    i_x = x
    strokes.append(f"M{x} 22V60"); x += 14                                                        # i (no dot)
    strokes.append(f"M{x} 60V20M{x} 34a11 12 0 0 1 22 0V60M{x+22} 34a11 12 0 0 1 22 0V60"); x += 58  # m
    strokes.append(f"M{x+1} 40H{x+32}A16 20 0 1 0 {x+27.5} 54"); x += 32                           # e
    return " ".join(strokes), i_x, x


# ---------------------------------------------------------------- the mark

BARS = [0.34, 0.34, 0.34, 0.66, 0.34, 0.34, 0.34, 0.34, 1.0, 0.34, 0.34, 0.34, 0.84, 0.34, 0.34]
BAR_COLOUR = {0.34: "#2E9A60", 0.66: AMBER, 0.84: ORANGE, 1.0: RED}


def mark(ox, oy, ids):
    """A 1U server: chassis, drilled rack ears, LED and the 90-day graph."""
    w, h = 112, 52
    parts = [
        f'<g transform="translate({ox} {oy}) scale(1.0)">',
        f'<rect x="0" y="0" width="{w}" height="{h}" rx="9" fill="#18212A"/>',
        f'<rect x="10" y="6" width="{w-20}" height="{h-12}" rx="5" fill="#253241"/>',
        f'<rect x="10" y="6" width="{w-20}" height="3" rx="1.5" fill="#33445A"/>',
        '<circle cx="5" cy="16" r="1.8" fill="#070B0F"/><circle cx="5" cy="36" r="1.8" fill="#070B0F"/>',
        f'<circle cx="{w-5}" cy="16" r="1.8" fill="#070B0F"/><circle cx="{w-5}" cy="36" r="1.8" fill="#070B0F"/>',
        f'<circle cx="25" cy="26" r="9" fill="{GREEN}" opacity=".25" filter="url(#{ids}b)"/>',
        f'<circle cx="25" cy="26" r="5.2" fill="{GREEN}"/>',
        '<circle cx="23.4" cy="24.4" r="1.6" fill="#C9F5DB"/>',
        f'<rect x="40" y="13" width="{w-56}" height="26" rx="3" fill="#0A1016"/>',
    ]
    width, gap, base = 2.6, 0.97, 35
    for k, b in enumerate(BARS):
        height = 20 * b
        parts.append(f'<rect x="{43 + k*(width+gap):.2f}" y="{base-height:.2f}" width="{width}" '
                     f'height="{height:.2f}" rx=".6" fill="{BAR_COLOUR[b]}"/>')
    parts.append("</g>")
    return "\n".join(parts)


def filters(ids):
    return f'''<defs>
  <filter id="{ids}b" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="{ids}g" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>'''


def logo(ink, name):
    strokes, i_x, width = word()
    tx = 6 + 112 + 26
    total, height = tx + width + 10, 84
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -8 {total} {height+8}" width="{total*2}" height="{(height+8)*2}" role="img" aria-label="uptime">
<title>uptime</title>
{filters(name)}

{mark(6, 16, name)}
<path d="{strokes}" transform="translate({tx} 0)" fill="none" stroke="{ink}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="{tx+i_x}" cy="9.5" r="11" fill="{GREEN}" opacity=".35" filter="url(#{name}g)"/>
<circle cx="{tx+i_x}" cy="9.5" r="6.3" fill="{GREEN}"/>
<circle cx="{tx+i_x-1.9}" cy="7.6" r="1.9" fill="#C9F5DB"/>
</svg>'''


def square_mark():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="512" height="512" role="img" aria-label="uptime">
<title>uptime</title>
{filters("q")}
<rect width="128" height="128" rx="28" fill="{ROOM}"/>
{mark(8, 38, "q")}
</svg>'''


FAVICON = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="uptime">
<title>uptime</title>
<rect x="1" y="6" width="30" height="20" rx="4" fill="#18212A"/>
<rect x="3.5" y="8.5" width="25" height="15" rx="2.5" fill="#253241"/>
<circle cx="9.5" cy="16" r="3.6" fill="{GREEN}"/>
<rect x="15" y="15" width="2.6" height="5" rx=".8" fill="#2E9A60"/>
<rect x="18.6" y="13" width="2.6" height="7" rx=".8" fill="{AMBER}"/>
<rect x="22.2" y="11" width="2.6" height="9" rx=".8" fill="{RED}"/>
</svg>
'''


# ---------------------------------------------------------------- the animated terminal

def terminal():
    """A session that types itself in a loop, with CSS animation (no JavaScript)."""
    W, FS, LH, CW = 880, 15, 23, 9.03
    X0, Y0, CYCLE = 26, 70, 18.0
    PROMPT = "bendi@noc:~$ "
    lines, t = [], 0.6

    def command(text, dur):
        nonlocal t
        lines.append((t, [(PROMPT, BLUE, 400), (text, INK, 400)], "typed", dur))
        t += dur + 0.45

    def output(pieces, pause=0.18):
        nonlocal t
        lines.append((t, pieces, "shown", 0))
        t += pause

    command("uptime", 0.5)
    output([(" 17:42:08 up 90 days,  27 services,  2 failing,  load average: 0.07, 0.04, 0.03", INK, 400)], 0.7)
    command("systemctl --failed", 1.1)
    output([("[FAILED]", RED, 700), (" Cloudflare and AWS are having problems.", INK, 700)], 0.3)
    output([("  ● ", RED, 400), ("cloudflare    ", INK, 400), ("major outage    ", RED, 400),
            ("62 of 473 components affected", DIM, 400)])
    output([("  ● ", ORANGE, 400), ("aws           ", INK, 400), ("partial outage  ", ORANGE, 400),
            ("Multiple services (UAE): Region Availability", DIM, 400)], 0.8)
    command("geoiplookup singapore", 1.2)
    output([("● ", AMBER, 400), ("Singapore  ", INK, 400), ("1.35°N 103.82°E  ", MUTED, 400), ("linode", BLUE, 400),
            (" (degraded), ", AMBER, 400), ("akamai", BLUE, 400), (" (degraded)", AMBER, 400)], 0.8)
    lines.append((t, [(PROMPT, BLUE, 400)], "cursor", 0))

    H = Y0 + LH * (len(lines) - 1) + 34
    END = CYCLE - 0.6
    percent = lambda s: f"{min(max(s / CYCLE * 100, 0), 99.9):.3f}%"
    css = [f"""
.t {{ font-family: ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace; font-size: {FS}px; white-space: pre; }}
.x {{ opacity: 0; animation-duration: {CYCLE}s; animation-iteration-count: infinite; animation-timing-function: steps(1, end); }}
@keyframes blink {{ 0%, 49% {{ opacity: 1 }} 50%, 100% {{ opacity: 0 }} }}
@media (prefers-reduced-motion: reduce) {{ .x {{ animation: none !important; opacity: 1 !important; }} .c {{ animation: none !important; }} }}
"""]
    counter = 0

    def cls(start):
        nonlocal counter
        counter += 1
        n = f"k{counter}"
        css.append(f"@keyframes {n} {{ 0%, {percent(start)} {{ opacity: 0 }} {percent(start + 0.001)}, {percent(END)} "
                   f"{{ opacity: 1 }} {percent(END + 0.001)}, 100% {{ opacity: 0 }} }}\n.{n} {{ animation-name: {n}; }}")
        return n

    body = []
    for idx, (start, pieces, kind, dur) in enumerate(lines):
        y = Y0 + idx * LH
        parts = []
        if kind == "typed":
            (p, cp, _), (text, ct, _) = pieces
            parts.append(f'<tspan class="x {cls(start - 0.35)}" fill="{cp}">{escape(p)}</tspan>')
            step = dur / max(len(text), 1)
            for k, ch in enumerate(text):
                parts.append(f'<tspan class="x {cls(start + k * step)}" fill="{ct}">{escape(ch)}</tspan>')
        elif kind == "shown":
            c = cls(start)
            for text, color, weight in pieces:
                parts.append(f'<tspan class="x {c}" fill="{color}" font-weight="{weight}">{escape(text)}</tspan>')
        else:
            c = cls(start)
            parts.append(f'<tspan class="x {c}" fill="{BLUE}">{escape(PROMPT)}</tspan>')
            cx = X0 + len(PROMPT) * CW
            body.append(f'<rect class="x {c}" x="{cx:.1f}" y="{y - FS + 2}" width="{CW:.1f}" height="{FS + 3}" fill="{INK}">'
                          '<animate attributeName="fill-opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1.05s" repeatCount="indefinite"/></rect>')
        body.append(f'<text class="t" x="{X0}" y="{y}" xml:space="preserve">{"".join(parts)}</text>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="An uptime terminal session: uptime, systemctl --failed and geoiplookup singapore">
<title>uptime terminal</title>
<style>{"".join(css)}</style>
<rect width="{W}" height="{H}" rx="12" fill="#0A1016"/>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="11.5" fill="none" stroke="#1E2933"/>
<path d="M12 0.5H{W-12}A11.5 11.5 0 0 1 {W-0.5} 12V34H0.5V12A11.5 11.5 0 0 1 12 0.5Z" fill="#141C24"/>
<line x1="0.5" y1="34" x2="{W-0.5}" y2="34" stroke="#1E2933"/>
<text class="t" x="18" y="22" font-size="13" fill="{DIM}">bendi@noc: ~</text>
<text class="t" x="150" y="22" font-size="13" fill="{MUTED}">LANG=<tspan fill="{BLUE}">en_US</tspan></text>
<text class="t" x="{W-18}" y="22" font-size="13" fill="{DIM}" text-anchor="end">updated 2 minutes ago</text>
{chr(10).join(body)}
</svg>'''


def main():
    LOGO.mkdir(parents=True, exist_ok=True)
    files = {
        "logo-dark.svg": logo(INK, "dark"),
        "logo-light.svg": logo(ROOM, "light"),
        "mark.svg": square_mark(),
        "favicon.svg": FAVICON,
        "terminal.svg": terminal(),
    }
    for name, content in files.items():
        (LOGO / name).write_text(content, "utf-8")
        print(f"docs/logo/{name}")
    print("If the favicon changes, copy its drawing to the <link rel=\"icon\"> in index.html and to renderConsole() in js/app.js.")


if __name__ == "__main__":
    main()
