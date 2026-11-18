"""Phone event idempotency, browser observations and operator outcome validation."""
import re
import threading
from . import browser_detection, campaigns, collector, protocol, resources
from .contracts import APIError, now


class RunEvents:
    """Coordinates events through the run store's lock and durable update interface."""

    def __init__(self, store):
        self.store = store

    def controller_ready(self, run_id, body):
        store = self.store
        with store.lock:
            run = store.get(run_id)
            if run["status"] not in ("awaiting_controller", "recording") or body.get("native") is not True:
                raise APIError(409, "Arm phone markers while the controller is visible", "controller_required")
            if body.get("version", 0) < 2:
                raise APIError(400, "Install the protocol v2 controller", "controller_update")
            store.update(run_id, controller_ready_at=now(), controller_marker_version=body["version"])
            store.ready_events[run_id].set()
            return store.get(run_id)

    def marker(self, run_id, body):
        store = self.store
        label = body.get("label")
        if not isinstance(label, str) or not label.strip() or len(label) > 80:
            raise APIError(400, "Enter a marker label of 1–80 characters.")
        run = store.get(run_id)
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
            clock = collector.Recording(run, store.folder(run_id)).mark()
            clock["source"] = "adb_uptime_sample"
        marker = {"label": label.strip(), "received_at": now(), **clock}
        if event_id:
            marker["event_id"] = event_id
        with store.lock:
            run = store.get(run_id)
            if run["status"] != "recording":
                raise APIError(409, "Recording ended before the marker was saved.")
            duplicate = next((item for item in run["markers"] if event_id and item.get("event_id") == event_id), None)
            if duplicate:
                return duplicate
            if run.get("protocol_version") and label != "confirmation" and any(item["label"] == label for item in run["markers"]):
                raise APIError(409, "This event has already been marked", "marker_duplicate")
            store.update(run_id, markers=[*run["markers"], marker])
            if marker["label"] == "browser_launched":
                store.update(run_id, browser_detection={"status": "pending", "marker_received_at": marker["received_at"]})
        if marker["label"] == "browser_launched":
            threading.Thread(target=store.detect_browser, args=(run_id, marker), daemon=True).start()
        if run.get("protocol_version") and label in ("idle_end", "browser_launched", "response_complete", "task_timeout"):
            store.stop(run_id)
        return marker

    def detect_browser(self, run_id, marker):
        store = self.store
        run = store.get(run_id)
        try:
            result = browser_detection.detect(run["serial"], run["target_package"])
        except Exception as exc:
            result = {"status": "unavailable", "reason": "Browser detection failed: " + str(exc)}
        result.update(checked_at=now(), marker_received_at=marker["received_at"], marker_boottime_ns=marker["boottime_ns"])
        with store.lock:
            run = store.get(run_id)
            if run.get("browser_detection", {}).get("marker_received_at") != marker["received_at"]:
                return
            changes = {"browser_detection": result}
            if result["status"] == "detected" and not run.get("browser_package") and run.get("browser_package_source") != "manual":
                changes.update(browser_package=result["package"], browser_package_source="foreground_after_marker")
            store.update(run_id, **changes)


def outcome_fields(body):
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
    return fields
