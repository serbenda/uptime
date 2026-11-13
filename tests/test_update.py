"""Tests for the collector, using sample responses for each format.

If a provider changes its format, these tests won't notice (they use fixed samples), but the
Action will: it flags the source as "unexpected format" and, if it persists, opens an issue.
What they guarantee is that every format is translated correctly into the common one.
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

ROOT = Path(__file__).resolve().parent.parent
TMP = tempfile.mkdtemp()
os.environ["UPTIME_OUTPUT"] = TMP

spec = importlib.util.spec_from_file_location("update", ROOT / "scripts" / "update.py")
up = importlib.util.module_from_spec(spec)
sys.modules["update"] = up
spec.loader.exec_module(up)

NOW = up.NOW
ISO = NOW.strftime("%Y-%m-%dT%H:%M:%S.000Z")
PROV = {"id": "x", "name": "X", "category": "dev", "web": "https://status.x.com", "url": "https://status.x.com"}


def statuspage(indicator="none", components=(), incidents=(), maintenance=()):
    return {
        "page": {"name": "X"},
        "status": {"indicator": indicator, "description": "All Systems Operational"},
        "components": list(components),
        "incidents": list(incidents),
        "scheduled_maintenances": list(maintenance),
    }


class TestHelpers(unittest.TestCase):
    def test_worst(self):
        self.assertEqual(up.worst("operational", "partial", "degraded"), "partial")
        self.assertEqual(up.worst(), "operational")
        self.assertEqual(up.worst("unknown", "maintenance"), "maintenance")

    def test_dates(self):
        self.assertEqual(up.iso_date("2026-11-02T10:00:00.123-07:00"), "2026-11-02T17:00:00Z")
        self.assertEqual(up.iso_date("Mon, 02 Nov 2026 10:00:00 GMT"), "2026-11-02T10:00:00Z")
        self.assertEqual(up.iso_date("1793613600"), "2026-11-02T10:00:00Z")
        self.assertEqual(up.iso_date(1793613600000), "2026-11-02T10:00:00Z")
        self.assertIsNone(up.iso_date("not a date"))
        self.assertIsNone(up.iso_date(None))

    def test_clean_text(self):
        self.assertEqual(up.clean_text("<p>Hello &amp; <b>goodbye</b></p>"), "Hello & goodbye")
        self.assertTrue(up.clean_text("a" * 1000, 10).endswith("…"))

    def test_utf16_json(self):
        raw = json.dumps([{"a": 1}]).encode("utf-16")
        self.assertEqual(up.parse_json(raw), [{"a": 1}])
        self.assertEqual(up.parse_json(b'\xef\xbb\xbf{"a":1}'), {"a": 1})
        with self.assertRaises(up.UnexpectedFormat):
            up.parse_json(b"<html>")


class TestStatuspage(unittest.TestCase):
    def test_all_clear(self):
        r = up.parse_statuspage(statuspage(components=[{"name": "API", "status": "operational"}]), PROV)
        self.assertEqual(r["status"], "operational")
        self.assertEqual(r["components"], [])
        self.assertEqual(r["total_components"], 1)

    def test_incident_and_components(self):
        data = statuspage(
            indicator="minor",
            components=[
                {"name": "Group", "status": "major_outage", "group": True},
                {"name": "Actions", "status": "partial_outage"},
                {"name": "Pages", "status": "degraded_performance"},
                {"name": "Git", "status": "operational"},
            ],
            incidents=[{
                "id": "abc", "name": "Actions delayed", "impact": "major", "status": "identified",
                "created_at": ISO, "updated_at": ISO, "shortlink": "https://stspg.io/abc",
                "incident_updates": [
                    {"body": "Investigating", "display_at": "2026-11-02T09:00:00Z"},
                    {"body": "Cause found", "display_at": "2026-11-02T10:00:00Z"},
                ],
            }],
        )
        r = up.parse_statuspage(data, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual([c["name"] for c in r["components"]], ["Actions", "Pages"])
        self.assertEqual(r["total_components"], 3, "groups don't count")
        i = r["incidents"][0]
        self.assertEqual((i["impact"], i["phase"], i["message"]), ("partial", "Identified", "Cause found"))
        self.assertEqual(i["link"], "https://stspg.io/abc")

    def test_maintenance(self):
        data = statuspage(maintenance=[
            {"id": "m1", "name": "Window", "status": "in_progress", "scheduled_for": ISO, "scheduled_until": ISO},
            {"id": "m2", "name": "Upcoming", "status": "scheduled", "scheduled_for": ISO},
            {"id": "m3", "name": "Done", "status": "completed"},
        ])
        r = up.parse_statuspage(data, PROV)
        self.assertEqual(r["status"], "maintenance")
        self.assertEqual([m["id"] for m in r["maintenance"]], ["m1", "m2"])
        self.assertTrue(r["maintenance"][0]["in_progress"])

    def test_broken_format(self):
        with self.assertRaises(up.UnexpectedFormat):
            up.parse_statuspage({"page": {}}, PROV)

    def test_limited_scope(self):
        # 3 data centres down out of 100: not a global outage
        comps = [{"name": f"PoP {n}", "status": "major_outage" if n < 3 else "operational"} for n in range(100)]
        r = up.parse_statuspage(statuspage(indicator="major", components=comps), PROV)
        self.assertEqual(r["status"], "degraded")
        self.assertTrue(r["limited_scope"])
        self.assertEqual(r["affected"], 3)
        # with a serious incident, it counts in full
        inc = [{"id": "i", "name": "Outage", "impact": "major", "status": "investigating"}]
        r = up.parse_statuspage(statuspage(indicator="major", components=comps, incidents=inc), PROV)
        self.assertEqual(r["status"], "major")
        # few components: no cap
        r = up.parse_statuspage(statuspage(components=[{"name": "API", "status": "major_outage"}]), PROV)
        self.assertEqual(r["status"], "major")

    def test_advisory_doesnt_change_the_status(self):
        inc = [{"id": "cve", "name": "Customer Security Advisory: CVE-1", "impact": "none", "status": "investigating"}]
        r = up.parse_statuspage(statuspage(incidents=inc), PROV)
        self.assertEqual((r["status"], r["incidents"][0]["impact"]), ("operational", "advisory"))
        inc = [{"id": "cve", "name": "Customer Security Advisory: CVE-2026-98432", "impact": "minor", "status": "investigating"}]
        r = up.parse_statuspage(statuspage(incidents=inc), PROV)
        self.assertEqual((r["status"], r["incidents"][0]["impact"]), ("operational", "advisory"), "by its title")


class TestStatusio(unittest.TestCase):
    def test_incident(self):
        data = {"result": {
            "status_overall": {"status": "Partial Service Disruption", "status_code": 400},
            "status": [{"name": "Registry", "status_code": 400}, {"name": "Web", "status_code": 100}],
            "incidents": [{"_id": "i1", "name": "Slow pulls", "datetime_open": ISO,
                           "messages": [{"details": "Looking into it", "datetime": ISO, "state": "Investigating", "status": 300}]}],
            "maintenance": {"active": [], "upcoming": [{"_id": "m1", "name": "Migration", "datetime_planned_start": ISO}]},
        }}
        prov = dict(PROV, page="p1", web="https://status.gitlab.com")
        r = up.parse_statusio(data, prov)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["components"], [{"name": "Registry", "status": "partial"}])
        self.assertEqual(r["incidents"][0]["link"], "https://status.gitlab.com/pages/incident/p1/i1")
        self.assertEqual(r["incidents"][0]["impact"], "degraded")
        self.assertFalse(r["maintenance"][0]["in_progress"])

    def test_broken_format(self):
        with self.assertRaises(up.UnexpectedFormat):
            up.parse_statusio({"error": "x"}, PROV)


class TestGoogle(unittest.TestCase):
    def test_only_active(self):
        data = [
            {"id": "a", "begin": ISO, "end": None, "external_desc": "Cloud SQL errors", "status_impact": "SERVICE_OUTAGE",
             "affected_products": [{"title": "Cloud SQL"}], "most_recent_update": {"text": "**Mitigating**"},
             "uri": "incidents/a"},
            {"id": "b", "begin": ISO, "end": ISO, "external_desc": "Already resolved"},
        ]
        r = up.parse_google(data, dict(PROV, web="https://status.cloud.google.com/"))
        self.assertEqual(r["status"], "major")
        self.assertEqual(len(r["incidents"]), 1)
        self.assertEqual(r["incidents"][0]["link"], "https://status.cloud.google.com/incidents/a")
        self.assertEqual(r["components"], [{"name": "Cloud SQL", "status": "major"}])

    def test_empty(self):
        self.assertEqual(up.parse_google([], PROV)["status"], "operational")


class TestAzure(unittest.TestCase):
    RSS = b"""<?xml version="1.0"?><rss><channel><title>Azure</title>
      <item><title>Network - West Europe</title><description>&lt;p&gt;Investigating&lt;/p&gt;</description>
      <pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><link>https://azure.status.microsoft/x</link></item>
      </channel></rss>"""

    def test_incident(self):
        r = up.parse_azure(self.RSS, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["incidents"][0]["message"], "Investigating")

    def test_no_incidents(self):
        r = up.parse_azure(b"<rss><channel><title>Azure</title></channel></rss>", PROV)
        self.assertEqual(r["status"], "operational")

    def test_broken_format(self):
        with self.assertRaises(up.UnexpectedFormat):
            up.parse_azure(b"<html><body>error", PROV)


class TestAzureDevOps(unittest.TestCase):
    def test_degraded(self):
        data = {"lastUpdated": ISO, "status": {"health": "degraded", "message": "Pipelines slow"},
                "services": [{"id": "Pipelines", "geographies": [{"name": "Europe", "health": "degraded"},
                                                                 {"name": "US", "health": "healthy"}]},
                             {"id": "Boards", "geographies": [{"name": "Europe", "health": "healthy"}]}]}
        r = up.parse_azure_devops(data, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["components"], [{"name": "Pipelines (Europe)", "status": "partial"}])
        self.assertEqual(len(r["incidents"]), 1)

    def test_maintenance(self):
        data = {"status": {"health": "advisory", "message": "Service maintenance is in effect"},
                "services": [{"id": "Core", "geographies": [{"name": "Australia", "health": "advisory"}]}]}
        r = up.parse_azure_devops(data, PROV)
        self.assertEqual((r["status"], r["incidents"]), ("maintenance", []))
        self.assertEqual(r["components"][0]["status"], "maintenance")

    def test_healthy(self):
        r = up.parse_azure_devops({"status": {"health": "healthy", "message": "Everything is looking good"}}, PROV)
        self.assertEqual((r["status"], r["incidents"]), ("operational", []))


class TestAws(unittest.TestCase):
    def test_events(self):
        data = [{"arn": "e1", "service_name": "Amazon EC2", "region_name": "Europe (Ireland)", "date": "1793613600",
                 "summary": "Increased API error rates",
                 "event_log": [{"summary": "x", "message": "We are investigating", "timestamp": 1793613600}]}]
        r = up.parse_aws(data, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["components"][0]["name"], "Amazon EC2 (Europe (Ireland))")
        self.assertEqual(r["incidents"][0]["message"], "We are investigating")

    def test_empty(self):
        self.assertEqual(up.parse_aws([], PROV)["status"], "operational")


class TestSlack(unittest.TestCase):
    def test_incident(self):
        data = {"status": "active", "active_incidents": [
            {"id": 1, "title": "Messages delayed", "type": "incident", "status": "active", "url": "https://s/1",
             "date_created": ISO, "date_updated": ISO, "services": ["Messaging"], "notes": [{"body": "Fixing"}]}]}
        r = up.parse_slack(data, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["components"], [{"name": "Messaging", "status": "partial"}])

    def test_ok(self):
        self.assertEqual(up.parse_slack({"status": "ok", "active_incidents": []}, PROV)["status"], "operational")


class TestMicrosoft365(unittest.TestCase):
    @staticmethod
    def post(**kw):
        return dict({"Id": None, "Title": "", "Message": "", "Status": "Operational",
                     "AuthoredDateTime": "0001-01-01T00:00:00+00:00", "LastUpdatedTime": ISO}, **kw)

    def consumer(self, *posts):
        names = ["Outlook.com", "OneDrive", "Microsoft Teams (free)"]
        return [self.post(ServiceDisplayName=n, ServiceWorkloadName=n.replace(" ", "")) for n in names[len(posts):]] + list(posts)

    def test_ok(self):
        docs = {"mac": self.post(Status="Available", Message="<div>This site is updated when service issues occur.</div>"),
                "m365Consumer": self.consumer()}
        r = up.parse_microsoft365(docs, PROV)
        self.assertEqual((r["status"], r["total_components"], r["incidents"]), ("operational", 4, []))

    def test_restored_counts_as_operational(self):
        r = up.parse_microsoft365({"mac": self.post(Status="Service restored")}, PROV)
        self.assertEqual(r["status"], "operational")

    def test_broad_outage_from_the_admin_center(self):
        mac = self.post(Id="MO1234567", Status="Service degradation", AuthoredDateTime=ISO,
                        Message="<div>User impact: Users may be unable to access multiple Microsoft 365 services.&nbsp;<br></div>"
                                "<div>More info: Exchange Online, Microsoft Teams</div>")
        r = up.parse_microsoft365({"mac": mac, "m365Consumer": self.consumer()}, PROV)
        self.assertEqual(r["status"], "major")
        i = r["incidents"][0]
        self.assertEqual((i["id"], i["title"], i["phase"]), ("MO1234567", "Users may be unable to access multiple Microsoft 365 services.", "Service degradation"))
        self.assertEqual(r["components"], [{"name": "Microsoft 365 admin center", "status": "major"}])

    def test_one_consumer_service(self):
        outlook = self.post(ServiceDisplayName="Outlook.com", Status="Service degradation",
                            Message="Some users may be unable to send email.")
        r = up.parse_microsoft365({"mac": self.post(Status="Available"), "m365Consumer": self.consumer(outlook)}, PROV)
        self.assertEqual(r["status"], "partial")
        self.assertEqual(r["incidents"][0]["title"], "Outlook.com: service degradation")
        slow = self.post(ServiceDisplayName="OneDrive", Status="Service degradation", Message="Sync may be slow.")
        self.assertEqual(up.parse_microsoft365({"m365Consumer": [slow]}, PROV)["status"], "degraded")

    def test_unknown_status_is_not_ignored(self):
        r = up.parse_microsoft365({"m365Consumer": [self.post(ServiceDisplayName="Outlook.com", Status="Investigating")]}, PROV)
        self.assertEqual(r["status"], "degraded")

    def test_missing_dates(self):
        mac = self.post(Status="Service degradation", LastUpdatedTime="0001-01-01T00:00:00+00:00")
        i = up.parse_microsoft365({"mac": mac}, PROV)["incidents"][0]
        self.assertEqual((i["started"], i["updated"]), (None, None))

    def test_broken(self):
        for docs in ({}, {"mac": {"x": 1}}, {"m365Consumer": {"Status": "Operational"}}, []):
            with self.assertRaises(up.UnexpectedFormat):
                up.parse_microsoft365(docs, PROV)

    def test_download_falls_back_to_the_second_host(self):
        calls = []

        def fake(url):
            calls.append(url)
            if url.startswith(up.MS365_HOSTS[0]) and url.endswith("m365Consumer"):
                raise up.urllib.error.HTTPError(url, 501, "Not Implemented", {}, None)
            return b'[]' if url.endswith("m365Consumer") else b'{"Status": "Available"}'

        with mock.patch.object(up, "download", side_effect=fake):
            docs = up.download_ms365({})
        self.assertEqual(docs, {"mac": {"Status": "Available"}, "m365Consumer": []})
        self.assertTrue(calls[-1].startswith(up.MS365_HOSTS[1]))
        with mock.patch.object(up, "download", side_effect=TimeoutError("slow")):
            res, err = up.fetch({"type": "microsoft365", "web": "https://status.cloud.microsoft/"})
        self.assertIsNone(res)
        self.assertIn("ConnectionError", err)


class TestPlaces(unittest.TestCase):
    CASES = {
        "Houston, United States - (IAH)": ["@IAH"],               # Cloudflare: the code wins over the country
        "HNL (Honolulu) on 2026-11-02": ["@HNL"],                  # Cloudflare maintenance
        "Connectivity Issue between ID-CGK (Jakarta) and SG-SIN-2 (Singapore 2)": ["@CGK", "@SIN"],  # Linode
        "Multiple services (N. Virginia)": ["@IAD"],               # AWS
        "Elevated errors in us-east-1": ["@IAD"],
        "Belgium (europe-west1)": ["@BRU"],                        # Google Cloud
        "East US 2 - Virtual Machines": ["@RIC"],                  # Azure: the longest region first
        "Networking issues in West Europe": ["@AMS"],
        "Edge Delivery issues between Indonesia and Singapore": ["@SIN", "IDN"],
        "Europe (Ireland)": ["IRL"],                               # the country before the zone
        "Degraded performance in APAC": ["Z:apac"],
        "Actions": [],
        "SAN storage degraded": [],                                # acronyms that aren't airports
    }

    def test_cases(self):
        for text, expected in self.CASES.items():
            with self.subTest(text=text):
                self.assertEqual(up.locate(text), expected)

    def test_gazetteer_has_no_broken_references(self):
        for table in ("regions", "iata", "cities", "countries", "zones"):
            for key, place_id in up.PLACES[table].items():
                self.assertIn(place_id, up.PLACES["places"], f"{table}: {key}")

    def test_place_failures(self):
        comps = [{"name": "Houston, United States - (IAH)", "status": "major_outage"},
                 {"name": "Dallas, United States - (DFW)", "status": "under_maintenance"},
                 {"name": "API", "status": "partial_outage"}]
        inc = [{"id": "a", "name": "Customer Security Advisory: Frankfurt", "impact": "none", "status": "investigating"},
               {"id": "b", "name": "Latency in Madrid", "impact": "minor", "status": "investigating",
                "components": [{"name": "Houston, United States - (IAH)"}]}]
        r = up.parse_statuspage(statuspage(components=comps, incidents=inc), PROV)
        ids = {p["id"]: p for p in r["places"]}
        self.assertEqual(set(ids), {"@IAH", "@DFW", "@MAD"}, "advisories don't go on the map")
        self.assertEqual(ids["@IAH"]["level"], "major")
        self.assertEqual(ids["@DFW"]["level"], "maintenance")
        self.assertEqual(ids["@IAH"]["n"], 2)
        self.assertEqual(r["unlocated"], 1, "the API component has no place")
        self.assertEqual(r["places"][0]["id"], "@IAH", "worst first")
        self.assertNotIn("place_texts", r["incidents"][0])


class TestFetching(unittest.TestCase):
    def test_url(self):
        self.assertEqual(up.url_for({"type": "statuspage", "url": "https://a.com/"}), "https://a.com/api/v2/summary.json")
        self.assertEqual(up.url_for({"type": "statusio", "page": "p"}), "https://api.status.io/1.0/status/p")

    def test_errors_dont_break_anything(self):
        prov = dict(PROV, type="statuspage")
        with mock.patch.object(up, "download", side_effect=TimeoutError("slow")):
            res, err = up.fetch(prov)
        self.assertIsNone(res)
        self.assertIn("TimeoutError", err)
        with mock.patch.object(up, "download", return_value=b'{"page": {}}'):
            res, err = up.fetch(prov)
        self.assertTrue(err.startswith("unexpected format"))

    def test_every_provider_has_a_known_format(self):
        config = json.loads((ROOT / "data" / "providers.json").read_text("utf-8"))
        ids = [p["id"] for p in config["providers"]]
        self.assertEqual(len(ids), len(set(ids)), "duplicate ids")
        for p in config["providers"]:
            self.assertIn(p["type"], up.PARSERS, p["id"])
            self.assertIn(p["category"], config["categories"], p["id"])
            self.assertTrue(up.url_for(p).startswith("https://"), p["id"])


class TestPersistence(unittest.TestCase):
    def test_merge_keeps_data_when_the_source_fails(self):
        good = up.merge(PROV, dict(up.empty(), status="partial"), None, {})
        self.assertTrue(good["source"]["ok"])
        bad = up.merge(PROV, None, "HTTP 503", {"x": good})
        self.assertEqual((bad["status"], bad["source"]["failures_in_a_row"]), ("partial", 1))
        good["source"]["failures_in_a_row"] = up.FAILURES_BEFORE_ALERT - 1
        self.assertEqual(up.merge(PROV, None, "HTTP 503", {"x": good})["status"], "unknown")
        self.assertEqual(up.merge(PROV, None, "HTTP 503", {})["status"], "unknown", "never had data")

    def test_history(self):
        old_day = (NOW - timedelta(days=200)).strftime("%Y-%m-%d")
        p = up.merge(PROV, dict(up.empty(), status="major"), None, {})
        h = up.update_history({"x": {old_day: {"samples": 1, "down": 0, "worst": "operational"}}}, [p])
        self.assertNotIn(old_day, h["x"])
        self.assertEqual(h["x"][up.TODAY], {"samples": 1, "down": 1, "worst": "major"})
        no_data = up.merge(PROV, None, "x", {})
        self.assertEqual(up.update_history({}, [no_data])["x"], {}, "no data doesn't count")

    def test_incidents_open_and_close(self):
        inc = {"id": "1", "title": "Outage", "impact": "major", "started": ISO, "link": "u"}
        p = up.merge(PROV, dict(up.empty(), status="major", incidents=[inc]), None, {})
        log = up.update_incidents({}, [p])
        self.assertIsNone(log["x:1"]["ended"])
        down = up.merge(PROV, None, "HTTP 500", {"x": p})
        self.assertIsNone(up.update_incidents(log, [down])["x:1"]["ended"], "not closed while the source fails")
        clear = up.merge(PROV, up.empty(), None, {})
        self.assertIsNotNone(up.update_incidents(log, [clear])["x:1"]["ended"])


if __name__ == "__main__":
    unittest.main()
