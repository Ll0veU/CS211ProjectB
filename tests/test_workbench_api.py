"""Exercise the public workbench API without touching a physical phone."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import server
from test_workbench import config_fixture


class WorkbenchAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.http.token = "test-only"
        self.http.runs = server.Runs(Path(self.directory.name))
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close)

    def close(self):
        self.http.shutdown()
        self.worker.join()
        self.http.server_close()

    def request(self, path, body=None, token="test-only", raw=False):
        request = Request(f"http://127.0.0.1:{self.http.server_port}/api/{path}",
                          data=json.dumps(body).encode() if body is not None else None,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        with urlopen(request, timeout=4) as response:
            payload = response.read()
            return payload if raw else json.loads(payload)

    def test_plan_create_export_and_freeze_gate(self):
        plan = self.request("campaigns", {"config": config_fixture(), "name": "API pilot"})
        self.assertEqual(len(plan["trials"]), 6)
        self.assertEqual(self.request(f"campaigns/{plan['id']}")["config"], plan["config"])
        self.assertIn(b"trial_id", self.request(f"campaigns/{plan['id']}/export.csv", raw=True))
        self.assertIn("Voice end", self.request(f"campaigns/{plan['id']}/guide.en.md", raw=True).decode())
        self.assertIn("语音结束", self.request(f"campaigns/{plan['id']}/guide.zh-CN.md", raw=True).decode())
        with self.assertRaises(HTTPError) as error:
            self.request(f"campaigns/{plan['id']}/freeze", {"scope_confirmed": True, "pilot_reviewed": True})
        self.assertEqual(json.loads(error.exception.read())["code"], "pilot_required")

    def test_auth_failure_returns_json_without_reset(self):
        for _ in range(5):
            with self.assertRaises(HTTPError) as error:
                self.request("campaigns", {"name": "must not create"}, token="wrong")
            self.assertEqual(error.exception.code, 401)
            self.assertIn("code", json.loads(error.exception.read()))
        self.assertEqual(self.request("campaigns"), [])

    def test_report_and_bundle_export_are_authenticated_and_partial(self):
        import io
        import zipfile
        report = self.request("study/report.zh-CN.md", raw=True).decode("utf-8")
        self.assertIn("进行中", report)
        archive = self.request("study/bundle.zip", raw=True)
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            self.assertIn("report.zh-CN.md", exported.namelist())
            self.assertIn("manifest.sha256.json", exported.namelist())
        with self.assertRaises(HTTPError) as error:
            self.request("study/bundle.zip", token="wrong", raw=True)
        self.assertEqual(error.exception.code, 401)
        error.exception.close()

    def test_native_readiness_markers_and_capture_finish(self):
        class Recorder:
            def __init__(self, run, folder): self.folder = folder
            def start(self): pass
            def running(self): return True
            def collect(self, stop):
                path = self.folder / "capture.pftrace"
                path.write_bytes(b"test fixture")
                return path

        def analyze(trace, run):
            return [], {"markers": [{**marker, "inside_trace": True} for marker in run["markers"]],
                        "warnings": [], "trace_duration_seconds": 31, "timeline": [], "edges": []}

        installed = {"com.agent": 10, "com.host": 11, "com.browser": 12, "edu.cs211.projectb": 13}
        def detail(serial, package): return {"package": package, "uid": installed[package], "version": "test", "version_code": "1"}
        with patch.object(server.collector, "devices", return_value=["test-device"]), \
             patch.object(server.collector, "packages", return_value=installed), \
             patch.object(server.collector, "package_details", side_effect=detail), \
             patch.object(server.collector, "adb", return_value="test-build"), \
             patch.object(server.collector, "Recording", Recorder), \
             patch.object(server.analyzer, "analyze", side_effect=analyze):
            plan = self.request("campaigns", {"config": config_fixture()})
            run = self.request("runs", {"campaign_id": plan["id"], "trial_id": plan["trials"][0]["id"],
                                        "serial": "test-device", "preflight_confirmed": True})
            path = f"runs/{run['id']}"
            def wait_for(state):
                for _ in range(100):
                    actual = self.request(path)
                    if actual["status"] == state: return actual
                    self.assertNotEqual(actual["status"], "failed", actual)
                    time.sleep(.02)
                self.fail(f"Did not reach {state}")
            wait_for("awaiting_controller")
            self.request(path + "/controller-ready", {"native": True, "version": 2})
            wait_for("recording")
            self.request(path + "/markers", {"label": "idle_start", "event_id": "test-start-1", "boottime_ns": "10000000000000123"})
            end = {"label": "idle_end", "event_id": "test-end-1", "boottime_ns": "10000030000000123", "source": "android_timer"}
            marker = self.request(path + "/markers", end)
            wait_for("complete")
            self.assertEqual(self.request(path + "/markers", end), marker)
            self.request(path + "/outcome", {"outcome": "success", "conditions_confirmed": True, "idle_undisturbed": True})
            quality = self.request(path + "/quality")
            self.assertTrue(quality["protocol_valid"], quality)
            self.assertFalse(quality["valid"])
            self.assertIn("pilot_only", [item["code"] for item in quality["details"]])
            self.assertEqual(len(self.request(path)["markers"]), 2)
