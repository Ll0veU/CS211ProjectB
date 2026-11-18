"""Transparent features and leave-one-Agent-out classification without storage access."""
import math
import statistics

WORKLOADS = ("W0", "W1", "W2")
FEATURES = ("incoming_per_second", "outgoing_per_second", "distinct_peers", "async_fraction", "active_second_fraction")


def logical_agent(run):
    if run.get("agent_id"):
        return run["agent_id"]
    package = run["target_package"]
    return "gemini" if package in ("com.google.android.apps.bard", "com.google.android.googlequicksearchbox") else package


def features(summary):
    count = summary["transaction_count"]
    bins = summary["timeline"]
    return (summary["rates_per_second"]["incoming"] or 0, summary["rates_per_second"]["outgoing"] or 0,
            summary["peer_process_count"], summary["transaction_types"].get("async", 0) / count if count else 0,
            sum(any(bin[direction] for direction in ("incoming", "outgoing", "internal")) for bin in bins) / len(bins))


def evaluate(samples):
    predictions = []
    for agent in sorted({sample["agent"] for sample in samples}):
        training = [sample for sample in samples if sample["agent"] != agent]
        held_out = [sample for sample in samples if sample["agent"] == agent]
        groups = {workload: [sample["features"] for sample in training if sample["actual"] == workload] for workload in WORKLOADS}
        if any(not values for values in groups.values()):
            predictions.extend({**sample, "predicted": "uncertain", "reason": "Missing training workloads"} for sample in held_out)
            continue
        scales = [statistics.pstdev(column) or 1 for column in zip(*(sample["features"] for sample in training))]
        centers = {workload: [statistics.mean(column) for column in zip(*values)] for workload, values in groups.items()}
        for sample in held_out:
            distances = sorted((math.sqrt(sum(((value - center) / scale) ** 2
                               for value, center, scale in zip(sample["features"], centroid, scales))), workload)
                               for workload, centroid in centers.items())
            best, runner_up = distances[:2]
            margin = (runner_up[0] - best[0]) / max(runner_up[0], 1e-9)
            predictions.append({**sample, "predicted": best[1] if margin >= .20 else "uncertain",
                                "relative_margin": margin, "distances": {workload: distance for distance, workload in distances}})
    return predictions
