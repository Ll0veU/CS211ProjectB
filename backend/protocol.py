"""Validate operator ground truth separately from observed Binder evidence."""
from collections import defaultdict
from .campaigns import SPEC

SEQUENCES = {name: tuple(item["sequence"]) for name, item in SPEC["workloads"].items()}


def nanoseconds(value):
    """Decode decimal timestamps without rounding through a JavaScript float."""
    if isinstance(value, str) and value.isascii() and value.isdigit():
        value = int(value)
    return value if type(value) is int and 0 < value < 10**18 else None


def issue_details(issues):
    known = {
        "Record the actual task outcome": "outcome_required",
        "Task markers are out of order": "marker_order",
        "Invalid marker timestamp": "marker_timestamp",
        "Task duration must be positive": "task_duration",
        "Idle observation is shorter than 30 seconds": "idle_short",
        "Task exceeded the 60 second workload limit": "task_timeout",
        "Response wait exceeded 60 seconds after voice end": "response_timeout",
        "Record the browser package": "browser_required",
        "Record the actual voice response": "response_required",
        "Task markers are missing from or outside the trace": "marker_alignment",
        "Trace duration must be positive": "trace_duration",
        "Experiment has not completed": "capture_incomplete",
        "No communication summary is available": "summary_missing",
        "Confirm fixed conditions and record any deviations": "conditions_review",
        "Confirm that the requested webpage was visible and record its URL": "page_review",
        "Record whether confirmation was required": "confirmation_review",
        "Confirm idle was undisturbed or report unexpected activity": "idle_review",
        "Record recognized speech or explicitly mark it unavailable": "speech_review",
        "Use acknowledged native phone markers for protocol v2": "native_markers_required",
        "Observation package scope has not been reviewed": "scope_unreviewed",
        "Pilot trials are excluded from formal comparisons": "pilot_only",
        "This attempt has been superseded by an explicit retry": "superseded",
        "Recorded condition deviations require a separate protocol or retry": "condition_deviation",
    }
    result = []
    for issue in dict.fromkeys(issues):
        prefix = "Expected exactly one "
        if issue.startswith(prefix) and issue.endswith(" marker"):
            result.append({"code": "marker_required", "params": {"marker": issue[len(prefix):-7]}, "detail": issue})
        else:
            result.append({"code": known.get(issue, "technical_quality"), "params": {}, "detail": issue})
    return result


def validate(run, summary=None):
    issues = []
    workload = run.get("workload")
    sequence = SEQUENCES.get(workload, ())
    if not sequence:
        issues.append("Unknown workload")
    outcome = run.get("outcome")
    if outcome not in {"success", "failure", "timeout", "unexpected_activity"}:
        issues.append("Record the actual task outcome")
    markers = run.get("markers", [])
    by_label = defaultdict(list)
    for marker in markers:
        timestamp = nanoseconds(marker.get("boottime_ns"))
        if timestamp is None:
            issues.append("Invalid marker timestamp")
            continue
        by_label[marker.get("label")].append(timestamp)
    # Failed tasks need not have reached the completion event.
    required = sequence if outcome == "success" or workload == "W0" else sequence[:1]
    if run.get("protocol_version") and workload == "W2" and outcome == "timeout":
        required = sequence[:2]
    for label in required:
        if len(by_label[label]) != 1:
            issues.append(f"Expected exactly one {label} marker")
    present = [by_label[label][0] for label in sequence if len(by_label[label]) == 1]
    if any(a >= b for a, b in zip(present, present[1:])):
        issues.append("Task markers are out of order")
    duration = None
    if sequence and all(len(by_label[label]) == 1 for label in sequence):
        duration = (by_label[sequence[-1]][0] - by_label[sequence[0]][0]) / 1e9
        if duration <= 0:
            issues.append("Task duration must be positive")
        elif workload == "W0" and duration < 30:
            issues.append("Idle observation is shorter than 30 seconds")
        elif workload in {"W1", "W2"} and duration > 60 and outcome == "success" and not (
                workload == "W2" and run.get("protocol_version")):
            issues.append("Task exceeded the 60 second workload limit")
    voice_duration = response_wait = None
    if workload == "W2":
        if len(by_label["voice_start"]) == len(by_label["voice_end"]) == 1:
            voice_duration = (by_label["voice_end"][0] - by_label["voice_start"][0]) / 1e9
        if len(by_label["voice_end"]) == len(by_label["response_complete"]) == 1:
            response_wait = (by_label["response_complete"][0] - by_label["voice_end"][0]) / 1e9
            if run.get("protocol_version") and response_wait > 60 and outcome == "success":
                issues.append("Response wait exceeded 60 seconds after voice end")
    if outcome == "success":
        if workload == "W1" and not run.get("browser_package", "").strip():
            issues.append("Record the browser package")
        if workload == "W2" and not run.get("actual_response", "").strip():
            issues.append("Record the actual voice response")
        if workload == "W0" and by_label["unexpected_activity"]:
            issues.append("Unexpected activity contradicts successful idle ground truth")
    if workload == "W1" and len(by_label["prompt_submitted"]) == 1:
        start = by_label["prompt_submitted"][0]
        end = by_label["browser_launched"][0] if len(by_label["browser_launched"]) == 1 else float("inf")
        if any(not start <= t <= end for t in by_label["confirmation"]):
            issues.append("Confirmation falls outside the browser task")
    if summary is not None:
        aligned = summary.get("markers", [])
        if len(aligned) != len(markers) or any(m.get("inside_trace") is not True for m in aligned):
            issues.append("Task markers are missing from or outside the trace")
        issues.extend(summary.get("warnings", []))
        if summary.get("trace_duration_seconds", 0) <= 0:
            issues.append("Trace duration must be positive")
    if run.get("protocol_version"):
        if run.get("conditions_confirmed") is not True:
            issues.append("Confirm fixed conditions and record any deviations")
        if run.get("deviations", "").strip():
            issues.append("Recorded condition deviations require a separate protocol or retry")
        if any(marker.get("source") not in ("android_elapsed_realtime", "android_timer") for marker in markers):
            issues.append("Use acknowledged native phone markers for protocol v2")
        if outcome == "success":
            if workload == "W1" and (run.get("page_verified") is not True or not run.get("actual_url", "").strip()):
                issues.append("Confirm that the requested webpage was visible and record its URL")
            if workload == "W0" and run.get("idle_undisturbed") is not True:
                issues.append("Confirm idle was undisturbed or report unexpected activity")
        if workload == "W1" and run.get("confirmation_status") not in ("none", "recorded"):
            issues.append("Record whether confirmation was required")
        elif workload == "W1" and run.get("confirmation_status") == "recorded" and not by_label["confirmation"]:
            issues.append("Expected exactly one confirmation marker")
        if workload == "W2" and (run.get("recognized_text_available") not in (True, False) or
                                run.get("recognized_text_available") is True and not run.get("recognized_text", "").strip()):
            issues.append("Record recognized speech or explicitly mark it unavailable")
        if outcome == "timeout" and workload in ("W1", "W2"):
            anchor = "prompt_submitted" if workload == "W1" else "voice_end"
            if len(by_label["task_timeout"]) != 1:
                issues.append("Expected exactly one task_timeout marker")
            elif len(by_label[anchor]) == 1 and by_label["task_timeout"][0] - by_label[anchor][0] < 60 * 10**9:
                issues.append("Timeout was recorded before the waiting limit")
    return {"valid": not issues, "issues": list(dict.fromkeys(issues)),
            "details": issue_details(issues), "task_duration_seconds": duration,
            "voice_duration_seconds": voice_duration, "response_wait_seconds": response_wait}
