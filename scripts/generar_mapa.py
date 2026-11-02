#!/usr/bin/env python3
"""Genera los dos ficheros fijos del mapa. Se ejecuta a mano cuando cambia data/geo/.

  data/mapa.json      el mapamundi como matriz de LED: una fila hexadecimal por paralelo,
                      un bit por punto de tierra (proyección equirectangular, filas alternas desplazadas)
  data/lugares.json   el diccionario que usa actualizar.py para ubicar componentes e incidencias:
                      regiones de nube, códigos IATA, ciudades, países (con su centroide) y zonas

Lee data/geo/mundo.geojson (fronteras, dominio público), data/geo/paises.json (nombres ISO 3166
en inglés y en castellano) y data/geo/lugares_base.json (ciudades, regiones y zonas, a mano).
Solo usa la biblioteca estándar.
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
GEO = RAIZ / "data" / "geo"

# Rejilla del mapa: de 82° N a 56° S, cada 1,5°
PASO = 1.5
LAT_MAX, LAT_MIN = 82.0, -56.0
COLUMNAS = int(360 / PASO)
FILAS = int((LAT_MAX - LAT_MIN) / PASO) + 1


def anillos(geometria):
    if geometria["type"] == "Polygon":
        return [geometria["coordinates"]]
    if geometria["type"] == "MultiPolygon":
        return geometria["coordinates"]
    return []


def dentro(lon, lat, anillo):
    """Ray casting: ¿está el punto dentro del anillo?"""
    hay = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i][0], anillo[i][1]
        xj, yj = anillo[j][0], anillo[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi:
            hay = not hay
        j = i
    return hay


def en_poligono(lon, lat, poligono):
    return dentro(lon, lat, poligono[0]) and not any(dentro(lon, lat, h) for h in poligono[1:])


def area_y_centro(anillo):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(anillo, anillo[1:] + anillo[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-9:
        xs, ys = zip(*anillo)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return abs(a / 2), cx / (3 * a), cy / (3 * a)


def generar_mapa(paises):
    poligonos = []
    for f in paises:
        for p in anillos(f["geometry"]):
            xs = [c[0] for c in p[0]]
            ys = [c[1] for c in p[0]]
            poligonos.append(((min(xs), max(xs), min(ys), max(ys)), p))
    filas = []
    for fila in range(FILAS):
        lat = LAT_MAX - fila * PASO
        desplazamiento = PASO / 2 if fila % 2 else 0
        bits = []
        for col in range(COLUMNAS):
            lon = -180 + col * PASO + desplazamiento
            tierra = any(x0 <= lon <= x1 and y0 <= lat <= y1 and en_poligono(lon, lat, p)
                         for (x0, x1, y0, y1), p in poligonos)
            bits.append("1" if tierra else "0")
        cadena = "".join(bits)
        filas.append("".join(f"{int(cadena[i:i + 4], 2):x}" for i in range(0, COLUMNAS, 4)))
    return {"paso": PASO, "lat_max": LAT_MAX, "columnas": COLUMNAS, "filas": filas}


def generar_lugares(paises_geo, iso, base):
    por_nombre = {}
    for p in iso:
        for n in p["nombres"] + p["nombres_es"]:
            por_nombre.setdefault(n, p)
    a3 = {p["a3"]: p for p in iso}
    a2 = {p["a2"]: p for p in iso}

    lugares = {}
    # Países: centroide del polígono más grande (la parte continental)
    for f in paises_geo:
        p = por_nombre.get(f["properties"]["name"])
        if not p:
            continue
        mejor = max((area_y_centro(pol[0]) for pol in anillos(f["geometry"])), default=None)
        if mejor:
            en = f["properties"]["name"]
            lugares[p["a3"]] = {"en": en, "es": (p["nombres_es"] or [en])[0],
                                "lat": round(mejor[2], 2), "lon": round(mejor[1], 2)}
    for codigo, (lat, lon) in base["paises_extra"].items():
        p = a3[codigo]
        en = max(p["nombres"], key=lambda n: (n.count(" ") < 3, -len(n)))
        lugares.setdefault(codigo, {"en": en, "es": (p["nombres_es"] or [en])[0], "lat": lat, "lon": lon})

    lugares["USA"]["en"] = "United States"

    ciudades, iata = {}, {}
    for c in base["ciudades"]:
        codigo, en, es, pais, lat, lon = c[:6]
        ambigua = len(c) > 6 and c[6] == "-"
        p = a2.get(pais, {})
        # Las ciudades llevan "@" delante: FRA es Frankfurt como aeropuerto y Francia como país
        lugares["@" + codigo] = {"en": en, "es": es or en, "lat": lat, "lon": lon,
                           "pais": p.get("a3", ""),
                           "pais_en": lugares.get(p.get("a3"), {}).get("en", ""),
                           "pais_es": lugares.get(p.get("a3"), {}).get("es", "")}
        iata[codigo] = "@" + codigo
        if not ambigua:
            ciudades[en] = "@" + codigo
            if es:
                ciudades[es] = "@" + codigo
    for alias, codigo in base["alias_ciudades"].items():
        ciudades[alias] = "@" + codigo

    for id_zona, (lat, lon, en, es) in base["zonas"].items():
        lugares["Z:" + id_zona] = {"en": en, "es": es, "lat": lat, "lon": lon}

    paises = {}
    for p in iso:
        if p["a3"] not in lugares:
            continue
        for n in p["nombres"] + p["nombres_es"]:
            if len(n) > 3 and "," not in n:
                paises[n] = p["a3"]
    for alias, codigo in base["alias_paises"].items():
        paises[alias] = codigo

    return {
        "regiones": {k: "@" + v for k, v in base["regiones"].items()},
        "iata": iata,
        "ciudades": ciudades,
        "paises": paises,
        "zonas": {k: "Z:" + v for k, v in base["alias_zonas"].items()},
        "lugares": lugares,
    }


def main():
    mundo = json.loads((GEO / "mundo.geojson").read_text("utf-8"))["features"]
    iso = json.loads((GEO / "paises.json").read_text("utf-8"))
    base = json.loads((GEO / "lugares_base.json").read_text("utf-8"))

    mapa = generar_mapa(mundo)
    (RAIZ / "data" / "mapa.json").write_text(json.dumps(mapa, separators=(",", ":")), "utf-8")
    lugares = generar_lugares(mundo, iso, base)
    (RAIZ / "data" / "lugares.json").write_text(json.dumps(lugares, ensure_ascii=False, separators=(",", ":")), "utf-8")

    puntos = sum(bin(int(f, 16)).count("1") for f in mapa["filas"])
    print(f"mapa: {FILAS}×{COLUMNAS}, {puntos} puntos de tierra")
    print(f"lugares: {len(lugares['lugares'])} ({len(lugares['iata'])} ciudades, {len(lugares['regiones'])} regiones, "
          f"{len(lugares['paises'])} nombres de país)")


if __name__ == "__main__":
    main()
