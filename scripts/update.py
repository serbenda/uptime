#!/usr/bin/env python3
"""Reads the providers' official status pages, turns them into a common format and
keeps the history. Python standard library only.

Every provider publishes its status in its own way. This script understands seven formats:
  statuspage    Atlassian Statuspage (/api/v2/summary.json): GitHub, Red Hat, Cloudflare…
  statusio      status.io (api.status.io): GitLab and Docker Hub
  google        incidents.json from Google Cloud and Google Workspace
  azure         Azure's active incidents RSS feed
  azure-devops  Azure DevOps public health API
  aws           current public events from the AWS Health Dashboard
  slack         Slack's status API

Reads from data/ (fixed files, on main):
  providers.json   which providers are queried and in which format
  places.json      the gazetteer used to place failures on the map (built by scripts/build_map.py)
Writes to $UPTIME_OUTPUT (data/ by default; in the Action, the `data` branch):
  status.json      current status of every provider (incidents, components, maintenance, map points)
  history.json     daily summary per provider (last 90 days) for the availability bars
  incidents.json   log of the incidents seen in the last 30 days, with their duration

Files written by older versions, with Spanish names (estado.json, historial.json,
incidencias.json), are migrated automatically on the first run and then removed.
"""

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUTPUT = Path(os.environ.get("UPTIME_OUTPUT") or DATA)
NOW = datetime.now(timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")

HISTORY_DAYS = 90
INCIDENT_DAYS = 30
FAILURES_BEFORE_ALERT = 18       # runs in a row (3 h at 10 min each) before opening an issue
MAX_COMPONENTS = 12              # affected components stored per provider
MAX_TEXT = 600                   # characters kept from each incident's latest message
TIMEOUT = 20
RETRIES = 2
USER_AGENT = "uptime/1.0 (+https://github.com/serbenda/uptime)"

# From best to worst. Two values sit outside the scale: "unknown" (no data) and, for
# incidents only, "advisory": informational notices (security ones, for instance) that the
# provider publishes with no impact on the service. They're shown, but don't change the status.
LEVELS = ["operational", "maintenance", "degraded", "partial", "major"]
RANK = {n: i for i, n in enumerate(LEVELS)}

# Providers with many components (Cloudflare has hundreds of data centres) almost always have
# a few down or rerouted. If fewer than this share are affected and there's no serious
# incident, the provider is capped at "degraded".
MIN_SCOPE = 0.05
MIN_COMPONENTS = 20


class UnexpectedFormat(Exception):
    """The source responded, but not in the expected format."""


# ---------------------------------------------------------------- helpers


def worst(*levels):
    valid = [n for n in levels if n in RANK]
    return max(valid, key=RANK.get) if valid else "operational"


# ---------------------------------------------------------------- placing failures on the map

def _load_places():
    try:
        return json.loads((DATA / "places.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {"regions": {}, "iata": {}, "cities": {}, "countries": {}, "zones": {}, "places": {}}


PLACES = _load_places()
MAX_PLACES = 80           # map points per provider
MAX_EXAMPLES = 4          # source texts stored per point


def _pattern(keys, case_sensitive=True):
    """One regex with every key, longest first ("East US 2" before "East US")."""
    if not keys:
        return None
    options = "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])({options})(?![\w-])", 0 if case_sensitive else re.I)


_IATA = re.compile(r"\(([A-Z]{3})\)|^([A-Z]{3})\s*\(|(?<![A-Za-z])[A-Z]{2}-([A-Z]{3})(?![A-Za-z])")
_PLACE_TIERS = [
    ("regions", _pattern(PLACES["regions"], case_sensitive=False), {k.lower(): v for k, v in PLACES["regions"].items()}),
    ("iata", None, PLACES["iata"]),
    ("cities", _pattern(PLACES["cities"]), PLACES["cities"]),
    ("countries", _pattern(PLACES["countries"]), PLACES["countries"]),
    ("zones", _pattern(PLACES["zones"]), PLACES["zones"]),
]


def locate(text):
    """Place ids mentioned in a text, as specific as possible.

    Cloud regions, IATA codes and cities are looked for first; countries only count when
    there isn't already a city in that country ("Houston, United States - (IAH)" gives
    Houston, "Indonesia and Singapore" gives both), and world zones only when nothing more
    specific was found.
    """
    if not text:
        return []
    found = {}
    for tier, pattern, table in _PLACE_TIERS:
        if tier == "iata":
            ids = [table[c] for m in _IATA.finditer(text) for c in m.groups() if c and c in table]
        else:
            ids = [table[m.group(1).lower() if tier == "regions" else m.group(1)]
                   for m in pattern.finditer(text)] if pattern else []
        found[tier] = ids
    specific = found["regions"] + found["iata"] + found["cities"]
    countries_with_a_city = {PLACES["places"].get(i, {}).get("country") for i in specific}
    ids = specific + [i for i in found["countries"] if i not in countries_with_a_city]
    return list(dict.fromkeys(ids or found["zones"]))


def place_failures(r, affected):
    """Map points: one place with its worst level and examples of what's failing there."""
    points, unlocated = {}, 0

    def add(texts, level):
        nonlocal unlocated
        ids = list(dict.fromkeys(i for t in texts for i in locate(t)))
        if not ids:
            unlocated += 1
            return
        for i in ids:
            place = PLACES["places"].get(i)
            if not place:
                continue
            p = points.setdefault(i, {"id": i, **place, "level": "operational", "n": 0, "examples": []})
            p["level"] = worst(p["level"], level)
            p["n"] += 1
            if len(p["examples"]) < MAX_EXAMPLES:
                p["examples"].append({"t": texts[0][:120], "level": level})

    for c in affected:
        add([c["name"]], c["status"])
    for i in r["incidents"]:
        texts = i.pop("place_texts", [])
        if i["impact"] != "advisory":
            add([i["title"], *texts], i["impact"])
    r["places"] = sorted(points.values(), key=lambda p: (-RANK[p["level"]], -p["n"]))[:MAX_PLACES]
    r["unlocated"] = unlocated


def cap(level, ceiling):
    return level if RANK.get(level, -1) <= RANK[ceiling] else ceiling


def final_status(r, indicator, affected, in_progress=False):
    """Worst level among indicator, components, incidents and maintenance, with the scope cap."""
    impacts = [i["impact"] for i in r["incidents"]]
    components = worst(*(c["status"] for c in affected))
    total = r["total_components"]
    serious = any(RANK.get(n, -1) >= RANK["partial"] for n in impacts)
    r["affected"] = len(affected)
    r["limited_scope"] = bool(affected) and total >= MIN_COMPONENTS \
        and len(affected) / total < MIN_SCOPE and not serious
    if r["limited_scope"]:
        components, indicator = cap(components, "degraded"), cap(indicator, "degraded")
    place_failures(r, affected)
    return worst(indicator, components, *impacts, "maintenance" if in_progress else "operational")


def clean_text(value, limit=MAX_TEXT):
    """Strips HTML tags and extra whitespace, and trims."""
    if not value:
        return ""
    t = re.sub(r"<br\s*/?>|</p>|</li>", "\n", str(value), flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def iso_date(value):
    """Turns ISO 8601, RFC 822 or seconds since 1970 into ISO in UTC ('…Z')."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or re.fullmatch(r"\d{9,13}(\.\d+)?", str(value)):
            n = float(value)
            d = datetime.fromtimestamp(n / 1000 if n > 1e11 else n, timezone.utc)
        elif re.match(r"\d{4}-\d{2}-\d{2}", str(value)):
            d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        else:
            d = parsedate_to_datetime(str(value))
    except (ValueError, TypeError, OverflowError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_datetime(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None


def download(url):
    error = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            error = e
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                break
            time.sleep(2 * (attempt + 1))
    raise error


def parse_json(raw):
    """JSON in UTF-8 or UTF-16 (AWS serves it as UTF-16 with a BOM)."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        text = raw.decode("utf-8-sig")
    try:
        return json.loads(text)
    except ValueError as e:
        raise UnexpectedFormat(f"not JSON: {e}") from e


def empty():
    return {"status": "operational", "description": "", "components": [], "total_components": 0, "affected": 0,
            "limited_scope": False, "incidents": [], "maintenance": [], "places": [], "unlocated": 0}


# ---------------------------------------------------------------- Statuspage

SP_COMPONENT = {"operational": "operational", "degraded_performance": "degraded", "partial_outage": "partial",
                "major_outage": "major", "under_maintenance": "maintenance"}
SP_IMPACT = {"none": "advisory", "minor": "degraded", "major": "partial", "critical": "major",
             "maintenance": "maintenance"}
SP_INDICATOR = {"none": "operational", "minor": "degraded", "major": "partial", "critical": "major",
                "maintenance": "maintenance"}
SP_PHASE = {"investigating": "Investigating", "identified": "Identified", "monitoring": "Monitoring",
            "resolved": "Resolved", "postmortem": "Postmortem", "scheduled": "Scheduled",
            "in_progress": "In progress", "verifying": "Verifying", "completed": "Completed"}


def latest_update(updates, field="body"):
    if not updates:
        return ""
    ordered = sorted(updates, key=lambda u: str(u.get("display_at") or u.get("created_at") or ""))
    return clean_text(ordered[-1].get(field))


# Security notices some providers (Akamai, Linode) publish as minor incidents
SECURITY_ADVISORY = re.compile(r"security advisory|security bulletin|\bCVE-\d{4}-\d+", re.I)


def sp_impact(incident):
    impact = SP_IMPACT.get(incident.get("impact"), "degraded")
    if impact == "degraded" and SECURITY_ADVISORY.search(incident.get("name") or ""):
        return "advisory"
    return impact


def parse_statuspage(data, prov):
    if not isinstance(data, dict) or "status" not in data or "components" not in data:
        raise UnexpectedFormat("missing status or components")
    r = empty()
    web = prov.get("web") or prov["url"]
    components = [c for c in data.get("components") or [] if not c.get("group")]
    r["total_components"] = len(components)
    affected = []
    for c in components:
        level = SP_COMPONENT.get(c.get("status"), "operational")
        if level != "operational":
            affected.append({"name": c.get("name") or "?", "status": level})
    affected.sort(key=lambda c: -RANK[c["status"]])
    r["components"] = affected[:MAX_COMPONENTS]

    for i in data.get("incidents") or []:
        if i.get("status") in ("resolved", "postmortem"):
            continue
        r["incidents"].append({
            "id": str(i.get("id") or i.get("name")),
            "title": clean_text(i.get("name"), 200),
            "impact": sp_impact(i),
            "phase": SP_PHASE.get(i.get("status"), i.get("status") or ""),
            "started": iso_date(i.get("started_at") or i.get("created_at")),
            "updated": iso_date(i.get("updated_at")),
            "message": latest_update(i.get("incident_updates")),
            "link": i.get("shortlink") or f"{web.rstrip('/')}/incidents/{i.get('id')}",
            "place_texts": [c.get("name") or "" for c in i.get("components") or [] if isinstance(c, dict)],
        })

    in_progress = False
    for m in data.get("scheduled_maintenances") or []:
        if m.get("status") == "completed":
            continue
        active = m.get("status") in ("in_progress", "verifying")
        in_progress = in_progress or active
        r["maintenance"].append({
            "id": str(m.get("id") or m.get("name")),
            "title": clean_text(m.get("name"), 200),
            "phase": SP_PHASE.get(m.get("status"), m.get("status") or ""),
            "in_progress": active,
            "start": iso_date(m.get("scheduled_for")),
            "end": iso_date(m.get("scheduled_until")),
            "link": m.get("shortlink") or f"{web.rstrip('/')}/incidents/{m.get('id')}",
        })

    st = data.get("status") or {}
    r["description"] = clean_text(st.get("description"), 200)
    r["status"] = final_status(r, SP_INDICATOR.get(st.get("indicator"), "operational"), affected, in_progress)
    return r


# ---------------------------------------------------------------- status.io

SIO_CODE = {100: "operational", 200: "maintenance", 300: "degraded", 400: "partial", 500: "major", 600: "major"}


def sio_level(code):
    try:
        return SIO_CODE.get(int(code), "operational")
    except (TypeError, ValueError):
        return "operational"


def parse_statusio(data, prov):
    res = data.get("result") if isinstance(data, dict) else None
    if not isinstance(res, dict) or "status_overall" not in res:
        raise UnexpectedFormat("missing result.status_overall")
    r = empty()
    page, web = prov["page"], prov.get("web", "")
    components = res.get("status") or []
    r["total_components"] = len(components)
    affected = []
    for c in components:
        level = sio_level(c.get("status_code"))
        if level != "operational":
            affected.append({"name": c.get("name") or "?", "status": level})
    affected.sort(key=lambda c: -RANK[c["status"]])
    r["components"] = affected[:MAX_COMPONENTS]

    for i in res.get("incidents") or []:
        messages = sorted(i.get("messages") or [], key=lambda m: str(m.get("datetime") or ""))
        last = messages[-1] if messages else {}
        r["incidents"].append({
            "id": str(i.get("_id") or i.get("name")),
            "title": clean_text(i.get("name"), 200),
            "impact": worst(sio_level(last.get("status")), "degraded"),
            "phase": clean_text(last.get("state"), 40) if isinstance(last.get("state"), str) else "",
            "started": iso_date(i.get("datetime_open")),
            "updated": iso_date(last.get("datetime") or i.get("datetime_open")),
            "message": clean_text(last.get("details")),
            "link": f"{web.rstrip('/')}/pages/incident/{page}/{i.get('_id')}" if i.get("_id") else web,
        })

    maint = res.get("maintenance") or {}
    for key, active in (("active", True), ("upcoming", False)):
        for m in maint.get(key) or []:
            r["maintenance"].append({
                "id": str(m.get("_id") or m.get("name")),
                "title": clean_text(m.get("name"), 200),
                "phase": "In progress" if active else "Scheduled",
                "in_progress": active,
                "start": iso_date(m.get("datetime_planned_start")),
                "end": iso_date(m.get("datetime_planned_end")),
                "link": f"{web.rstrip('/')}/pages/maintenance/{page}/{m.get('_id')}" if m.get("_id") else web,
            })

    overall = res["status_overall"] or {}
    r["description"] = clean_text(overall.get("status"), 200)
    r["status"] = final_status(r, sio_level(overall.get("status_code")), affected, bool(maint.get("active")))
    return r


# ---------------------------------------------------------------- Google Cloud and Workspace

GOOGLE_IMPACT = {"SERVICE_INFORMATION": "degraded", "SERVICE_DISRUPTION": "partial", "SERVICE_OUTAGE": "major"}


def parse_google(data, prov):
    if not isinstance(data, list):
        raise UnexpectedFormat("expected a list of incidents")
    r = empty()
    base = prov.get("web", "").rstrip("/") + "/"
    affected = {}
    for i in data:
        if i.get("end"):
            continue
        started = iso_date(i.get("begin"))
        if started and to_datetime(started) > NOW + timedelta(hours=1):
            continue
        impact = GOOGLE_IMPACT.get(i.get("status_impact"), "degraded")
        products = [p.get("title") for p in i.get("affected_products") or [] if p.get("title")]
        for p in products:
            affected[p] = worst(affected.get(p, "operational"), impact)
        latest = i.get("most_recent_update") or {}
        uri = i.get("uri") or ""
        r["incidents"].append({
            "id": str(i.get("id") or i.get("number") or i.get("external_desc")),
            "title": clean_text(i.get("external_desc"), 200),
            "impact": impact,
            "phase": "",
            "started": started,
            "updated": iso_date(i.get("modified") or latest.get("modified")),
            "message": clean_text(latest.get("text")),
            "link": uri if uri.startswith("http") else base + uri.lstrip("/"),
            "affects": products[:8],
            "place_texts": [loc.get("title") or "" for loc in i.get("currently_affected_locations") or []],
        })
    r["components"] = sorted(({"name": n, "status": s} for n, s in affected.items()),
                             key=lambda c: -RANK[c["status"]])[:MAX_COMPONENTS]
    r["status"] = final_status(r, "operational", r["components"])
    return r


# ---------------------------------------------------------------- Azure (RSS)


def parse_azure(data, prov):
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise UnexpectedFormat(f"invalid RSS: {e}") from e
    channel = root.find("channel")
    if channel is None:
        raise UnexpectedFormat("RSS without a channel")
    r = empty()
    for item in channel.findall("item"):
        title = clean_text(item.findtext("title"), 200)
        date = iso_date(item.findtext("pubDate"))
        r["incidents"].append({
            "id": item.findtext("guid") or item.findtext("link") or title,
            "title": title,
            "impact": "partial",
            "phase": "",
            "started": date,
            "updated": date,
            "message": clean_text(item.findtext("description")),
            "link": item.findtext("link") or prov.get("web"),
        })
    r["status"] = final_status(r, "operational", r["components"])
    return r


# ---------------------------------------------------------------- Azure DevOps

ADO_HEALTH = {"healthy": "operational", "advisory": "degraded", "degraded": "partial", "unhealthy": "major"}


def parse_azure_devops(data, prov):
    st = data.get("status") if isinstance(data, dict) else None
    if not isinstance(st, dict) or "health" not in st:
        raise UnexpectedFormat("missing status.health")
    r = empty()
    services = data.get("services") or []
    r["total_components"] = len(services)
    affected = []
    for s in services:
        bad = [(g.get("name") or g.get("id"), ADO_HEALTH.get(g.get("health"), "operational"))
               for g in s.get("geographies") or []]
        bad = [(n, level) for n, level in bad if level != "operational"]
        if bad:
            level = worst(*(lv for _, lv in bad))
            geos = ", ".join(n for n, _ in bad[:4])
            affected.append({"name": f"{s.get('id')} ({geos})", "status": level})
    affected.sort(key=lambda c: -RANK[c["status"]])
    r["components"] = affected[:MAX_COMPONENTS]
    level = ADO_HEALTH.get(st.get("health"), "operational")
    r["description"] = clean_text(st.get("message"), 200)
    # Azure DevOps reports maintenance as "advisory": if the message says so, it's maintenance
    if level != "operational" and "maintenance" in r["description"].lower():
        level = "maintenance"
        affected = [dict(c, status="maintenance") for c in affected]
        r["components"] = affected[:MAX_COMPONENTS]
    if RANK[level] >= RANK["degraded"]:
        r["incidents"].append({
            "id": "ado-" + (iso_date(data.get("lastUpdated")) or TODAY)[:10],
            "title": r["description"] or "Azure DevOps incident",
            "impact": level, "phase": "", "started": None,
            "updated": iso_date(data.get("lastUpdated")),
            "message": "", "link": prov.get("web"),
        })
    r["status"] = final_status(r, level, affected, level == "maintenance")
    return r


# ---------------------------------------------------------------- AWS


def parse_aws(data, prov):
    if isinstance(data, dict):
        data = data.get("current") or data.get("events") or []
    if not isinstance(data, list):
        raise UnexpectedFormat("expected a list of events")
    r = empty()
    affected = {}
    for e in data:
        if not isinstance(e, dict):
            continue
        service = e.get("service_name") or e.get("service") or "AWS"
        region = e.get("region_name") or ""
        log = e.get("event_log") or []
        last = log[-1] if log else {}
        summary = clean_text(e.get("summary") or last.get("summary") or service, 200)
        impact = "degraded" if "informational" in summary.lower() else "partial"
        name = f"{service} ({region})" if region else service
        affected[name] = worst(affected.get(name, "operational"), impact)
        started = iso_date(e.get("date") or e.get("start_time"))
        r["incidents"].append({
            "id": str(e.get("arn") or f"{e.get('service')}-{e.get('date')}"),
            "title": f"{name}: {summary}" if service not in summary else (f"{summary} ({region})" if region else summary),
            "impact": impact, "phase": "",
            "started": started,
            "updated": iso_date(last.get("timestamp")) or started,
            "message": clean_text(last.get("message")),
            "link": prov.get("web"),
            "place_texts": [region, str(e.get("region") or "")],
        })
    r["components"] = sorted(({"name": n, "status": s} for n, s in affected.items()),
                             key=lambda c: -RANK[c["status"]])[:MAX_COMPONENTS]
    r["status"] = final_status(r, "operational", r["components"])
    return r


# ---------------------------------------------------------------- Slack

SLACK_TYPE = {"outage": "major", "incident": "partial", "notice": "degraded", "maintenance": "maintenance"}


def parse_slack(data, prov):
    if not isinstance(data, dict) or "status" not in data:
        raise UnexpectedFormat("missing status")
    r = empty()
    affected = {}
    for i in data.get("active_incidents") or []:
        impact = SLACK_TYPE.get(i.get("type"), "degraded")
        services = [s for s in i.get("services") or [] if isinstance(s, str)]
        for s in services:
            affected[s] = worst(affected.get(s, "operational"), impact)
        notes = i.get("notes") or []
        r["incidents"].append({
            "id": str(i.get("id") or i.get("title")),
            "title": clean_text(i.get("title"), 200),
            "impact": impact,
            "phase": clean_text(i.get("status"), 40),
            "started": iso_date(i.get("date_created")),
            "updated": iso_date(i.get("date_updated")),
            "message": clean_text(notes[-1].get("body")) if notes and isinstance(notes[-1], dict) else "",
            "link": i.get("url") or prov.get("web"),
            "affects": services[:8],
        })
    r["components"] = sorted(({"name": n, "status": s} for n, s in affected.items()),
                             key=lambda c: -RANK[c["status"]])[:MAX_COMPONENTS]
    r["status"] = final_status(r, "operational", r["components"])
    return r


# ---------------------------------------------------------------- fetching


def url_for(prov):
    kind = prov["type"]
    if kind == "statuspage":
        return prov["url"].rstrip("/") + "/api/v2/summary.json"
    if kind == "statusio":
        return f"https://api.status.io/1.0/status/{prov['page']}"
    return prov["url"]


PARSERS = {
    "statuspage": (parse_statuspage, True),
    "statusio": (parse_statusio, True),
    "google": (parse_google, True),
    "azure": (parse_azure, False),
    "azure-devops": (parse_azure_devops, True),
    "aws": (parse_aws, True),
    "slack": (parse_slack, True),
}


def fetch(prov):
    """Returns (result, error). Never raises: one provider being down doesn't break the rest."""
    parse, is_json = PARSERS[prov["type"]]
    try:
        raw = download(url_for(prov))
        return parse(parse_json(raw) if is_json else raw, prov), None
    except UnexpectedFormat as e:
        return None, f"unexpected format: {e}"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - any network or data failure counts as the source being down
        return None, f"{type(e).__name__}: {e}"[:200]


# ---------------------------------------------------------------- migrating files from older versions
#
# Until November 2026 the data used Spanish names. These functions translate it, so the
# history and the incident log survive the switch.

LEGACY_LEVEL = {"operativo": "operational", "mantenimiento": "maintenance", "degradado": "degraded",
                "parcial": "partial", "grave": "major", "desconocido": "unknown", "aviso": "advisory"}
LEGACY_PHASE = {"Investigando": "Investigating", "Identificado": "Identified", "Vigilando": "Monitoring",
                "Resuelto": "Resolved", "Análisis posterior": "Postmortem", "Programado": "Scheduled",
                "En curso": "In progress", "Verificando": "Verifying", "Completado": "Completed"}
LEGACY_CATEGORY = {"nube": "cloud", "desarrollo": "dev", "red": "network", "colaboracion": "collab", "ia": "ai"}
LEGACY_FILES = {"status.json": "estado.json", "history.json": "historial.json", "incidents.json": "incidencias.json"}


def _level(value):
    return LEGACY_LEVEL.get(value, value)


def migrate_status(old):
    """estado.json → status.json (only what the next run needs: previous data and source health)."""
    def provider(p):
        src = p.get("fuente") or {}
        return {
            "id": p.get("id"), "name": p.get("nombre"), "category": LEGACY_CATEGORY.get(p.get("categoria"), p.get("categoria")),
            "web": p.get("web"), "status": _level(p.get("estado")), "description": p.get("resumen", ""),
            "components": [{"name": c.get("nombre"), "status": _level(c.get("estado"))} for c in p.get("componentes", [])],
            "total_components": p.get("total_componentes", 0), "affected": p.get("afectados", 0),
            "limited_scope": p.get("alcance_limitado", False),
            "incidents": [{"id": i.get("id"), "title": i.get("titulo"), "impact": _level(i.get("impacto")),
                           "phase": LEGACY_PHASE.get(i.get("fase"), i.get("fase", "")), "started": i.get("inicio"),
                           "updated": i.get("actualizado"), "message": i.get("mensaje", ""), "link": i.get("enlace"),
                           **({"affects": i["afecta"]} if i.get("afecta") else {})} for i in p.get("incidencias", [])],
            "maintenance": [{"id": m.get("id"), "title": m.get("titulo"), "phase": LEGACY_PHASE.get(m.get("fase"), m.get("fase", "")),
                             "in_progress": m.get("en_curso", False), "start": m.get("inicio"), "end": m.get("fin"),
                             "link": m.get("enlace")} for m in p.get("mantenimientos", [])],
            "places": [{"id": lu.get("id"), "en": lu.get("en"), "es": lu.get("es"), "lat": lu.get("lat"), "lon": lu.get("lon"),
                        **({"country": lu["pais"], "country_en": lu.get("pais_en"), "country_es": lu.get("pais_es")} if "pais" in lu else {}),
                        "level": _level(lu.get("nivel")), "n": lu.get("n", 1),
                        "examples": [{"t": x.get("t"), "level": _level(x.get("nivel"))} for x in lu.get("ejemplos", [])]}
                       for lu in p.get("lugares", [])],
            "unlocated": p.get("sin_ubicacion", 0),
            "source": {"checked": src.get("comprobado"), "ok": src.get("ok", False), "error": src.get("error"),
                       "failures_in_a_row": src.get("fallos_seguidos", 0), "last_ok": src.get("ultimo_ok")},
        }
    return {"updated": old.get("actualizado"),
            "categories": {LEGACY_CATEGORY.get(k, k): v for k, v in old.get("categorias", {}).items()},
            "providers": [provider(p) for p in old.get("proveedores", [])]}


def migrate_history(old):
    """historial.json → history.json: m, c, peor → samples, down, worst."""
    return {prov: {day: {"samples": v.get("m", 0), "down": v.get("c", 0), "worst": _level(v.get("peor", "operativo"))}
                   for day, v in days.items()}
            for prov, days in old.items()}


def migrate_incidents(old):
    """incidencias.json → incidents.json."""
    return {key: {"provider": r.get("proveedor"), "title": r.get("titulo"), "impact": _level(r.get("impacto")),
                  "started": r.get("inicio"), "seen": r.get("visto"), "ended": r.get("fin"), "link": r.get("enlace")}
            for key, r in old.items()}


MIGRATIONS = {"status.json": migrate_status, "history.json": migrate_history, "incidents.json": migrate_incidents}


# ---------------------------------------------------------------- persistence


def read(name, default):
    """Reads an output file; if it doesn't exist yet, migrates the one from older versions."""
    try:
        return json.loads((OUTPUT / name).read_text("utf-8"))
    except (OSError, ValueError):
        pass
    try:
        old = json.loads((OUTPUT / LEGACY_FILES[name]).read_text("utf-8"))
    except (KeyError, OSError, ValueError):
        return default
    print(f"Migrating {LEGACY_FILES[name]} to {name}")
    return MIGRATIONS[name](old)


def write(name, data):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT / (name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    tmp.replace(OUTPUT / name)


def remove_legacy_files():
    for old in LEGACY_FILES.values():
        (OUTPUT / old).unlink(missing_ok=True)


def merge(prov, result, error, previous):
    """Merges the new result with the previous one. If the source fails, its last good data is kept."""
    before = previous.get(prov["id"]) or {}
    source = dict(before.get("source") or {})
    now = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
    source["checked"] = now
    if result is not None:
        data = result
        source.update(ok=True, error=None, failures_in_a_row=0, last_ok=now)
    else:
        data = {k: before.get(k, v) for k, v in empty().items()}
        source.update(ok=False, error=error, failures_in_a_row=source.get("failures_in_a_row", 0) + 1)
        source.setdefault("last_ok", None)
        if not source.get("last_ok") or source["failures_in_a_row"] >= FAILURES_BEFORE_ALERT:
            data["status"] = "unknown"
    return {"id": prov["id"], "name": prov["name"], "category": prov["category"],
            "web": prov.get("web"), **data, "source": source}


def update_history(history, providers):
    """One summary per provider and day: samples, samples with an outage and worst level.

    Any sample in partial or major outage counts as down. Degraded and maintenance are
    drawn, but don't count against availability.
    """
    limit = (NOW - timedelta(days=HISTORY_DAYS - 1)).strftime("%Y-%m-%d")
    new = {}
    for p in providers:
        days = {d: v for d, v in (history.get(p["id"]) or {}).items() if d >= limit}
        if p["status"] != "unknown" and p["source"]["ok"]:
            today = days.setdefault(TODAY, {"samples": 0, "down": 0, "worst": "operational"})
            today["samples"] += 1
            today["down"] += 1 if RANK[p["status"]] >= RANK["partial"] else 0
            today["worst"] = worst(today["worst"], p["status"])
        new[p["id"]] = dict(sorted(days.items()))
    return new


def update_incidents(log, providers):
    """Log of the incidents seen: they open when they appear and close when they're gone."""
    now = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
    limit = (NOW - timedelta(days=INCIDENT_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    seen = set()
    for p in providers:
        if not p["source"]["ok"]:
            # Without fresh data there's no way to know whether they're still open: leave them be
            seen.update(k for k, v in log.items() if v["provider"] == p["id"] and not v.get("ended"))
            continue
        for i in p["incidents"]:
            key = f"{p['id']}:{i['id']}"
            seen.add(key)
            r = log.get(key)
            if r is None or r.get("ended"):
                r = log[key] = {"provider": p["id"], "title": i["title"], "impact": i["impact"],
                                "started": i.get("started") or now, "seen": now, "ended": None,
                                "link": i.get("link")}
            r["title"] = i["title"] or r["title"]
            # An advisory (security, no impact) stays an advisory even if it was logged differently before
            r["impact"] = "advisory" if i["impact"] == "advisory" else worst(r["impact"], i["impact"])
            r["seen"] = now
    for key, r in log.items():
        if key not in seen and not r.get("ended"):
            r["ended"] = r.get("seen") or now
    return {k: v for k, v in log.items() if not v.get("ended") or v["ended"] >= limit}


LOG_LEVEL = {"operational": "operational", "maintenance": "maintenance", "degraded": "degraded",
             "partial": "partial outage", "major": "major outage", "unknown": "no data"}


def main():
    config = json.loads((DATA / "providers.json").read_text("utf-8"))
    configured = config["providers"]
    previous = {p["id"]: p for p in read("status.json", {}).get("providers", [])}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch, configured))

    providers = [merge(p, res, err, previous) for p, (res, err) in zip(configured, results)]
    for p in providers:
        mark = "ok " if p["source"]["ok"] else "ERR"
        n = len(p["incidents"])
        print(f"[{mark}] {p['name']:<24} {LOG_LEVEL.get(p['status'], p['status']):<15} "
              f"{n} {'incident' if n == 1 else 'incidents'}  {p['source'].get('error') or ''}")

    failing = [p for p in providers if RANK.get(p["status"], -1) >= RANK["degraded"]]
    write("status.json", {
        "updated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "categories": config["categories"],
        "summary": {
            "total": len(providers),
            "failing": len(failing),
            "worst": worst(*(p["status"] for p in providers)),
            "no_data": sum(1 for p in providers if p["status"] == "unknown"),
        },
        "providers": providers,
    })
    write("history.json", update_history(read("history.json", {}), providers))
    write("incidents.json", update_incidents(read("incidents.json", {}), providers))
    remove_legacy_files()

    if all(not p["source"]["ok"] for p in providers):
        print("No source responded: the runner's network is probably down.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
