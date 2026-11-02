#!/usr/bin/env python3
"""Lee las páginas de estado oficiales de los proveedores, las pasa a un formato
común y guarda el historial. Solo usa la biblioteca estándar de Python.

Cada proveedor publica su estado a su manera. Este script entiende siete formatos:
  statuspage    Atlassian Statuspage (/api/v2/summary.json): GitHub, Red Hat, Cloudflare…
  statusio      status.io (api.status.io): GitLab y Docker Hub
  google        incidents.json de Google Cloud y Google Workspace
  azure         RSS de incidencias activas de Azure
  azure-devops  API pública de salud de Azure DevOps
  aws           eventos públicos actuales del AWS Health Dashboard
  slack         API de estado de Slack

Lee de data/ (fijos, en main):
  proveedores.json   qué proveedores se consultan y con qué formato
Escribe en $UPTIME_SALIDA (por defecto data/; en la Action, la rama `datos`):
  estado.json        estado actual de cada proveedor (incidencias, componentes, mantenimientos)
  historial.json     resumen diario por proveedor (últimos 90 días) para las barras de disponibilidad
  incidencias.json   registro de incidencias de los últimos 30 días, con su duración
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

RAIZ = Path(__file__).resolve().parent.parent
FIJOS = RAIZ / "data"
SALIDA = Path(os.environ.get("UPTIME_SALIDA") or FIJOS)
AHORA = datetime.now(timezone.utc)
HOY = AHORA.strftime("%Y-%m-%d")

DIAS_HISTORIAL = 90
DIAS_INCIDENCIAS = 30
FALLOS_PARA_AVISAR = 18          # ejecuciones seguidas (3 h a 10 min cada una) antes de abrir un issue
MAX_COMPONENTES = 12             # componentes afectados que se guardan por proveedor
MAX_TEXTO = 600                  # caracteres del último mensaje de cada incidencia
TIEMPO_ESPERA = 20
REINTENTOS = 2
AGENTE = "uptime/1.0 (+https://github.com/serbenda/uptime)"

# De mejor a peor. "desconocido" queda fuera de la escala: no se sabe.
NIVELES = ["operativo", "mantenimiento", "degradado", "parcial", "grave"]
RANGO = {n: i for i, n in enumerate(NIVELES)}


class FormatoInesperado(Exception):
    """La fuente ha respondido, pero no con el formato que se espera."""


# ---------------------------------------------------------------- utilidades


def peor(*niveles):
    validos = [n for n in niveles if n in RANGO]
    return max(validos, key=RANGO.get) if validos else "operativo"


def texto_limpio(valor, limite=MAX_TEXTO):
    """Quita etiquetas HTML y espacios de sobra, y recorta."""
    if not valor:
        return ""
    t = re.sub(r"<br\s*/?>|</p>|</li>", "\n", str(valor), flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t).strip()
    return t if len(t) <= limite else t[: limite - 1].rstrip() + "…"


def fecha_iso(valor):
    """Convierte ISO 8601, RFC 822 o segundos desde 1970 a ISO en UTC ('…Z')."""
    if valor in (None, ""):
        return None
    try:
        if isinstance(valor, (int, float)) or re.fullmatch(r"\d{9,13}(\.\d+)?", str(valor)):
            n = float(valor)
            d = datetime.fromtimestamp(n / 1000 if n > 1e11 else n, timezone.utc)
        elif re.match(r"\d{4}-\d{2}-\d{2}", str(valor)):
            d = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        else:
            d = parsedate_to_datetime(str(valor))
    except (ValueError, TypeError, OverflowError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def a_fecha(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None


def descargar(url):
    error = None
    for intento in range(REINTENTOS + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=TIEMPO_ESPERA) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            error = e
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                break
            time.sleep(2 * (intento + 1))
    raise error


def leer_json(datos):
    """JSON en UTF-8 o UTF-16 (AWS lo sirve en UTF-16 con BOM)."""
    if datos[:2] in (b"\xff\xfe", b"\xfe\xff"):
        texto = datos.decode("utf-16")
    else:
        texto = datos.decode("utf-8-sig")
    try:
        return json.loads(texto)
    except ValueError as e:
        raise FormatoInesperado(f"no es JSON: {e}") from e


def vacio():
    return {"estado": "operativo", "resumen": "", "componentes": [], "total_componentes": 0,
            "incidencias": [], "mantenimientos": []}


# ---------------------------------------------------------------- Statuspage

SP_COMPONENTE = {"operational": "operativo", "degraded_performance": "degradado", "partial_outage": "parcial",
                 "major_outage": "grave", "under_maintenance": "mantenimiento"}
SP_IMPACTO = {"none": "degradado", "minor": "degradado", "major": "parcial", "critical": "grave",
              "maintenance": "mantenimiento"}
SP_INDICADOR = {"none": "operativo", "minor": "degradado", "major": "parcial", "critical": "grave",
                "maintenance": "mantenimiento"}
SP_ESTADO = {"investigating": "Investigando", "identified": "Identificado", "monitoring": "Vigilando",
             "resolved": "Resuelto", "postmortem": "Análisis posterior", "scheduled": "Programado",
             "in_progress": "En curso", "verifying": "Verificando", "completed": "Completado"}


def ultimo_mensaje(actualizaciones, campo="body"):
    if not actualizaciones:
        return ""
    ordenadas = sorted(actualizaciones, key=lambda u: str(u.get("display_at") or u.get("created_at") or ""))
    return texto_limpio(ordenadas[-1].get(campo))


def procesar_statuspage(datos, prov):
    if not isinstance(datos, dict) or "status" not in datos or "components" not in datos:
        raise FormatoInesperado("falta status o components")
    r = vacio()
    web = prov.get("web") or prov["url"]
    componentes = [c for c in datos.get("components") or [] if not c.get("group")]
    r["total_componentes"] = len(componentes)
    afectados = []
    for c in componentes:
        nivel = SP_COMPONENTE.get(c.get("status"), "operativo")
        if nivel != "operativo":
            afectados.append({"nombre": c.get("name") or "?", "estado": nivel})
    afectados.sort(key=lambda c: -RANGO[c["estado"]])
    r["componentes"] = afectados[:MAX_COMPONENTES]

    for i in datos.get("incidents") or []:
        if i.get("status") in ("resolved", "postmortem"):
            continue
        r["incidencias"].append({
            "id": str(i.get("id") or i.get("name")),
            "titulo": texto_limpio(i.get("name"), 200),
            "impacto": SP_IMPACTO.get(i.get("impact"), "degradado"),
            "fase": SP_ESTADO.get(i.get("status"), i.get("status") or ""),
            "inicio": fecha_iso(i.get("started_at") or i.get("created_at")),
            "actualizado": fecha_iso(i.get("updated_at")),
            "mensaje": ultimo_mensaje(i.get("incident_updates")),
            "enlace": i.get("shortlink") or f"{web.rstrip('/')}/incidents/{i.get('id')}",
        })

    en_curso = False
    for m in datos.get("scheduled_maintenances") or []:
        if m.get("status") == "completed":
            continue
        activo = m.get("status") in ("in_progress", "verifying")
        en_curso = en_curso or activo
        r["mantenimientos"].append({
            "id": str(m.get("id") or m.get("name")),
            "titulo": texto_limpio(m.get("name"), 200),
            "fase": SP_ESTADO.get(m.get("status"), m.get("status") or ""),
            "en_curso": activo,
            "inicio": fecha_iso(m.get("scheduled_for")),
            "fin": fecha_iso(m.get("scheduled_until")),
            "enlace": m.get("shortlink") or f"{web.rstrip('/')}/incidents/{m.get('id')}",
        })

    st = datos.get("status") or {}
    r["resumen"] = texto_limpio(st.get("description"), 200)
    r["estado"] = peor(SP_INDICADOR.get(st.get("indicator"), "operativo"),
                       *(c["estado"] for c in afectados),
                       *(i["impacto"] for i in r["incidencias"]),
                       "mantenimiento" if en_curso else "operativo")
    return r


# ---------------------------------------------------------------- status.io

SIO_CODIGO = {100: "operativo", 200: "mantenimiento", 300: "degradado", 400: "parcial", 500: "grave", 600: "grave"}


def sio_nivel(codigo):
    try:
        return SIO_CODIGO.get(int(codigo), "operativo")
    except (TypeError, ValueError):
        return "operativo"


def procesar_statusio(datos, prov):
    res = datos.get("result") if isinstance(datos, dict) else None
    if not isinstance(res, dict) or "status_overall" not in res:
        raise FormatoInesperado("falta result.status_overall")
    r = vacio()
    pagina, web = prov["pagina"], prov.get("web", "")
    componentes = res.get("status") or []
    r["total_componentes"] = len(componentes)
    afectados = []
    for c in componentes:
        nivel = sio_nivel(c.get("status_code"))
        if nivel != "operativo":
            afectados.append({"nombre": c.get("name") or "?", "estado": nivel})
    afectados.sort(key=lambda c: -RANGO[c["estado"]])
    r["componentes"] = afectados[:MAX_COMPONENTES]

    for i in res.get("incidents") or []:
        mensajes = sorted(i.get("messages") or [], key=lambda m: str(m.get("datetime") or ""))
        ultimo = mensajes[-1] if mensajes else {}
        r["incidencias"].append({
            "id": str(i.get("_id") or i.get("name")),
            "titulo": texto_limpio(i.get("name"), 200),
            "impacto": peor(sio_nivel(ultimo.get("status")), "degradado"),
            "fase": texto_limpio(ultimo.get("state"), 40) if isinstance(ultimo.get("state"), str) else "",
            "inicio": fecha_iso(i.get("datetime_open")),
            "actualizado": fecha_iso(ultimo.get("datetime") or i.get("datetime_open")),
            "mensaje": texto_limpio(ultimo.get("details")),
            "enlace": f"{web.rstrip('/')}/pages/incident/{pagina}/{i.get('_id')}" if i.get("_id") else web,
        })

    mant = res.get("maintenance") or {}
    for clave, activo in (("active", True), ("upcoming", False)):
        for m in mant.get(clave) or []:
            r["mantenimientos"].append({
                "id": str(m.get("_id") or m.get("name")),
                "titulo": texto_limpio(m.get("name"), 200),
                "fase": "En curso" if activo else "Programado",
                "en_curso": activo,
                "inicio": fecha_iso(m.get("datetime_planned_start")),
                "fin": fecha_iso(m.get("datetime_planned_end")),
                "enlace": f"{web.rstrip('/')}/pages/maintenance/{pagina}/{m.get('_id')}" if m.get("_id") else web,
            })

    general = res["status_overall"] or {}
    r["resumen"] = texto_limpio(general.get("status"), 200)
    r["estado"] = peor(sio_nivel(general.get("status_code")), *(c["estado"] for c in afectados),
                       *(i["impacto"] for i in r["incidencias"]),
                       "mantenimiento" if mant.get("active") else "operativo")
    return r


# ---------------------------------------------------------------- Google Cloud y Workspace

GOOGLE_IMPACTO = {"SERVICE_INFORMATION": "degradado", "SERVICE_DISRUPTION": "parcial", "SERVICE_OUTAGE": "grave"}


def procesar_google(datos, prov):
    if not isinstance(datos, list):
        raise FormatoInesperado("se esperaba una lista de incidencias")
    r = vacio()
    base = prov.get("web", "").rstrip("/") + "/"
    afectados = {}
    for i in datos:
        if i.get("end"):
            continue
        inicio = fecha_iso(i.get("begin"))
        if inicio and a_fecha(inicio) > AHORA + timedelta(hours=1):
            continue
        impacto = GOOGLE_IMPACTO.get(i.get("status_impact"), "degradado")
        productos = [p.get("title") for p in i.get("affected_products") or [] if p.get("title")]
        for p in productos:
            afectados[p] = peor(afectados.get(p, "operativo"), impacto)
        reciente = i.get("most_recent_update") or {}
        uri = i.get("uri") or ""
        r["incidencias"].append({
            "id": str(i.get("id") or i.get("number") or i.get("external_desc")),
            "titulo": texto_limpio(i.get("external_desc"), 200),
            "impacto": impacto,
            "fase": "",
            "inicio": inicio,
            "actualizado": fecha_iso(i.get("modified") or reciente.get("modified")),
            "mensaje": texto_limpio(reciente.get("text")),
            "enlace": uri if uri.startswith("http") else base + uri.lstrip("/"),
            "afecta": productos[:8],
        })
    r["componentes"] = sorted(({"nombre": n, "estado": e} for n, e in afectados.items()),
                              key=lambda c: -RANGO[c["estado"]])[:MAX_COMPONENTES]
    r["estado"] = peor(*(i["impacto"] for i in r["incidencias"]))
    r["resumen"] = "Sin incidencias activas" if not r["incidencias"] else ""
    return r


# ---------------------------------------------------------------- Azure (RSS)


def procesar_azure(datos, prov):
    try:
        raiz = ET.fromstring(datos)
    except ET.ParseError as e:
        raise FormatoInesperado(f"RSS no válido: {e}") from e
    canal = raiz.find("channel")
    if canal is None:
        raise FormatoInesperado("RSS sin channel")
    r = vacio()
    for item in canal.findall("item"):
        titulo = texto_limpio(item.findtext("title"), 200)
        fecha = fecha_iso(item.findtext("pubDate"))
        r["incidencias"].append({
            "id": item.findtext("guid") or item.findtext("link") or titulo,
            "titulo": titulo,
            "impacto": "parcial",
            "fase": "",
            "inicio": fecha,
            "actualizado": fecha,
            "mensaje": texto_limpio(item.findtext("description")),
            "enlace": item.findtext("link") or prov.get("web"),
        })
    r["estado"] = peor(*(i["impacto"] for i in r["incidencias"]))
    r["resumen"] = "Sin incidencias activas" if not r["incidencias"] else ""
    return r


# ---------------------------------------------------------------- Azure DevOps

ADO_SALUD = {"healthy": "operativo", "advisory": "degradado", "degraded": "parcial", "unhealthy": "grave"}


def procesar_azure_devops(datos, prov):
    st = datos.get("status") if isinstance(datos, dict) else None
    if not isinstance(st, dict) or "health" not in st:
        raise FormatoInesperado("falta status.health")
    r = vacio()
    servicios = datos.get("services") or []
    r["total_componentes"] = len(servicios)
    afectados = []
    for s in servicios:
        malas = [(g.get("name") or g.get("id"), ADO_SALUD.get(g.get("health"), "operativo"))
                 for g in s.get("geographies") or []]
        malas = [(n, e) for n, e in malas if e != "operativo"]
        if malas:
            nivel = peor(*(e for _, e in malas))
            zonas = ", ".join(n for n, _ in malas[:4])
            afectados.append({"nombre": f"{s.get('id')} ({zonas})", "estado": nivel})
    afectados.sort(key=lambda c: -RANGO[c["estado"]])
    r["componentes"] = afectados[:MAX_COMPONENTES]
    nivel = ADO_SALUD.get(st.get("health"), "operativo")
    r["resumen"] = texto_limpio(st.get("message"), 200)
    if nivel != "operativo":
        r["incidencias"].append({
            "id": "ado-" + (fecha_iso(datos.get("lastUpdated")) or HOY)[:10],
            "titulo": r["resumen"] or "Incidencia en Azure DevOps",
            "impacto": nivel, "fase": "", "inicio": None,
            "actualizado": fecha_iso(datos.get("lastUpdated")),
            "mensaje": "", "enlace": prov.get("web"),
        })
    r["estado"] = peor(nivel, *(c["estado"] for c in afectados))
    return r


# ---------------------------------------------------------------- AWS


def procesar_aws(datos, prov):
    if isinstance(datos, dict):
        datos = datos.get("current") or datos.get("events") or []
    if not isinstance(datos, list):
        raise FormatoInesperado("se esperaba una lista de eventos")
    r = vacio()
    afectados = {}
    for e in datos:
        if not isinstance(e, dict):
            continue
        servicio = e.get("service_name") or e.get("service") or "AWS"
        region = e.get("region_name") or ""
        registro = e.get("event_log") or []
        ultimo = registro[-1] if registro else {}
        titulo = texto_limpio(e.get("summary") or ultimo.get("summary") or servicio, 200)
        impacto = "degradado" if "informational" in titulo.lower() else "parcial"
        nombre = f"{servicio} ({region})" if region else servicio
        afectados[nombre] = peor(afectados.get(nombre, "operativo"), impacto)
        inicio = fecha_iso(e.get("date") or e.get("start_time"))
        r["incidencias"].append({
            "id": str(e.get("arn") or f"{e.get('service')}-{e.get('date')}"),
            "titulo": f"{servicio}: {titulo}" if servicio not in titulo else titulo,
            "impacto": impacto, "fase": "",
            "inicio": inicio,
            "actualizado": fecha_iso(ultimo.get("timestamp")) or inicio,
            "mensaje": texto_limpio(ultimo.get("message")),
            "enlace": prov.get("web"),
        })
    r["componentes"] = sorted(({"nombre": n, "estado": e} for n, e in afectados.items()),
                              key=lambda c: -RANGO[c["estado"]])[:MAX_COMPONENTES]
    r["estado"] = peor(*(i["impacto"] for i in r["incidencias"]))
    r["resumen"] = "Sin incidencias activas" if not r["incidencias"] else ""
    return r


# ---------------------------------------------------------------- Slack

SLACK_TIPO = {"outage": "grave", "incident": "parcial", "notice": "degradado", "maintenance": "mantenimiento"}


def procesar_slack(datos, prov):
    if not isinstance(datos, dict) or "status" not in datos:
        raise FormatoInesperado("falta status")
    r = vacio()
    afectados = {}
    for i in datos.get("active_incidents") or []:
        impacto = SLACK_TIPO.get(i.get("type"), "degradado")
        servicios = [s for s in i.get("services") or [] if isinstance(s, str)]
        for s in servicios:
            afectados[s] = peor(afectados.get(s, "operativo"), impacto)
        notas = i.get("notes") or []
        r["incidencias"].append({
            "id": str(i.get("id") or i.get("title")),
            "titulo": texto_limpio(i.get("title"), 200),
            "impacto": impacto,
            "fase": texto_limpio(i.get("status"), 40),
            "inicio": fecha_iso(i.get("date_created")),
            "actualizado": fecha_iso(i.get("date_updated")),
            "mensaje": texto_limpio(notas[-1].get("body")) if notas and isinstance(notas[-1], dict) else "",
            "enlace": i.get("url") or prov.get("web"),
            "afecta": servicios[:8],
        })
    r["componentes"] = sorted(({"nombre": n, "estado": e} for n, e in afectados.items()),
                              key=lambda c: -RANGO[c["estado"]])[:MAX_COMPONENTES]
    r["estado"] = peor(*(i["impacto"] for i in r["incidencias"]))
    r["resumen"] = "Sin incidencias activas" if not r["incidencias"] else ""
    return r


# ---------------------------------------------------------------- consulta


def url_de(prov):
    tipo = prov["tipo"]
    if tipo == "statuspage":
        return prov["url"].rstrip("/") + "/api/v2/summary.json"
    if tipo == "statusio":
        return f"https://api.status.io/1.0/status/{prov['pagina']}"
    return prov["url"]


PROCESADORES = {
    "statuspage": (procesar_statuspage, True),
    "statusio": (procesar_statusio, True),
    "google": (procesar_google, True),
    "azure": (procesar_azure, False),
    "azure-devops": (procesar_azure_devops, True),
    "aws": (procesar_aws, True),
    "slack": (procesar_slack, True),
}


def consultar(prov):
    """Devuelve (resultado, error). Nunca lanza: un proveedor caído no rompe al resto."""
    procesar, es_json = PROCESADORES[prov["tipo"]]
    try:
        bruto = descargar(url_de(prov))
        return procesar(leer_json(bruto) if es_json else bruto, prov), None
    except FormatoInesperado as e:
        return None, f"formato inesperado: {e}"
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - cualquier fallo de red o de datos cuenta como caída de la fuente
        return None, f"{type(e).__name__}: {e}"[:200]


# ---------------------------------------------------------------- persistencia


def leer(nombre, defecto):
    try:
        return json.loads((SALIDA / nombre).read_text("utf-8"))
    except (OSError, ValueError):
        return defecto


def escribir(nombre, datos):
    SALIDA.mkdir(parents=True, exist_ok=True)
    tmp = SALIDA / (nombre + ".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), "utf-8")
    tmp.replace(SALIDA / nombre)


def combinar(prov, resultado, error, anterior):
    """Junta el resultado nuevo con lo anterior. Si la fuente falla, se conservan sus últimos datos buenos."""
    previo = anterior.get(prov["id"]) or {}
    fuente = dict(previo.get("fuente") or {})
    ahora = AHORA.strftime("%Y-%m-%dT%H:%M:%SZ")
    fuente["comprobado"] = ahora
    if resultado is not None:
        datos = resultado
        fuente.update(ok=True, error=None, fallos_seguidos=0, ultimo_ok=ahora)
    else:
        datos = {k: previo.get(k, v) for k, v in vacio().items()}
        fuente.update(ok=False, error=error, fallos_seguidos=fuente.get("fallos_seguidos", 0) + 1)
        fuente.setdefault("ultimo_ok", None)
        if not fuente.get("ultimo_ok") or fuente["fallos_seguidos"] >= FALLOS_PARA_AVISAR:
            datos["estado"] = "desconocido"
    return {"id": prov["id"], "nombre": prov["nombre"], "categoria": prov["categoria"],
            "web": prov.get("web"), **datos, "fuente": fuente}


def actualizar_historial(historial, proveedores):
    """Un resumen por proveedor y día: muestras, muestras con caída y peor nivel.

    Se cuenta como caída (sin servicio) cualquier muestra en estado parcial o grave.
    Degradado y mantenimiento se pintan, pero no restan disponibilidad.
    """
    limite = (AHORA - timedelta(days=DIAS_HISTORIAL - 1)).strftime("%Y-%m-%d")
    nuevo = {}
    for p in proveedores:
        dias = {d: v for d, v in (historial.get(p["id"]) or {}).items() if d >= limite}
        if p["estado"] != "desconocido" and p["fuente"]["ok"]:
            hoy = dias.setdefault(HOY, {"m": 0, "c": 0, "peor": "operativo"})
            hoy["m"] += 1
            hoy["c"] += 1 if RANGO[p["estado"]] >= RANGO["parcial"] else 0
            hoy["peor"] = peor(hoy["peor"], p["estado"])
        nuevo[p["id"]] = dict(sorted(dias.items()))
    return nuevo


def actualizar_incidencias(registro, proveedores):
    """Registro de incidencias vistas: se abren al aparecer y se cierran cuando dejan de aparecer."""
    ahora = AHORA.strftime("%Y-%m-%dT%H:%M:%SZ")
    limite = (AHORA - timedelta(days=DIAS_INCIDENCIAS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    vistos = set()
    for p in proveedores:
        if not p["fuente"]["ok"]:
            # Sin datos frescos no se sabe si siguen abiertas: no se tocan
            vistos.update(k for k, v in registro.items() if v["proveedor"] == p["id"] and not v.get("fin"))
            continue
        for i in p["incidencias"]:
            clave = f"{p['id']}:{i['id']}"
            vistos.add(clave)
            r = registro.get(clave)
            if r is None or r.get("fin"):
                r = registro[clave] = {"proveedor": p["id"], "titulo": i["titulo"], "impacto": i["impacto"],
                                       "inicio": i.get("inicio") or ahora, "visto": ahora, "fin": None,
                                       "enlace": i.get("enlace")}
            r["titulo"] = i["titulo"] or r["titulo"]
            r["impacto"] = peor(r["impacto"], i["impacto"])
            r["visto"] = ahora
    for clave, r in registro.items():
        if clave not in vistos and not r.get("fin"):
            r["fin"] = r.get("visto") or ahora
    return {k: v for k, v in registro.items() if not v.get("fin") or v["fin"] >= limite}


def main():
    config = json.loads((FIJOS / "proveedores.json").read_text("utf-8"))
    lista = config["proveedores"]
    anterior = {p["id"]: p for p in leer("estado.json", {}).get("proveedores", [])}

    with ThreadPoolExecutor(max_workers=8) as pool:
        resultados = list(pool.map(consultar, lista))

    proveedores = [combinar(p, res, err, anterior) for p, (res, err) in zip(lista, resultados)]
    for p in proveedores:
        marca = "ok " if p["fuente"]["ok"] else "ERR"
        print(f"[{marca}] {p['nombre']:<24} {p['estado']:<13} "
              f"{len(p['incidencias'])} incidencias  {p['fuente'].get('error') or ''}")

    con_problemas = [p for p in proveedores if RANGO.get(p["estado"], -1) >= RANGO["degradado"]]
    escribir("estado.json", {
        "actualizado": AHORA.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "categorias": config["categorias"],
        "resumen": {
            "total": len(proveedores),
            "con_problemas": len(con_problemas),
            "peor": peor(*(p["estado"] for p in proveedores)),
            "sin_datos": sum(1 for p in proveedores if p["estado"] == "desconocido"),
        },
        "proveedores": proveedores,
    })
    escribir("historial.json", actualizar_historial(leer("historial.json", {}), proveedores))
    escribir("incidencias.json", actualizar_incidencias(leer("incidencias.json", {}), proveedores))

    if all(not p["fuente"]["ok"] for p in proveedores):
        print("Ninguna fuente ha respondido: probablemente falla la red del runner.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
