"""Pair only compatible resource arms and retain signed, missing-aware deltas."""
import json
import statistics
from collections import defaultdict
from . import resource_quality
from .resource_contracts import MODES, VERSION


def compare(root):
    buckets, excluded, comparisons = defaultdict(lambda: defaultdict(list)), [], []
    for path in sorted(root.glob("*/metadata.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        if run.get("mode") not in MODES:
            continue
        if run.get("protocol_version") and (run.get("phase") != "formal" or not run.get("scope_confirmed")
                or run.get("superseded_by_trial") or not run.get("conditions_confirmed")
                or not run.get("idle_undisturbed") or run.get("deviations", "").strip()):
            excluded.append({"id": run.get("id"), "issues": ["Pilot, superseded attempt, or unreviewed protocol/scope"]})
            continue
        summary_path = path.with_name("resources_summary.json")
        if run.get("status") != "complete" or run.get("outcome") != "success" or not summary_path.is_file():
            excluded.append({"id": run.get("id"), "issues": ["Requires completed capture and confirmed scenario success"]})
            continue
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        if "sampling_quality" not in summary:
            raw_path = path.with_name("resources.json")
            samples = json.loads(raw_path.read_text(encoding="utf-8")).get("samples", []) if raw_path.is_file() else []
            summary["sampling_quality"] = resource_quality.describe(samples, summary, run.get("trace_bytes"))
        issues = list(summary["issues"])
        identity = run.get("resource_identity")
        if not identity or not run.get("device_label") or not run.get("conditions"):
            issues.append("Missing device, conditions or version evidence")
        if run.get("mode") == "resource_trace" and not path.with_name("capture.pftrace").is_file():
            issues.append("Traced arm has no captured trace")
        if issues:
            excluded.append({"id": run["id"], "issues": issues})
            continue
        key = (run["device_label"], run["conditions"], run.get("agent_id", run["target_package"]), run["workload"],
               run["repetition"], run["duration_seconds"], run["sample_interval_seconds"], run["settle_seconds"],
               json.dumps(identity, sort_keys=True), summary["observer"], run.get("campaign_id"), run.get("attempt", 1))
        buckets[key][run["mode"]].append((run, summary))
    for key, arms in buckets.items():
        if any(len(arms[mode]) != 1 for mode in MODES):
            excluded.append({"device": key[0], "conditions": key[1], "repetition": key[4],
                             "issues": ["Need exactly one valid run in each of the three arms"],
                             "run_ids": [run["id"] for entries in arms.values() for run, _ in entries]})
            continue
        measurements = {}
        for mode in MODES:
            _, summary = arms[mode][0]
            measurements[mode] = {name: value["median"] for name, value in summary["metrics"].items()}
            measurements[mode].update({name: summary["battery"][name] for name in (
                "charge_used_uah", "estimated_energy_mwh", "estimated_mean_power_mw")})
        differences = {}
        for name, base, measured in (("controller", MODES[0], MODES[1]), ("tracing", MODES[1], MODES[2]), ("total", MODES[0], MODES[2])):
            differences[name] = {}
            for metric, baseline in measurements[base].items():
                value = measurements[measured][metric]
                differences[name][metric] = {"baseline": baseline, "measured": value,
                    "delta": value - baseline if value is not None and baseline is not None else None,
                    "relative_percent": 100 * (value - baseline) / baseline if value is not None and baseline not in (None, 0) else None,
                    "reason": "Metric unavailable in one or both arms" if value is None or baseline is None
                              else "Relative change undefined for zero baseline" if baseline == 0 else None}
        comparisons.append({"device": key[0], "conditions": key[1], "agent": key[2], "workload": key[3],
                            "repetition": key[4], "duration_seconds": key[5], "sample_interval_seconds": key[6],
                            "settle_seconds": key[7], "identity": json.loads(key[8]), "observer": key[9], "campaign_id": key[10],
                            "attempt": key[11], "comparability": resource_quality.pair_context({mode: arms[mode][0] for mode in MODES}),
                            "run_ids": {mode: arms[mode][0][0]["id"] for mode in MODES}, "differences": differences})
    groups = defaultdict(list)
    for triple in comparisons:
        cohort = json.dumps({name: triple[name] for name in ("device", "conditions", "agent", "workload", "duration_seconds", "sample_interval_seconds", "settle_seconds", "identity", "observer", "campaign_id")}, sort_keys=True)
        groups[cohort].append(triple)
    aggregates = []
    for cohort, triples in groups.items():
        metrics = {}
        for kind in ("controller", "tracing", "total"):
            metrics[kind] = {}
            for metric in triples[0]["differences"][kind]:
                data = [triple["differences"][kind][metric]["delta"] for triple in triples if triple["differences"][kind][metric]["delta"] is not None]
                metrics[kind][metric] = {"valid_triplets": len(data), "median_delta": statistics.median(data) if data else None,
                                         "min_delta": min(data) if data else None, "max_delta": max(data) if data else None}
        aggregates.append({**json.loads(cohort), "triplet_count": len(triples),
                           "three_repetitions_complete": len({triple["repetition"] for triple in triples}) >= 3, "metrics": metrics})
    return {"method": VERSION, "triplets": comparisons, "groups": aggregates, "excluded": excluded,
            "limitations": ["Instrumented baseline: observer remains active in all arms",
                            "Total is full minus Agent-only for the tested controller profile; not universal overhead",
                            "Energy is estimated whole-device energy, not hardware-meter or per-app energy",
                            "Keep order counterbalanced, screen/network/temperature comparable; retain negative deltas"]}
