"""Export measured evidence with checksums and an explicitly partial study report."""
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import experiments, protocol, resource_quality

ARTIFACTS = {"metadata.json", "summary.json", "transactions.json", "transactions.csv", "timeline.csv", "edges.csv",
             "capture.pftrace", "resources.json", "resources.csv", "resources_summary.json"}


def study_report(root, locale="en", device_label=None):
    chinese = locale == "zh-CN"
    evaluation = experiments.report(root)
    rows = []
    for path in sorted(root.glob("*/metadata.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        if device_label and run.get("device_label") != device_label:
            continue
        summary_path = path.with_name("summary.json")
        resource_path = path.with_name("resources_summary.json")
        summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else None
        measured = json.loads(resource_path.read_text(encoding="utf-8")) if resource_path.is_file() else None
        quality = protocol.validate(run, summary) if run.get("mode", "trace") in ("trace", "baseline") else None
        rows.append((run, summary, measured, quality))
    selected_ids = {run["id"] for run, *_ in rows}
    triples = [triplet for triplet in evaluation["resource_overhead"]["triplets"]
               if set(triplet["run_ids"].values()) <= selected_ids]
    valid_task_ids = {run["id"] for run, _, _, quality in rows if quality and quality["valid"]
                      and run.get("phase") == "formal" and run.get("scope_confirmed") and not run.get("superseded_by_trial")
                      and run.get("status") == "complete"}
    coverage = [item for item in evaluation["coverage"] if not device_label or item["device"] == device_label]
    devices = {run.get("device_label") or run.get("serial", "unknown") for run, *_ in rows}
    matrix_devices = {cohort["device"] for cohort in evaluation["complete_cohorts"]}
    matrix_complete = bool(devices) and devices <= matrix_devices
    # A report is a view of saved evidence, never a substitute for physical acceptance.
    resource_devices = {item["device"] for item in evaluation["resource_overhead"]["groups"] if item["three_repetitions_complete"]}
    resource_complete = bool(devices) and devices <= resource_devices
    complete = bool(matrix_complete and resource_complete)
    heading = "vivo Project B 实验报告" if chinese else "Vivo Project B experimental report"
    status = "已达到数据数量门槛；仍需人工验证代表性路径和实验限制。" if complete and chinese else \
             "Dataset count gates reached; representative paths and experimental limitations still need manual review." if complete else \
             "进行中：实验矩阵尚未完成；以下仅总结已经保存的本机证据。" if chinese else \
             "IN PROGRESS: experimental matrix incomplete; this report describes saved local evidence only."
    lines = [f"# {heading}", "", status, "", f"Generated UTC: {datetime.now(timezone.utc).isoformat()}", "",
             f"Device filter: `{device_label or 'all local device cohorts (reported separately)'}`", "",
             "## 数据状态" if chinese else "## Dataset status", "",
             f"- Saved local runs: {len(rows)}",
             f"- Formal task records passing protocol/scope/capture checks: {len(valid_task_ids)}",
             f"- Resource triplets: {len(triples)}",
             f"- Two-independent-Agent W0/W1/W2 × 3 matrix: {'complete' if matrix_complete else 'pending'}",
             f"- Three resource repetitions: {'complete' if resource_complete else 'pending'}", "",
             "OPPO 队友报告仅为方法参考，未计入本机重复次数。" if chinese else
             "The teammate OPPO report is a method reference and does not count as local repetitions.", "",
             "## 全部运行与人工真值" if chinese else "## All runs and ground truth", "",
             "| Run | Device | Agent | Workload | Mode | Phase | R / attempt | Capture | Outcome | Evidence |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for run, summary, measured, quality in rows:
        issues = quality["issues"] if quality else measured.get("issues", []) if measured else ["No summary"]
        if run.get("phase") != "formal":
            issues = [*issues, "Not a formal record"]
        if not run.get("scope_confirmed"):
            issues = [*issues, "Observation scope unreviewed"]
        safe = lambda value: str(value if value is not None else "pending").replace("|", "\\|").replace("\n", " ")
        values = [run["id"], run.get("device_label"), run.get("agent_id", run.get("target_package")), run.get("workload"),
                  run.get("mode", "trace"), run.get("phase", "legacy"), f"{run.get('repetition')} / {run.get('attempt', 1)}",
                  run.get("status"), run.get("outcome"), "; ".join(issues) or "Available checks passed"]
        lines.append("| " + " | ".join(map(safe, values)) + " |")
    lines.extend(["", "## Binder 通信指标" if chinese else "## Binder communication metrics", "",
                  "| Run | Window | Requests | Incoming | Outgoing | Internal | Incoming/s | Outgoing/s | Peers | Matched sync | Median ms | p95 ms | Unknown interfaces | Unresolved endpoints |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"])
    for run, summary, _, _ in rows:
        if not summary:
            continue
        for window, measured in [("whole_trace", summary), ("task", summary.get("task_window"))]:
            if not measured:
                continue
            counts = measured["direction_counts"]
            values = [run["id"], window, measured["transaction_count"], counts.get("incoming", 0), counts.get("outgoing", 0),
                      counts.get("internal", 0), measured["rates_per_second"]["incoming"], measured["rates_per_second"]["outgoing"],
                      measured["peer_process_count"], measured["matched_sync_calls"],
                      measured["sync_latency_ms"]["median"], measured["sync_latency_ms"]["p95"],
                      measured["unidentified_interface_count"], measured["unresolved_endpoint_requests"]]
            lines.append("| " + " | ".join("unavailable" if value is None else str(value) for value in values) + " |")
    lines.extend(["", "## 资源测量" if chinese else "## Resource measurements", "",
                  "| Run | Observer | System CPU % | Agent CPU one-core % | Controller CPU one-core % | Agent PSS KiB | Controller PSS KiB | System used KiB | Charge µAh | Energy mWh | Power mW |",
                  "|---|---|---|---|---|---|---|---|---|---|---|"])
    for run, _, measured, _ in rows:
        if not measured:
            continue
        values = [run["id"], measured["observer"], *[measured["metrics"][key]["median"] for key in (
            "system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent",
            "agent_pss_kib", "controller_pss_kib", "system_used_kib")],
            *[measured["battery"][key] for key in ("charge_used_uah", "estimated_energy_mwh", "estimated_mean_power_mw")]]
        lines.append("| " + " | ".join("unavailable" if value is None else str(value) for value in values) + " |")
    lines.extend(["", "## 采样质量与环境" if chinese else "## Sampling quality and environment", "",
                  "| Run | Snapshots | Valid CPU intervals | Rejected CPU samples | Command errors | Temperature °C | Battery window s | Observer wall s | Trace bytes |",
                  "|---|---|---|---|---|---|---|---|---|"])
    for run, _, measured, _ in rows:
        if not measured:
            continue
        quality = measured.get("sampling_quality")
        if quality is None:
            raw_path = root / run["id"] / "resources.json"
            samples = json.loads(raw_path.read_text(encoding="utf-8")).get("samples", []) if raw_path.is_file() else []
            quality = resource_quality.describe(samples, measured, run.get("trace_bytes"))
        values = [run["id"], quality["sample_count"], json.dumps(quality["cpu_valid_intervals"]),
                  quality["cpu_rejected_samples"], quality["raw_command_error_count"], json.dumps(quality["temperature_c"]),
                  quality["battery_window_seconds"], quality["observer_wall_seconds"], run.get("trace_bytes")]
        lines.append("| " + " | ".join("unavailable" if value is None else str(value) for value in values) + " |")
    lines.extend(["", "## 配对差值与可比性" if chinese else "## Paired differences and comparability", ""])
    for triple in triples:
        lines.extend([f"### {triple['device']} · {triple['agent']} · R{triple['repetition']}", "",
                      "```json", json.dumps({"differences": triple["differences"], "comparability": triple.get("comparability")},
                                            ensure_ascii=False, indent=2), "```", ""])
    lines.extend(["## 探索性比较与分类" if chinese else "## Exploratory comparisons and classification", "",
                  f"Cross-Agent classification available: {evaluation['classification_available']}",
                  f"Classification coverage: {evaluation['classification_coverage']}",
                  f"Accuracy when classified: {evaluation['accuracy_when_classified']}", "",
                  "```json", json.dumps({"coverage": coverage,
                      "descriptive_groups": [group for group in evaluation["descriptive_groups"] if group["device"] in devices],
                      "excluded_runs": [record for record in evaluation["excluded_runs"] if record.get("id") in selected_ids]},
                      ensure_ascii=False, indent=2), "```", ""])
    lines.extend(["## 限制与待完成项" if chinese else "## Limitations and remaining work", "",
                  "- CPU differences use percentage points; signed deltas and unavailable metrics are retained.",
                  "- Energy is a whole-device charge/voltage estimate. Negative differences do not establish energy savings.",
                  "- Device, observer implementation, versions, prompts, input mode, thermal state and transport must remain comparable.",
                  "- Timer precision does not remove operator reaction delay. Missing historical markers are not reconstructed.",
                  "- Candidate nested Binder paths require independent manual corroboration before causal claims.",
                  "- Cross-Agent classification is exploratory; two package aliases are not two independent Agents.",
                  "- USB-powered diagnostic data is not unplugged resource evidence. Use wireless ADB for formal course captures.",
                  "", "Machine-readable coverage and exclusions: `evaluation.json`. Original records and checksums are included in the data bundle."])
    return "\n".join(lines).encode("utf-8")


def bundle(root):
    buffer = io.BytesIO()
    manifest = {}
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        def write(name, data):
            archive.writestr(name, data)
            manifest[name] = hashlib.sha256(data).hexdigest()

        for metadata in sorted(root.glob("*/metadata.json")):
            # Whitelist artifacts rather than archiving access codes, logs or arbitrary paths.
            if not re_run_id(metadata.parent.name) or not metadata.parent.resolve().is_relative_to(root.resolve()):
                continue
            for name in sorted(ARTIFACTS):
                path = metadata.with_name(name)
                if path.is_file() and not path.is_symlink():
                    write(f"runs/{metadata.parent.name}/{name}", path.read_bytes())
        for plan in sorted((root / ".campaigns").glob("*.json")):
            if re_run_id(plan.stem) and not plan.is_symlink():
                write(f"plans/{plan.name}", plan.read_bytes())
        diagnostics = root / "diagnostics"
        for diagnostic in sorted(diagnostics.rglob("*")):
            if diagnostic.is_file() and not diagnostic.is_symlink() and diagnostic.resolve().is_relative_to(diagnostics.resolve()) and (
                    diagnostic.name in ARTIFACTS or diagnostic.name == "capability.json"):
                write(f"diagnostics/{diagnostic.relative_to(diagnostics).as_posix()}", diagnostic.read_bytes())
        write("evaluation.json", json.dumps(experiments.report(root), ensure_ascii=False, indent=2).encode("utf-8"))
        write("report.en.md", study_report(root, "en"))
        write("report.zh-CN.md", study_report(root, "zh-CN"))
        source_root = Path(__file__).resolve().parents[1]
        for name in ("requirements.txt", "WORKBENCH.md", "RESOURCE_V2.md", "backend/experiment_protocol.json",
                     "backend/analyzer.py", "backend/collector.py", "backend/protocol.py", "backend/experiments.py",
                     "backend/resources.py", "backend/resource_proc.py", "backend/resource_quality.py", "backend/campaigns.py"):
            source = source_root / name
            if source.is_file():
                write(f"source/{name}", source.read_bytes())
        # Modular analysis imports must travel with the exported source snapshot.
        for source in sorted((source_root / "backend").glob("*.py")):
            name = source.relative_to(source_root).as_posix()
            if f"source/{name}" not in manifest and not source.is_symlink():
                write(f"source/{name}", source.read_bytes())
        write("manifest.sha256.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    return buffer.getvalue()


def re_run_id(value):
    return len(value) == 32 and all(character in "0123456789abcdef" for character in value)
