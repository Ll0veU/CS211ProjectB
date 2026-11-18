"""Expose a teammate's report as a cited snapshot, never as local raw evidence."""
import hashlib
import re
import statistics
from pathlib import Path


REPORT = Path(__file__).resolve().parents[1] / "weekly_report.md"
METRICS = ("system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent",
           "agent_pss_kib", "controller_pss_kib", "system_used_kib", "charge_used_uah",
           "estimated_energy_mwh", "estimated_mean_power_mw")


def table_rows(section):
    for line in section.splitlines():
        if not line.strip().startswith("|"):
            continue
        fields = [field.strip() for field in line.strip().strip("|").split("|")]
        if fields and not all(re.fullmatch(r":?-+:?", field) for field in fields):
            yield fields


def read_reference(path=REPORT):
    if not path.is_file():
        return {"available": False, "raw_data_verified": False, "runs": [], "differences": [], "quality": []}
    data = path.read_bytes()
    text = data.decode("utf-8-sig")
    runs, differences, quality = [], [], []
    section = ""
    for line in text.splitlines():
        if line.startswith("## ") or line.startswith("### "):
            section = line
        fields = next(table_rows(line), [])
        # Bind to named sections and exact column counts; never parse appendix prose as data.
        if section.startswith("## 3.") and len(fields) == 13 and fields[0].isdigit() and fields[1] in ("A", "B", "C"):
            runs.append({"repetition": int(fields[0]), "arm": fields[1], "short_id": fields[2],
                         "local_start": fields[3], "metrics": dict(zip(METRICS, map(float, fields[4:])))})
        if section.startswith("### 3.1") and len(fields) == 10 and re.fullmatch(r"\d+/[ABC]", fields[0]):
            quality.append({"trial": fields[0], "snapshots": int(fields[1]), "valid_cpu_intervals": fields[2],
                            "cpu_rejected": int(fields[3]), "raw_command_errors": int(fields[4]),
                            "temperature_c": fields[5], "battery_level_percent": fields[6],
                            "battery_window_seconds": float(fields[7]), "observer_wall_seconds": float(fields[8]),
                            "trace_bytes": int(fields[9])})
        if section.startswith("## 4.") and len(fields) == 11 and fields[0] in ("1", "3", "4", "三轮中位数"):
            differences.append({"repetition": int(fields[0]) if fields[0].isdigit() else "median",
                                "comparison": fields[1], "metrics": dict(zip(METRICS, map(float, fields[2:])))})
    # The excerpt may be copied without its archive. Make that evidence boundary explicit.
    return {"available": True, "source": path.name, "sha256": hashlib.sha256(data).hexdigest(),
            "period": "2026-11-16/2026-11-17", "timezone": "America/Los_Angeles",
            "platform": "OPPO Find X7 (PHZ110), Android 16", "observer": "adb-proc-stat-v2",
            "raw_data_verified": False, "runs": runs, "quality": quality, "differences": differences,
            "reported_triplets": [1, 3, 4], "teammate_phase_closed": True,
            "current_study": "Independent Vivo replication plus Binder experiments, exports and report",
            "limitations": ["Report snapshot only; the cited all_data.zip and OPPO raw runs are not present in this checkout",
                            "Repetition 3 arm A was delayed by nearly two hours and had substantially different temperature",
                            "Negative estimated power differences do not demonstrate energy savings",
                            "Three triplets are three repetitions, not sixty independent intervals",
                            "Report collector version alone does not prove identical implementation or measurement conditions"]}


def check_arithmetic(reference, tolerance=0.002):
    """Cross-check rounded report tables without claiming to reproduce raw measurements."""
    failures = []
    by_trial = {(row["repetition"], row["arm"]): row for row in reference["runs"]}
    by_difference = {(row["repetition"], row["comparison"]): row for row in reference["differences"]}
    checks = 0
    for (repetition, comparison), row in by_difference.items():
        if repetition == "median":
            continue
        measured, baseline = comparison.split("−")
        if (repetition, measured) not in by_trial or (repetition, baseline) not in by_trial:
            failures.append({"repetition": repetition, "comparison": comparison, "reason": "missing_arm"})
            continue
        for metric, reported in row["metrics"].items():
            computed = by_trial[repetition, measured]["metrics"][metric] - by_trial[repetition, baseline]["metrics"][metric]
            checks += 1
            if abs(computed - reported) > tolerance + 1e-9:
                failures.append({"repetition": repetition, "comparison": comparison, "metric": metric,
                                 "reported": reported, "computed": computed})
    for (repetition, comparison), row in by_difference.items():
        if repetition != "median":
            continue
        for metric, reported in row["metrics"].items():
            values = [entry["metrics"][metric] for entry in reference["differences"]
                      if entry["comparison"] == comparison and entry["repetition"] != "median"]
            checks += 1
            if not values or abs(statistics.median(values) - reported) > tolerance + 1e-9:
                failures.append({"comparison": comparison, "metric": metric, "reason": "median_mismatch"})
    return {"checks": checks, "consistent": bool(checks) and not failures, "rounding_tolerance": tolerance,
            "failures": failures, "raw_data_reproduced": False}
