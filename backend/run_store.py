"""Durable run storage and serialized experiment admission."""
import copy
import json
import threading
import uuid
from datetime import datetime, timezone
from . import analyzer, campaigns, collector, resources
from .contracts import APIError, EXPORTS, PACKAGE, RUN_ID, TERMINAL, now
from .run_capture import capture_run
from .run_events import RunEvents, outcome_fields
from .run_quality import assess, decorate


class Runs:
    def __init__(self, root):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.runs = {}
        self.stops = {}
        self.ready_events = {}
        self.campaigns = campaigns.Campaigns(root)
        self.events = RunEvents(self)
        for path in root.glob("*/metadata.json"):
            if not RUN_ID.fullmatch(path.parent.name):
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if data["status"] not in TERMINAL:
                data.update(error="Backend restarted before completion.", failed_stage=data["status"], status="failed", finished_at=now())
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
                    for run in sorted(self.runs.values(), key=lambda item: item["created_at"], reverse=True)]

    def artifacts(self, run_id):
        run = self.get(run_id)
        names = ["metadata.json", "metadata.csv"]
        if run["status"] in TERMINAL:
            names.extend(name for name in sorted(EXPORTS - set(names)) if (self.folder(run_id) / name).is_file())
            if "summary.json" in names:
                names.append("summary.csv")
        return names

    def quality(self, run_id):
        return assess(self.get(run_id), self.folder(run_id))

    def decorate_quality(self, run, result):
        return decorate(run, result)

    def controller_ready(self, run_id, body):
        return self.events.controller_ready(run_id, body)

    def marker(self, run_id, body):
        return self.events.marker(run_id, body)

    def detect_browser(self, run_id, marker):
        return self.events.detect_browser(run_id, marker)

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
        if mode not in ("trace", "baseline", *resources.MODES) or any(not isinstance(value, str) or len(value) > 200 for value in context.values()):
            raise APIError(400, "Select a supported mode; context fields must be at most 200 characters.")
        interval = body.get("sample_interval_seconds", 15)
        settling = body.get("settle_seconds", 30)
        if resource_mode:
            if client != "desktop":
                raise APIError(400, "Start all resource arms from the laptop browser; the Agent-only arm closes the APK.")
            if package == resources.CONTROLLER:
                raise APIError(400, "Select an Agent distinct from the Project B controller.")
            if not all(value.strip() for value in context.values()):
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
                       created_at=now(), markers=[], outcome=None, notes="", browser_package="", recognized_text="", actual_response="")
            run.update(mode=mode, **context)
            run["timezone"] = str(body.get("timezone", "UTC"))[:100]
            for key in ("campaign_id", "trial_id", "phase", "attempt", "protocol_version", "protocol_snapshot", "condition_profile",
                        "condition_signature", "agent_id", "target_packages", "scope_confirmed", "temperature_baseline_c"):
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
        capture_run(self, run_id, stop)

    def stop(self, run_id):
        with self.lock:
            run = self.get(run_id)
            if run["status"] in {"preparing", "awaiting_controller", "settling", "recording"}:
                self.stops[run_id].set()
            return run

    def outcome(self, run_id, body):
        fields = outcome_fields(body)
        with self.lock:
            run = self.get(run_id)
            if fields["browser_package"] != run.get("browser_package", ""):
                fields["browser_package_source"] = "manual"
            self.update(run_id, **fields)
        return self.get(run_id)
