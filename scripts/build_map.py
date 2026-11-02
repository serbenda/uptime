#!/usr/bin/env python3
"""Builds the map's two fixed files. Run it by hand whenever data/geo/ changes.

  data/map.json      the world map as an LED matrix: one hex row per parallel, one bit per
                     land dot (equirectangular projection, odd rows shifted half a dot)
  data/places.json   the gazetteer update.py uses to place components and incidents:
                     cloud regions, IATA codes, cities, countries (with their centroid) and zones

Reads data/geo/world.geojson (public-domain borders), data/geo/countries.json (ISO 3166 names
in English and Spanish) and data/geo/places_base.json (cities, regions and zones, hand-made).
Standard library only.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "data" / "geo"

# Map grid: from 82° N to 56° S, every 1.5°
STEP = 1.5
LAT_MAX, LAT_MIN = 82.0, -56.0
COLUMNS = int(360 / STEP)
ROWS = int((LAT_MAX - LAT_MIN) / STEP) + 1


def polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def inside(lon, lat, ring):
    """Ray casting: is the point inside the ring?"""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi:
            hit = not hit
        j = i
    return hit


def in_polygon(lon, lat, polygon):
    return inside(lon, lat, polygon[0]) and not any(inside(lon, lat, hole) for hole in polygon[1:])


def area_and_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-9:
        xs, ys = zip(*ring)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return abs(a / 2), cx / (3 * a), cy / (3 * a)


def build_map(features):
    shapes = []
    for f in features:
        for p in polygons(f["geometry"]):
            xs = [c[0] for c in p[0]]
            ys = [c[1] for c in p[0]]
            shapes.append(((min(xs), max(xs), min(ys), max(ys)), p))
    rows = []
    for row in range(ROWS):
        lat = LAT_MAX - row * STEP
        offset = STEP / 2 if row % 2 else 0
        bits = []
        for col in range(COLUMNS):
            lon = -180 + col * STEP + offset
            land = any(x0 <= lon <= x1 and y0 <= lat <= y1 and in_polygon(lon, lat, p)
                       for (x0, x1, y0, y1), p in shapes)
            bits.append("1" if land else "0")
        line = "".join(bits)
        rows.append("".join(f"{int(line[i:i + 4], 2):x}" for i in range(0, COLUMNS, 4)))
    return {"step": STEP, "lat_max": LAT_MAX, "columns": COLUMNS, "rows": rows}


def build_places(features, iso, base):
    by_name = {}
    for c in iso:
        for n in c["names"] + c["names_es"]:
            by_name.setdefault(n, c)
    by_a3 = {c["a3"]: c for c in iso}
    by_a2 = {c["a2"]: c for c in iso}

    places = {}
    # Countries: centroid of the largest polygon (the mainland)
    for f in features:
        c = by_name.get(f["properties"]["name"])
        if not c:
            continue
        best = max((area_and_centroid(poly[0]) for poly in polygons(f["geometry"])), default=None)
        if best:
            en = f["properties"]["name"]
            places[c["a3"]] = {"en": en, "es": (c["names_es"] or [en])[0],
                               "lat": round(best[2], 2), "lon": round(best[1], 2)}
    for code, (lat, lon) in base["extra_countries"].items():
        c = by_a3[code]
        en = max(c["names"], key=lambda n: (n.count(" ") < 3, -len(n)))
        places.setdefault(code, {"en": en, "es": (c["names_es"] or [en])[0], "lat": lat, "lon": lon})

    places["USA"]["en"] = "United States"

    cities, iata = {}, {}
    for entry in base["cities"]:
        code, en, es, country, lat, lon = entry[:6]
        ambiguous = len(entry) > 6 and entry[6] == "-"
        c = by_a2.get(country, {})
        # Cities are prefixed with "@": FRA is Frankfurt as an airport and France as a country
        places["@" + code] = {"en": en, "es": es or en, "lat": lat, "lon": lon,
                              "country": c.get("a3", ""),
                              "country_en": places.get(c.get("a3"), {}).get("en", ""),
                              "country_es": places.get(c.get("a3"), {}).get("es", "")}
        iata[code] = "@" + code
        if not ambiguous:
            cities[en] = "@" + code
            if es:
                cities[es] = "@" + code
    for alias, code in base["city_aliases"].items():
        cities[alias] = "@" + code

    for zone_id, (lat, lon, en, es) in base["zones"].items():
        places["Z:" + zone_id] = {"en": en, "es": es, "lat": lat, "lon": lon}

    countries = {}
    for c in iso:
        if c["a3"] not in places:
            continue
        for n in c["names"] + c["names_es"]:
            if len(n) > 3 and "," not in n:
                countries[n] = c["a3"]
    for alias, code in base["country_aliases"].items():
        countries[alias] = code

    return {
        "regions": {k: "@" + v for k, v in base["regions"].items()},
        "iata": iata,
        "cities": cities,
        "countries": countries,
        "zones": {k: "Z:" + v for k, v in base["zone_aliases"].items()},
        "places": places,
    }


def main():
    features = json.loads((GEO / "world.geojson").read_text("utf-8"))["features"]
    iso = json.loads((GEO / "countries.json").read_text("utf-8"))
    base = json.loads((GEO / "places_base.json").read_text("utf-8"))

    world = build_map(features)
    (ROOT / "data" / "map.json").write_text(json.dumps(world, separators=(",", ":")), "utf-8")
    places = build_places(features, iso, base)
    (ROOT / "data" / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")), "utf-8")

    dots = sum(bin(int(r, 16)).count("1") for r in world["rows"])
    print(f"map: {ROWS}×{COLUMNS}, {dots} land dots")
    print(f"places: {len(places['places'])} ({len(places['iata'])} cities, {len(places['regions'])} regions, "
          f"{len(places['countries'])} country names)")


if __name__ == "__main__":
    main()
