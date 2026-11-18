"""Describe resource evidence independently of experimental comparability."""
from datetime import datetime


def numeric_range(values):
    values = [value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool)]
    return {"min": min(values), "max": max(values)} if values else None


def command_errors(raw):
    """Count failed commands separately, skipping only the documented memory alias."""
    errors = []

    def visit(value, path):
        if not isinstance(value, dict):
            return
        if "error" in value:
            if value.get("error"):
                errors.append({"command": path, "error": value["error"]})
            return
        for key, child in value.items():
            if not path and key == "agent_memory" and "agent_memory_by_package" in value:
                continue
            visit(child, f"{path}/{key}" if path else key)

    visit(raw, "")
    return errors


def describe(samples, summary, trace_bytes=None):
    errors = [{"sample": index, **error} for index, sample in enumerate(samples)
              for error in command_errors(sample.get("raw", {}))]
    temperatures = [sample.get("battery", {}).get("temperature_tenths_c") for sample in samples]
    levels = [100 * sample["battery"]["level"] / sample["battery"]["scale"] for sample in samples
              if sample.get("battery", {}).get("level") is not None and sample["battery"].get("scale", 0) > 0]
    return {"sample_count": len(samples),
            "cpu_valid_intervals": {key: metric["samples"] for key, metric in summary["metrics"].items() if "cpu" in key},
            "cpu_rejected_samples": summary.get("cpu_rejected_samples", 0),
            "raw_command_error_count": len(errors), "raw_command_errors": errors,
            "temperature_c": numeric_range([value / 10 for value in temperatures if value is not None]),
            "battery_level_percent": numeric_range(levels),
            "battery_window_seconds": summary["battery"].get("window_seconds"),
            "observer_wall_seconds": summary.get("observer_wall_seconds"), "trace_bytes": trace_bytes,
            "observer": summary.get("observer"),
            "note": "Diagnostic/transport wall time is not CPU time and cannot be subtracted from device CPU or energy"}


def pair_context(arms):
    """Annotate time/temperature mismatches without deleting inconvenient outcomes."""
    times, ranges, run_details = [], [], {}
    for mode, (run, summary) in arms.items():
        time = run.get("recording_at") or run.get("created_at")
        try:
            times.append(datetime.fromisoformat(time).timestamp())
        except (TypeError, ValueError):
            pass
        details = summary.get("sampling_quality", {})
        temperature = details.get("temperature_c")
        if temperature:
            ranges.extend([temperature["min"], temperature["max"]])
        run_details[mode] = {"id": run["id"], "start": time, "sampling_quality": details,
                             "notes": run.get("notes", "")}
    gap = max(times) - min(times) if len(times) == len(arms) else None
    span = max(ranges) - min(ranges) if len(ranges) == len(arms) * 2 else None
    warnings = []
    if gap is None:
        warnings.append("pair_time_unknown")
    elif gap > 1800:
        warnings.append("pair_time_gap")
    if span is None:
        warnings.append("pair_temperature_unknown")
    elif span > 2:
        warnings.append("pair_temperature_span")
    return {"start_gap_seconds": gap, "temperature_span_c": span, "warnings": warnings,
            "thresholds": {"time_gap_seconds": 1800, "temperature_span_c": 2},
            "runs": run_details, "policy": "Descriptive flags only; no automatic removal or causal conclusion"}
