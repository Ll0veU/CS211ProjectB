"""Evidence quality is separate from outcome, collection state and formal eligibility."""
import json
from . import protocol, resources


def decorate(run, result):
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


def assess(run, folder):
    if run.get("mode") in resources.MODES:
        path = folder / "resources_summary.json"
        issues = []
        result = json.loads(path.read_bytes()) if path.is_file() else None
        if result:
            issues.extend(result["issues"])
        else:
            issues.append("No resource summary is available")
        if run["status"] != "complete":
            issues.append("Resource capture has not completed")
        if run.get("outcome") != "success":
            issues.append("Confirm the resource scenario outcome before comparison")
        if run.get("protocol_version"):
            if run.get("conditions_confirmed") is not True:
                issues.append("Confirm fixed conditions and record any deviations")
            if run.get("idle_undisturbed") is not True:
                issues.append("Confirm idle was undisturbed or report unexpected activity")
            if run.get("deviations", "").strip():
                issues.append("Recorded condition deviations require a separate protocol or retry")
        quality = {"valid": not issues, "protocol_valid": not issues, "issues": issues,
                   "task_duration_seconds": None, "metric_availability": result["metrics"] if result else {},
                   "energy": result["battery"] if result else None}
        return decorate(run, quality)
    path = folder / "summary.json"
    summary = json.loads(path.read_bytes()) if path.is_file() else None
    result = protocol.validate(run, summary)
    if run["status"] != "complete":
        result["issues"].append("Experiment has not completed")
    if run.get("mode", "trace") == "trace" and summary is None:
        result["issues"].append("No communication summary is available")
    result["valid"] = not result["issues"]
    result["protocol_valid"] = result["valid"]
    return decorate(run, result)
