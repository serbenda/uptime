"""Pruebas del recolector con respuestas de ejemplo de cada formato.

Si un proveedor cambia de formato, estas pruebas no lo detectan (usan ejemplos fijos),
pero la Action sí: marca la fuente con "formato inesperado" y, si sigue así, abre un issue.
Lo que aseguran es que cada formato se traduce bien al formato común.
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest import mock

RAIZ = Path(__file__).resolve().parent.parent
TMP = tempfile.mkdtemp()
os.environ["UPTIME_SALIDA"] = TMP

spec = importlib.util.spec_from_file_location("actualizar", RAIZ / "scripts" / "actualizar.py")
act = importlib.util.module_from_spec(spec)
sys.modules["actualizar"] = act
spec.loader.exec_module(act)

AHORA = act.AHORA
ISO = AHORA.strftime("%Y-%m-%dT%H:%M:%S.000Z")
PROV = {"id": "x", "nombre": "X", "categoria": "desarrollo", "web": "https://status.x.com", "url": "https://status.x.com"}


def statuspage(indicador="none", componentes=(), incidencias=(), mantenimientos=()):
    return {
        "page": {"name": "X"},
        "status": {"indicator": indicador, "description": "All Systems Operational"},
        "components": list(componentes),
        "incidents": list(incidencias),
        "scheduled_maintenances": list(mantenimientos),
    }


class TestUtilidades(unittest.TestCase):
    def test_peor(self):
        self.assertEqual(act.peor("operativo", "parcial", "degradado"), "parcial")
        self.assertEqual(act.peor(), "operativo")
        self.assertEqual(act.peor("desconocido", "mantenimiento"), "mantenimiento")

    def test_fechas(self):
        self.assertEqual(act.fecha_iso("2026-11-02T10:00:00.123-07:00"), "2026-11-02T17:00:00Z")
        self.assertEqual(act.fecha_iso("Mon, 02 Nov 2026 10:00:00 GMT"), "2026-11-02T10:00:00Z")
        self.assertEqual(act.fecha_iso("1793613600"), "2026-11-02T10:00:00Z")
        self.assertEqual(act.fecha_iso(1793613600000), "2026-11-02T10:00:00Z")
        self.assertIsNone(act.fecha_iso("no es una fecha"))
        self.assertIsNone(act.fecha_iso(None))

    def test_texto_limpio(self):
        self.assertEqual(act.texto_limpio("<p>Hola &amp; <b>adiós</b></p>"), "Hola & adiós")
        self.assertTrue(act.texto_limpio("a" * 1000, 10).endswith("…"))

    def test_json_utf16(self):
        datos = json.dumps([{"a": 1}]).encode("utf-16")
        self.assertEqual(act.leer_json(datos), [{"a": 1}])
        self.assertEqual(act.leer_json(b'\xef\xbb\xbf{"a":1}'), {"a": 1})
        with self.assertRaises(act.FormatoInesperado):
            act.leer_json(b"<html>")


class TestStatuspage(unittest.TestCase):
    def test_todo_bien(self):
        r = act.procesar_statuspage(statuspage(componentes=[{"name": "API", "status": "operational"}]), PROV)
        self.assertEqual(r["estado"], "operativo")
        self.assertEqual(r["componentes"], [])
        self.assertEqual(r["total_componentes"], 1)

    def test_incidencia_y_componentes(self):
        datos = statuspage(
            indicador="minor",
            componentes=[
                {"name": "Grupo", "status": "major_outage", "group": True},
                {"name": "Actions", "status": "partial_outage"},
                {"name": "Pages", "status": "degraded_performance"},
                {"name": "Git", "status": "operational"},
            ],
            incidencias=[{
                "id": "abc", "name": "Actions con retrasos", "impact": "major", "status": "identified",
                "created_at": ISO, "updated_at": ISO, "shortlink": "https://stspg.io/abc",
                "incident_updates": [
                    {"body": "Investigando", "display_at": "2026-11-02T09:00:00Z"},
                    {"body": "Causa encontrada", "display_at": "2026-11-02T10:00:00Z"},
                ],
            }],
        )
        r = act.procesar_statuspage(datos, PROV)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual([c["nombre"] for c in r["componentes"]], ["Actions", "Pages"])
        self.assertEqual(r["total_componentes"], 3, "los grupos no cuentan")
        i = r["incidencias"][0]
        self.assertEqual((i["impacto"], i["fase"], i["mensaje"]), ("parcial", "Identificado", "Causa encontrada"))
        self.assertEqual(i["enlace"], "https://stspg.io/abc")

    def test_mantenimiento(self):
        datos = statuspage(mantenimientos=[
            {"id": "m1", "name": "Ventana", "status": "in_progress", "scheduled_for": ISO, "scheduled_until": ISO},
            {"id": "m2", "name": "Futura", "status": "scheduled", "scheduled_for": ISO},
            {"id": "m3", "name": "Hecha", "status": "completed"},
        ])
        r = act.procesar_statuspage(datos, PROV)
        self.assertEqual(r["estado"], "mantenimiento")
        self.assertEqual([m["id"] for m in r["mantenimientos"]], ["m1", "m2"])
        self.assertTrue(r["mantenimientos"][0]["en_curso"])

    def test_formato(self):
        with self.assertRaises(act.FormatoInesperado):
            act.procesar_statuspage({"page": {}}, PROV)


class TestStatusio(unittest.TestCase):
    def test_incidencia(self):
        datos = {"result": {
            "status_overall": {"status": "Partial Service Disruption", "status_code": 400},
            "status": [{"name": "Registry", "status_code": 400}, {"name": "Web", "status_code": 100}],
            "incidents": [{"_id": "i1", "name": "Pulls lentos", "datetime_open": ISO,
                           "messages": [{"details": "Mirando", "datetime": ISO, "state": "Investigating", "status": 300}]}],
            "maintenance": {"active": [], "upcoming": [{"_id": "m1", "name": "Migración", "datetime_planned_start": ISO}]},
        }}
        prov = dict(PROV, pagina="p1", web="https://status.gitlab.com")
        r = act.procesar_statusio(datos, prov)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["componentes"], [{"nombre": "Registry", "estado": "parcial"}])
        self.assertEqual(r["incidencias"][0]["enlace"], "https://status.gitlab.com/pages/incident/p1/i1")
        self.assertEqual(r["incidencias"][0]["impacto"], "degradado")
        self.assertFalse(r["mantenimientos"][0]["en_curso"])

    def test_formato(self):
        with self.assertRaises(act.FormatoInesperado):
            act.procesar_statusio({"error": "x"}, PROV)


class TestGoogle(unittest.TestCase):
    def test_solo_activas(self):
        datos = [
            {"id": "a", "begin": ISO, "end": None, "external_desc": "Cloud SQL errors", "status_impact": "SERVICE_OUTAGE",
             "affected_products": [{"title": "Cloud SQL"}], "most_recent_update": {"text": "**Mitigando**"},
             "uri": "incidents/a"},
            {"id": "b", "begin": ISO, "end": ISO, "external_desc": "Ya resuelta"},
        ]
        r = act.procesar_google(datos, dict(PROV, web="https://status.cloud.google.com/"))
        self.assertEqual(r["estado"], "grave")
        self.assertEqual(len(r["incidencias"]), 1)
        self.assertEqual(r["incidencias"][0]["enlace"], "https://status.cloud.google.com/incidents/a")
        self.assertEqual(r["componentes"], [{"nombre": "Cloud SQL", "estado": "grave"}])

    def test_vacio(self):
        self.assertEqual(act.procesar_google([], PROV)["estado"], "operativo")


class TestAzure(unittest.TestCase):
    RSS = b"""<?xml version="1.0"?><rss><channel><title>Azure</title>
      <item><title>Network - West Europe</title><description>&lt;p&gt;Investigating&lt;/p&gt;</description>
      <pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><link>https://azure.status.microsoft/x</link></item>
      </channel></rss>"""

    def test_incidencia(self):
        r = act.procesar_azure(self.RSS, PROV)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["incidencias"][0]["mensaje"], "Investigating")

    def test_sin_incidencias(self):
        r = act.procesar_azure(b"<rss><channel><title>Azure</title></channel></rss>", PROV)
        self.assertEqual(r["estado"], "operativo")

    def test_formato(self):
        with self.assertRaises(act.FormatoInesperado):
            act.procesar_azure(b"<html><body>error", PROV)


class TestAzureDevOps(unittest.TestCase):
    def test_degradado(self):
        datos = {"lastUpdated": ISO, "status": {"health": "degraded", "message": "Pipelines slow"},
                 "services": [{"id": "Pipelines", "geographies": [{"name": "Europe", "health": "degraded"},
                                                                  {"name": "US", "health": "healthy"}]},
                              {"id": "Boards", "geographies": [{"name": "Europe", "health": "healthy"}]}]}
        r = act.procesar_azure_devops(datos, PROV)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["componentes"], [{"nombre": "Pipelines (Europe)", "estado": "parcial"}])
        self.assertEqual(len(r["incidencias"]), 1)

    def test_sano(self):
        r = act.procesar_azure_devops({"status": {"health": "healthy", "message": "Everything is looking good"}}, PROV)
        self.assertEqual((r["estado"], r["incidencias"]), ("operativo", []))


class TestAws(unittest.TestCase):
    def test_eventos(self):
        datos = [{"arn": "e1", "service_name": "Amazon EC2", "region_name": "Europe (Ireland)", "date": "1793613600",
                  "summary": "Increased API error rates",
                  "event_log": [{"summary": "x", "message": "We are investigating", "timestamp": 1793613600}]}]
        r = act.procesar_aws(datos, PROV)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["componentes"][0]["nombre"], "Amazon EC2 (Europe (Ireland))")
        self.assertEqual(r["incidencias"][0]["mensaje"], "We are investigating")

    def test_vacio(self):
        self.assertEqual(act.procesar_aws([], PROV)["estado"], "operativo")


class TestSlack(unittest.TestCase):
    def test_incidencia(self):
        datos = {"status": "active", "active_incidents": [
            {"id": 1, "title": "Messages delayed", "type": "incident", "status": "active", "url": "https://s/1",
             "date_created": ISO, "date_updated": ISO, "services": ["Messaging"], "notes": [{"body": "Fixing"}]}]}
        r = act.procesar_slack(datos, PROV)
        self.assertEqual(r["estado"], "parcial")
        self.assertEqual(r["componentes"], [{"nombre": "Messaging", "estado": "parcial"}])

    def test_ok(self):
        self.assertEqual(act.procesar_slack({"status": "ok", "active_incidents": []}, PROV)["estado"], "operativo")


class TestConsulta(unittest.TestCase):
    def test_url(self):
        self.assertEqual(act.url_de({"tipo": "statuspage", "url": "https://a.com/"}), "https://a.com/api/v2/summary.json")
        self.assertEqual(act.url_de({"tipo": "statusio", "pagina": "p"}), "https://api.status.io/1.0/status/p")

    def test_error_no_rompe(self):
        prov = dict(PROV, tipo="statuspage")
        with mock.patch.object(act, "descargar", side_effect=TimeoutError("lento")):
            res, err = act.consultar(prov)
        self.assertIsNone(res)
        self.assertIn("TimeoutError", err)
        with mock.patch.object(act, "descargar", return_value=b'{"page": {}}'):
            res, err = act.consultar(prov)
        self.assertTrue(err.startswith("formato inesperado"))

    def test_todos_los_proveedores_tienen_formato_conocido(self):
        config = json.loads((RAIZ / "data" / "proveedores.json").read_text("utf-8"))
        ids = [p["id"] for p in config["proveedores"]]
        self.assertEqual(len(ids), len(set(ids)), "ids repetidos")
        for p in config["proveedores"]:
            self.assertIn(p["tipo"], act.PROCESADORES, p["id"])
            self.assertIn(p["categoria"], config["categorias"], p["id"])
            self.assertTrue(act.url_de(p).startswith("https://"), p["id"])


class TestPersistencia(unittest.TestCase):
    def test_combinar_conserva_datos_si_falla(self):
        bueno = act.combinar(PROV, dict(act.vacio(), estado="parcial"), None, {})
        self.assertTrue(bueno["fuente"]["ok"])
        malo = act.combinar(PROV, None, "HTTP 503", {"x": bueno})
        self.assertEqual((malo["estado"], malo["fuente"]["fallos_seguidos"]), ("parcial", 1))
        bueno["fuente"]["fallos_seguidos"] = act.FALLOS_PARA_AVISAR - 1
        self.assertEqual(act.combinar(PROV, None, "HTTP 503", {"x": bueno})["estado"], "desconocido")
        self.assertEqual(act.combinar(PROV, None, "HTTP 503", {})["estado"], "desconocido", "nunca hubo datos")

    def test_historial(self):
        viejo = (AHORA - timedelta(days=200)).strftime("%Y-%m-%d")
        p = act.combinar(PROV, dict(act.vacio(), estado="grave"), None, {})
        h = act.actualizar_historial({"x": {viejo: {"m": 1, "c": 0, "peor": "operativo"}}}, [p])
        self.assertNotIn(viejo, h["x"])
        self.assertEqual(h["x"][act.HOY], {"m": 1, "c": 1, "peor": "grave"})
        sin = act.combinar(PROV, None, "x", {})
        self.assertEqual(act.actualizar_historial({}, [sin])["x"], {}, "sin datos no cuenta")

    def test_incidencias_se_abren_y_cierran(self):
        inc = {"id": "1", "titulo": "Caída", "impacto": "grave", "inicio": ISO, "enlace": "u"}
        p = act.combinar(PROV, dict(act.vacio(), estado="grave", incidencias=[inc]), None, {})
        reg = act.actualizar_incidencias({}, [p])
        self.assertIsNone(reg["x:1"]["fin"])
        caido = act.combinar(PROV, None, "HTTP 500", {"x": p})
        self.assertIsNone(act.actualizar_incidencias(reg, [caido])["x:1"]["fin"], "si la fuente falla no se cierra")
        limpio = act.combinar(PROV, act.vacio(), None, {})
        self.assertIsNotNone(act.actualizar_incidencias(reg, [limpio])["x:1"]["fin"])


if __name__ == "__main__":
    unittest.main()
