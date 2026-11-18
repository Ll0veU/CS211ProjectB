"""LAN API and experiment coordinator."""
import argparse
import copy
import csv
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid
import hashlib
import mimetypes
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import analyzer, collector, experiments, protocol, browser_detection, resources, campaigns, report_reference, study_export

WEB = Path(__file__).with_name("web")
DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
PACKAGE = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+")
RUN_ID = re.compile(r"[0-9a-f]{32}")
TERMINAL = {"complete", "failed"}
EXPORTS = {"metadata.json", "metadata.csv", "summary.json", "summary.csv", "transactions.json",
           "transactions.csv", "edges.csv", "timeline.csv", "capture.pftrace",
           "resources.json", "resources.csv", "resources_summary.json"}


def now():
    return datetime.now(timezone.utc).isoformat()


class APIError(Exception):
    def __init__(self, status, message, code="request_failed"):
        super().__init__(message)
        self.status = status
        self.code = code


class Runs:
    def __init__(self, root):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.runs = {}
        self.stops = {}
        self.ready_events = {}
        self.campaigns = campaigns.Campaigns(root)
        for path in root.glob("*/metadata.json"):
            if not RUN_ID.fullmatch(path.parent.name):
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if data["status"] not in TERMINAL:
                data.update(error="Backend restarted before completion.", failed_stage=data["status"],
                            status="failed", finished_at=now())
                analyzer.save_json(path, data)
            self.runs[data["id"]] = data

    def folder(self, run_id):
        return self.root / run_id

    def get(self, run_id):
        with self.lock:
            if run_id not in self.runs:
                raise APIError(404, "Run not found.")
            return copy.deepcopy(self.runs[run_id])

    def list(self):
        with self.lock:
            return [{key: copy.deepcopy(value) for key, value in run.items() if key != "packages"}
                    for run in sorted(self.runs.values(),
                    key=lambda item: item["created_at"], reverse=True)]

    def artifacts(self, run_id):
        run = self.get(run_id)
        names = ["metadata.json", "metadata.csv"]
        if run["status"] in TERMINAL:
            names.extend(name for name in sorted(EXPORTS - set(names))
                         if (self.folder(run_id) / name).is_file())
            if "summary.json" in names:
                names.append("summary.csv")
        return names

    def quality(self, run_id):
        run = self.get(run_id)
        if run.get("mode") in resources.MODES:
            path = self.folder(run_id) / "resources_summary.json"
            issues = []
            if path.is_file():
                result = json.loads(path.read_bytes())
                issues.extend(result["issues"])
            else:
                issues.append("No resource summary is available")
            if run["status"] != "complete":
                issues.append("Resource capture has not completed")
            if run.get("outcome") != "success":
                issues.append("Confirm the resource scenario outcome before comparison")
            if run.get("protocol_version") and run.get("conditions_confirmed") is not True:
                issues.append("Confirm fixed conditions and record any deviations")
            if run.get("protocol_version") and run.get("idle_undisturbed") is not True:
                issues.append("Confirm idle was undisturbed or report unexpected activity")
            if run.get("protocol_version") and run.get("deviations", "").strip():
                issues.append("Recorded condition deviations require a separate protocol or retry")
            quality = {"valid": not issues, "protocol_valid": not issues, "issues": issues,
                       "task_duration_seconds": None, "metric_availability": result["metrics"] if path.is_file() else {},
                       "energy": result["battery"] if path.is_file() else None}
            return self.decorate_quality(run, quality)
        path = self.folder(run_id) / "summary.json"
        summary = json.loads(path.read_bytes()) if path.is_file() else None
        result = protocol.validate(run, summary)
        if run["status"] != "complete":
            result["issues"].append("Experiment has not completed")
        if run.get("mode", "trace") == "trace" and summary is None:
            result["issues"].append("No communication summary is available")
        result["valid"] = not result["issues"]
        result["protocol_valid"] = result["valid"]
        return self.decorate_quality(run, result)

    def decorate_quality(self, run, result):
        result["capture_status"] = run["status"]
        result["actual_outcome"] = run.get("outcome")
        result["attribution_status"] = "confirmed_observation_scope" if run.get("scope_confirmed") else "unreviewed"
        if run.get("protocol_version"):
            if not run.get("scope_confirmed"):
                result["issues"].append("Observation package scope has not been reviewed")
            if run.get("phase") == "pilot":
                result["issues"].append("Pilot trials are excluded from formal comparisons")
            if run.get("superseded_by_trial"):
                result["issues"].append("This attempt has been superseded by an explicit retry")
        elif run.get("target_package") == "com.google.android.apps.bard":
            result["issues"].append("Observation package scope has not been reviewed")
        result["valid"] = not result["issues"]
        result["details"] = protocol.issue_details(result["issues"])
        return result

    def controller_ready(self, run_id, body):
        with self.lock:
            run = self.get(run_id)
            if run["status"] not in ("awaiting_controller", "recording") or body.get("native") is not True:
                raise APIError(409, "Arm phone markers while the controller is visible", "controller_required")
            if body.get("version", 0) < 2:
                raise APIError(400, "Install the protocol v2 controller", "controller_update")
            self.update(run_id, controller_ready_at=now(), controller_marker_version=body["version"])
            self.ready_events[run_id].set()
            return self.get(run_id)

    def update(self, run_id, **changes):
        with self.lock:
            run = {**self.runs[run_id], **changes}
            analyzer.save_json(self.folder(run_id) / "metadata.json", run)
            self.runs[run_id] = run

    def start(self, body, client="desktop"):
        body = dict(body)
        if body.get("campaign_id"):
            body.update(self.campaigns.prepare(body["campaign_id"], body.get("trial_id"), self.runs))
            if body.get("preflight_confirmed") is not True:
                raise APIError(400, "Complete the preflight checklist", "preflight_required")
            finished = [record.get("finished_at") for record in self.runs.values()
                        if record.get("device_label") == body["device_label"] and record.get("finished_at")]
            if finished:
                elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(max(finished))).total_seconds()
                if elapsed < 60:
                    raise APIError(409, "Rest at least 60 seconds between trials", "rest_required")
        package = body.get("target_package", "")
        workload = body.get("workload")
        duration = body.get("duration_seconds", 40 if workload == "W0" else 90)
        serial = body.get("serial")
        repetition = body.get("repetition", 1)
        mode = body.get("mode", "trace")
        context = {key: body.get(key, "") for key in ("device_label", "conditions")}
        resource_mode = mode in resources.MODES
        if mode not in ("trace", "baseline", *resources.MODES) or any(
                not isinstance(v, str) or len(v) > 200 for v in context.values()):
            raise APIError(400, "Select a supported mode; context fields must be at most 200 characters.")
        interval = body.get("sample_interval_seconds", 15)
        settling = body.get("settle_seconds", 30)
        if resource_mode:
            if client != "desktop":
                raise APIError(400, "Start all resource arms from the laptop browser; the Agent-only arm closes the APK.")
            if package == resources.CONTROLLER:
                raise APIError(400, "Select an Agent distinct from the Project B controller.")
            if not all(v.strip() for v in context.values()):
                raise APIError(400, "Resource comparisons need a stable phone label and documented conditions.")
            if type(interval) is not int or not 10 <= interval <= 60 or type(settling) is not int or not 10 <= settling <= 120:
                raise APIError(400, "Use a 10–60 second sample interval and 10–120 second settling delay.")
            if mode == "resource_agent" and body.get("controller_stop_ack") is not True:
                raise APIError(400, "Acknowledge that Agent-only stops the Project B controller on the selected phone.")
        if not isinstance(package, str) or not PACKAGE.fullmatch(package):
            raise APIError(400, "Enter an installed Android package name.")
        low, high = (30, 540) if resource_mode else (5, 180)
        if workload not in ("W0", "W1", "W2") or type(duration) is not int or not low <= duration <= high:
            raise APIError(400, f"Select W0, W1 or W2 and a duration of {low}–{high} seconds.")
        if resource_mode and duration < 2 * interval:
            raise APIError(400, "Resource duration must be at least twice the sampling interval.")
        if type(repetition) is not int or not 1 <= repetition <= 100:
            raise APIError(400, "Enter a repetition number of 1–100.")
        if not isinstance(serial, str) or not serial:
            raise APIError(400, "Select an ADB device.")
        if serial not in collector.devices():
            raise APIError(400, "Selected ADB device is unavailable.")
        with self.lock:
            if any(run["status"] not in TERMINAL for run in self.runs.values()):
                raise APIError(409, "An experiment is already active.")
            if body.get("campaign_id"):
                self.campaigns.prepare(body["campaign_id"], body["trial_id"], self.runs)
            run_id = uuid.uuid4().hex
            self.folder(run_id).mkdir()
            run = dict(id=run_id, status="preparing", serial=serial, target_package=package,
                       workload=workload, duration_seconds=duration, repetition=repetition,
                       created_at=now(), markers=[], outcome=None, notes="", browser_package="",
                       recognized_text="", actual_response="")
            run.update(mode=mode, **context)
            run["timezone"] = str(body.get("timezone", "UTC"))[:100]
            for key in ("campaign_id", "trial_id", "phase", "attempt", "protocol_version", "protocol_snapshot",
                        "condition_profile", "condition_signature", "agent_id", "target_packages", "scope_confirmed",
                        "temperature_baseline_c"):
                if key in body:
                    run[key] = copy.deepcopy(body[key])
            if resource_mode:
                run.update(sample_interval_seconds=interval, settle_seconds=settling,
                           observer=resources.CURRENT_OBSERVER, controller_stop_ack=body.get("controller_stop_ack", False))
            analyzer.save_json(self.folder(run_id) / "metadata.json", run)
            self.runs[run_id] = run
            stop = self.stops[run_id] = threading.Event()
            self.ready_events[run_id] = threading.Event()
            if run.get("campaign_id"):
                self.campaigns.attach(run["campaign_id"], run["trial_id"], run_id)
            threading.Thread(target=self.run, args=(run_id, stop), daemon=True).start()
            return self.get(run_id)

    def run(self, run_id, stop):
        stage = "preparing"
        try:
            run = self.get(run_id)
            folder = self.folder(run_id)
            serial, package = run["serial"], run["target_package"]
            packages = collector.packages(serial)
            if package not in packages:
                raise RuntimeError("Target package is not installed for the current Android user.")
            self.update(run_id, target_uid=packages[package], packages=packages,
                        android_sdk=collector.adb("shell", "getprop", "ro.build.version.sdk", serial=serial))
            if run.get("protocol_version"):
                names = list(dict.fromkeys([*run["target_packages"], resources.CONTROLLER,
                                           run["condition_profile"]["browser_package"]]))
                identity = {"build": collector.adb("shell", "getprop", "ro.build.fingerprint", serial=serial).strip(),
                            "packages": [collector.package_details(serial, name) for name in sorted(names)],
                            "backend_sha256": {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                                               for name in ("collector.py", "analyzer.py", "protocol.py", "resources.py", "resource_proc.py")},
                            "trace_config_sha256": hashlib.sha256(collector.CONFIG.read_bytes()).hexdigest()}
                self.update(run_id, identity_snapshot=identity)
                run["identity_snapshot"] = identity
                settings = {}
                for name, args in {"model": ("getprop", "ro.product.model"),
                                   "brightness": ("settings", "get", "system", "screen_brightness"),
                                   "automatic_brightness": ("settings", "get", "system", "screen_brightness_mode")}.items():
                    try:
                        settings[name] = collector.adb("shell", *args, serial=serial).strip()
                    except Exception as error:
                        settings[name] = {"unavailable": str(error)}
                settings["battery"] = resources.parse_battery(collector.adb("shell", "dumpsys", "battery", serial=serial))
                self.update(run_id, device_conditions_snapshot=settings)
                campaign = self.campaigns.get(run["campaign_id"])
                if run["phase"] == "formal" and identity != campaign.get("identity_snapshot"):
                    raise RuntimeError("Device/application identity changed after protocol freeze; create a revision")
            if run.get("mode") in resources.MODES:
                stage = "resources"
                trace = resources.capture(run, folder, stop, lambda **changes: self.update(run_id, **changes))
                self.update(run_id, status="complete", finished_at=now(),
                            trace_bytes=trace.stat().st_size if trace else None)
                return
            recording = collector.Recording(run, folder)
            baseline = run.get("mode") == "baseline"
            if run.get("protocol_version"):
                self.update(run_id, status="awaiting_controller")
                deadline = time.monotonic() + 180
                while not self.ready_events[run_id].wait(.25):
                    if stop.is_set() or time.monotonic() >= deadline:
                        raise RuntimeError("Phone marker readiness was cancelled or timed out")
            if not baseline:
                recording.start()
            stage = "recording"
            self.update(run_id, status=stage, recording_at=now())
            deadline = time.monotonic() + run["duration_seconds"] + 2
            while not stop.wait(.4) and time.monotonic() < deadline and (baseline or recording.running()):
                pass
            if baseline:
                self.update(run_id, status="complete", finished_at=now())
                return
            stage = "collecting"
            self.update(run_id, status=stage)
            trace = recording.collect(stop.is_set())
            self.update(run_id, trace_bytes=trace.stat().st_size)
            stage = "analyzing"
            self.update(run_id, status=stage)
            started = time.monotonic()
            analyzer.export(folder, *analyzer.analyze(trace, self.get(run_id)))
            self.update(run_id, status="complete", finished_at=now(),
                        analysis_wall_seconds=time.monotonic() - started)
        except Exception as exc:
            self.update(run_id, status="failed", failed_stage=stage, error=str(exc), finished_at=now())
        finally:
            with self.lock:
                self.stops.pop(run_id, None)
                self.ready_events.pop(run_id, None)

    def stop(self, run_id):
        with self.lock:
            run = self.get(run_id)
            if run["status"] in {"preparing", "awaiting_controller", "settling", "recording"}:
                self.stops[run_id].set()
            return run

    def marker(self, run_id, body):
        label = body.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 80:
            raise APIError(400, "Enter a marker label of 1–80 characters.")
        run = self.get(run_id)
        event_id = body.get("event_id")
        if event_id is not None and (not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", event_id)):
            raise APIError(400, "Invalid marker event ID", "invalid_marker")
        if event_id:
            previous = next((marker for marker in run["markers"] if marker.get("event_id") == event_id), None)
            if previous:
                if previous["label"] != label or str(previous["boottime_ns"]) != str(body.get("boottime_ns")):
                    raise APIError(409, "Marker event ID was reused with different data", "marker_conflict")
                return previous
        if run.get("mode") in resources.MODES:
            raise APIError(409, "Resource runs use a fixed window and laptop ground truth, not phone markers.")
        if run["status"] != "recording":
            raise APIError(409, "Markers require an active recording.")
        phone_time = protocol.nanoseconds(body.get("boottime_ns"))
        if run.get("protocol_version") and (not event_id or phone_time is None):
            raise APIError(400, "Protocol v2 requires native device timestamps and event IDs", "native_markers_required")
        if run.get("protocol_version"):
            allowed = campaigns.SPEC["workloads"][run["workload"]]["markers"] + ["task_timeout"]
            if label not in allowed:
                raise APIError(400, "Marker is not part of this workload", "invalid_marker")
            sequence = protocol.SEQUENCES[run["workload"]]
            seen = {item["label"] for item in run["markers"]}
            if label in sequence and sequence.index(label) > 0 and sequence[sequence.index(label) - 1] not in seen:
                raise APIError(409, "Record the preceding event first", "marker_order")
        if phone_time is not None:
            clock = {"boottime_ns": str(phone_time) if run.get("protocol_version") else phone_time,
                     "source": "android_timer" if body.get("source") == "android_timer" else "android_elapsed_realtime"}
        else:
            clock = collector.Recording(run, self.folder(run_id)).mark()
            clock["source"] = "adb_uptime_sample"
        marker = {"label": label.strip(), "received_at": now(), **clock}
        if event_id:
            marker["event_id"] = event_id
        with self.lock:
            run = self.get(run_id)
            if run["status"] != "recording":
                raise APIError(409, "Recording ended before the marker was saved.")
            duplicate = next((item for item in run["markers"] if event_id and item.get("event_id") == event_id), None)
            if duplicate:
                return duplicate
            if run.get("protocol_version") and label != "confirmation" and any(item["label"] == label for item in run["markers"]):
                raise APIError(409, "This event has already been marked", "marker_duplicate")
            self.update(run_id, markers=[*run["markers"], marker])
            if marker["label"] == "browser_launched":
                self.update(run_id, browser_detection={"status": "pending", "marker_received_at": marker["received_at"]})
        if marker["label"] == "browser_launched":
            threading.Thread(target=self.detect_browser, args=(run_id, marker), daemon=True).start()
        if run.get("protocol_version") and label in ("idle_end", "browser_launched", "response_complete", "task_timeout"):
            self.stop(run_id)
        return marker

    def detect_browser(self, run_id, marker):
        run = self.get(run_id)
        try:
            result = browser_detection.detect(run["serial"], run["target_package"])
        except Exception as exc:
            result = {"status": "unavailable", "reason": "Browser detection failed: " + str(exc)}
        result.update(checked_at=now(), marker_received_at=marker["received_at"],
                      marker_boottime_ns=marker["boottime_ns"])
        with self.lock:
            run = self.get(run_id)
            if run.get("browser_detection", {}).get("marker_received_at") != marker["received_at"]:
                return  # A newer browser marker owns the current detection request.
            changes = {"browser_detection": result}
            if result["status"] == "detected" and not run.get("browser_package") \
                    and run.get("browser_package_source") != "manual":
                changes.update(browser_package=result["package"], browser_package_source="foreground_after_marker")
            self.update(run_id, **changes)

    def outcome(self, run_id, body):
        if body.get("outcome") not in ("success", "failure", "timeout", "unexpected_activity"):
            raise APIError(400, "Choose an experiment outcome.")
        fields = {"outcome": body["outcome"]}
        for key in ("notes", "browser_package", "recognized_text", "actual_response", "actual_url", "deviations"):
            value = body.get(key, "")
            if not isinstance(value, str) or len(value) > 2000:
                raise APIError(400, f"Invalid {key}.")
            fields[key] = value
        for key in ("conditions_confirmed", "page_verified", "idle_undisturbed", "recognized_text_available"):
            if key in body:
                if type(body[key]) is not bool:
                    raise APIError(400, "Expected a confirmation checkbox", "invalid_ground_truth")
                fields[key] = body[key]
        if "confirmation_status" in body:
            if body["confirmation_status"] not in ("none", "recorded", "unknown"):
                raise APIError(400, "Invalid confirmation status", "invalid_ground_truth")
            fields["confirmation_status"] = body["confirmation_status"]
        with self.lock:
            run = self.get(run_id)
            if fields["browser_package"] != run.get("browser_package", ""):
                fields["browser_package_source"] = "manual"
            self.update(run_id, **fields)
        return self.get(run_id)


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, kind="application/json", filename=None):
        # Drain rejected POST bodies to avoid Windows TCP resets hiding 4xx replies.
        if self.command == "POST" and not getattr(self, "body_consumed", False):
            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
            except ValueError:
                length = 0
            if 0 < length <= 16384:
                self.rfile.read(length)
            self.body_consumed = True
        data = json.dumps(body, ensure_ascii=False).encode() if kind == "application/json" and not isinstance(body, bytes) else body
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 <= length <= 16384:
                raise ValueError()
            raw = self.rfile.read(length)
            self.body_consumed = True
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeError) as exc:
            raise APIError(400, "Expected a JSON object of at most 16 KiB.") from exc

    def route(self):
        path = urlsplit(self.path).path
        method = self.command
        static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                  "/style.css": ("style.css", "text/css")}
        if method == "GET" and (path == "/" or path.startswith("/assets/")) and DIST.is_dir():
            file = (DIST / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
            if not file.is_relative_to(DIST.resolve()) or not file.is_file():
                raise APIError(404, "Unknown frontend asset", "not_found")
            kind = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            return self.respond(200, file.read_bytes(), kind)
        if method == "GET" and path in static:
            file, kind = static[path]
            return self.respond(200, (WEB / file).read_bytes(), kind + "; charset=utf-8")
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(),
                                   f"Bearer {self.server.token}".encode()):
            raise APIError(401, "Enter the backend access token.")
        runs = self.server.runs
        if method == "GET" and path == "/api/protocol":
            return self.respond(200, campaigns.SPEC)
        if method == "GET" and path == "/api/reference-report":
            return self.respond(200, report_reference.read_reference())
        if method == "GET" and path in ("/api/study/report.en.md", "/api/study/report.zh-CN.md"):
            locale = "zh-CN" if "zh-CN" in path else "en"
            with runs.lock:
                data = study_export.study_report(runs.root, locale)
            return self.respond(200, data, "text/markdown; charset=utf-8", f"vivo-report.{locale}.md")
        if method == "GET" and path == "/api/study/bundle.zip":
            with runs.lock:
                if any(record["status"] not in TERMINAL for record in runs.runs.values()):
                    raise APIError(409, "Export after the active capture finishes", "experiment_active")
                data = study_export.bundle(runs.root)
            return self.respond(200, data, "application/zip", "vivo-study-evidence.zip")
        if path == "/api/campaigns":
            with runs.lock:
                if method == "GET":
                    return self.respond(200, runs.campaigns.list())
                if method == "POST":
                    return self.respond(201, runs.campaigns.create(self.body()))
        campaign_parts = path.strip("/").split("/")
        if campaign_parts[:2] == ["api", "campaigns"] and len(campaign_parts) >= 3:
            campaign_id, action = campaign_parts[2], campaign_parts[3:]
            with runs.lock:
                if method == "GET" and not action:
                    return self.respond(200, runs.campaigns.get(campaign_id))
                if method == "GET" and action == ["export.json"]:
                    return self.respond(200, runs.campaigns.export(campaign_id, runs.runs, runs.quality), filename="experiment-plan.json")
                if method == "GET" and action == ["export.csv"]:
                    return self.respond(200, runs.campaigns.csv(campaign_id, runs.runs, runs.quality), "text/csv", "trial-records.csv")
                if method == "GET" and action in (["guide.en.md"], ["guide.zh-CN.md"]):
                    locale = "zh-CN" if action[0] == "guide.zh-CN.md" else "en"
                    return self.respond(200, runs.campaigns.guide(campaign_id, locale), "text/markdown; charset=utf-8", action[0])
                if method == "POST" and action == ["freeze"]:
                    return self.respond(200, runs.campaigns.freeze(campaign_id, self.body(), runs.runs, runs.quality, runs.root))
                if method == "POST" and action == ["revise"]:
                    return self.respond(201, runs.campaigns.revise(campaign_id, self.body()))
                if method == "POST" and action == ["retry"]:
                    body = self.body()
                    campaign = runs.campaigns.retry(campaign_id, body.get("trial_id"), body.get("reason"), runs.runs)
                    for trial in campaign["trials"]:
                        if trial.get("replaces_trial_id"):
                            original = runs.campaigns.trial(campaign, trial["replaces_trial_id"])
                            for run_id in original["run_ids"]:
                                runs.update(run_id, superseded_by_trial=trial["id"])
                    return self.respond(200, campaign)
        if method == "GET" and path == "/api/devices":
            return self.respond(200, collector.devices())
        if method == "GET" and path == "/api/runs":
            return self.respond(200, runs.list())
        if method == "GET" and path == "/api/evaluation.json":
            with runs.lock:
                result = experiments.report(runs.root)
            return self.respond(200, result, filename="evaluation.json")
        if method == "POST" and path == "/api/runs":
            return self.respond(202, runs.start(self.body(), self.headers.get("X-ProjectB-Client", "desktop")))
        parts = path.strip("/").split("/")
        if parts == ["api", "devices", "resource-capabilities"] and method == "POST":
            body = self.body()
            serial, package = body.get("serial"), body.get("package")
            if not isinstance(serial, str) or serial not in collector.devices():
                raise APIError(400, "Selected ADB device is unavailable.")
            if not isinstance(package, str) or not PACKAGE.fullmatch(package):
                raise APIError(400, "Enter a valid Agent package.")
            targets = body.get("target_packages", [package])
            if not isinstance(targets, list) or not 1 <= len(targets) <= 6 or any(
                    not isinstance(name, str) or not PACKAGE.fullmatch(name) for name in targets):
                raise APIError(400, "Select observation packages", "invalid_packages")
            with runs.lock:
                if any(r["status"] not in TERMINAL for r in runs.runs.values()):
                    raise APIError(409, "Run capability checks only when no experiment is active.")
                return self.respond(200, resources.capabilities(serial, targets if "target_packages" in body else package,
                                                               observer=resources.CURRENT_OBSERVER))
        if parts == ["api", "devices", "package-details"] and method == "POST":
            body = self.body()
            serial, package = body.get("serial"), body.get("package")
            if not isinstance(serial, str) or serial not in collector.devices():
                raise APIError(400, "Selected ADB device is unavailable.")
            if not isinstance(package, str) or not PACKAGE.fullmatch(package):
                raise APIError(400, "Enter a valid package name.")
            try:
                return self.respond(200, collector.package_details(serial, package))
            except ValueError as exc:
                raise APIError(400, str(exc)) from exc
        if parts[:2] == ["api", "devices"] and parts[2:] == ["packages"] and method == "POST":
            serial = self.body().get("serial")
            if not isinstance(serial, str) or serial not in collector.devices():
                raise APIError(400, "Selected ADB device is unavailable.")
            return self.respond(200, sorted(collector.packages(serial)))
        if parts[:2] != ["api", "runs"] or len(parts) < 3 or not RUN_ID.fullmatch(parts[2]):
            raise APIError(404, "Unknown endpoint.")
        run_id, action = parts[2], parts[3:]
        if method == "GET" and not action:
            return self.respond(200, {key: value for key, value in runs.get(run_id).items() if key != "packages"})
        if method == "GET" and action == ["artifacts"]:
            return self.respond(200, runs.artifacts(run_id))
        if method == "GET" and action == ["quality"]:
            return self.respond(200, runs.quality(run_id))
        if method == "POST" and action == ["stop"]:
            return self.respond(202, runs.stop(run_id))
        if method == "POST" and action == ["markers"]:
            return self.respond(201, runs.marker(run_id, self.body()))
        if method == "POST" and action == ["controller-ready"]:
            return self.respond(200, runs.controller_ready(run_id, self.body()))
        if action == ["analyses"]:
            root = runs.root / ".analyses" / run_id
            if method == "GET":
                return self.respond(200, [json.loads(file.read_text(encoding="utf-8")) for file in root.glob("*/analysis.json")])
            if method == "POST":
                body = self.body()
                names = body.get("target_packages")
                if not isinstance(names, list) or not names or len(names) > 6 or any(not isinstance(name, str) or not PACKAGE.fullmatch(name) for name in names):
                    raise APIError(400, "Select observation packages", "invalid_packages")
                source_run = runs.get(run_id)
                if source_run["status"] not in TERMINAL or not (runs.folder(run_id) / "capture.pftrace").is_file():
                    raise APIError(409, "A completed trace file is required", "capture_incomplete")
                analysis_id = uuid.uuid4().hex
                folder = root / analysis_id
                folder.mkdir(parents=True)
                trace = runs.folder(run_id) / "capture.pftrace"
                observed = {**source_run, "target_packages": list(dict.fromkeys(names)), "scope_confirmed": False}
                transactions, summary = analyzer.analyze(trace, observed)
                analyzer.export(folder, transactions, summary)
                result = {"id": analysis_id, "source_run_id": run_id, "source_sha256": hashlib.sha256(trace.read_bytes()).hexdigest(),
                          "created_at": now(), "target_packages": names, "summary": summary,
                          "quality": protocol.validate(source_run, summary), "formal_eligible": False}
                analyzer.save_json(folder / "analysis.json", result)
                return self.respond(201, result)
        if method == "POST" and action == ["outcome"]:
            return self.respond(200, runs.outcome(run_id, self.body()))
        if method == "GET" and len(action) == 1 and action[0] in EXPORTS:
            run = runs.get(run_id)
            name = action[0]
            kind = {"csv": "text/csv", "json": "application/json",
                    "pftrace": "application/octet-stream"}[name.split(".")[-1]]
            file = runs.folder(run_id) / name
            if name == "metadata.csv":
                data = run
            elif name == "summary.csv" and run["status"] in TERMINAL and file.with_suffix(".json").is_file():
                data = json.loads(file.with_suffix(".json").read_bytes())
            elif file.is_file() and (run["status"] in TERMINAL or name == "metadata.json"):
                return self.respond(200, file.read_bytes(), kind, name)
            else:
                raise APIError(409, "This export is not available yet.")
            import io
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(["field", "value_json"])
            writer.writerows((key, json.dumps(value, ensure_ascii=False)) for key, value in data.items())
            return self.respond(200, buffer.getvalue().encode(), kind, name)
        raise APIError(404, "Unknown endpoint.")

    def dispatch(self):
        try:
            self.route()
        except APIError as exc:
            self.respond(exc.status, {"error": str(exc), "code": exc.code, "params": {}})
        except campaigns.CampaignError as exc:
            self.respond(400, {"error": str(exc), "code": exc.code, "params": {}})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.respond(500, {"error": str(exc), "code": "server_error", "params": {}})

    do_GET = dispatch
    do_POST = dispatch


def access_token(root):
    """Reuse a short pairing code across backend restarts on the lab LAN."""
    override = os.environ.get("CS211_ACCESS_TOKEN")
    if override:
        return override
    root.mkdir(parents=True, exist_ok=True)
    path = root / ".access-token"
    try:
        with path.open("x", encoding="utf-8") as file:
            token = f"{secrets.randbelow(1_000_000):06d}"
            file.write(token + "\n")
    except FileExistsError:
        pass
    token = path.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9]{6}", token):
        raise ValueError(f"Invalid saved access code in {path}. Set CS211_ACCESS_TOKEN or remove this file to generate a new code.")
    return token


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--runs", type=Path, default=Path("runs"))
    args = parser.parse_args()
    token = access_token(args.runs)
    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        server.token = token
        server.runs = Runs(args.runs)
        print(f"Project B at http://{args.host}:{args.port} | Access token: {token}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
