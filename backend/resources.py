"""Common ADB observer for three-arm resource experiments on stock Android.

The observer is present in every arm. Deltas are instrumented comparisons,
not a claim that ADB/dumpsys has no cost. No battery-stat resets or root.
"""
import csv
import hashlib
import json
import re
import statistics
import time
from collections import defaultdict

from . import collector, resource_quality
from .analyzer import save_json

CONTROLLER = "edu.cs211.projectb"
MODES = ("resource_agent", "resource_controller", "resource_trace")
VERSION = "adb-dumpsys-v1"
CURRENT_OBSERVER = "adb-proc-stat-v2"


def belongs(name, package):
    return name == package or name.startswith(package + ":")


def parse_processes(text):
    lines = text.strip().splitlines()
    if not lines or not re.match(r"\s*PID\s+", lines[0]):
        return None
    result = []
    for line in lines[1:]:
        fields = line.split(None, 1)
        if len(fields) == 2 and fields[0].isdigit():
            result.append({"pid": int(fields[0]), "name": fields[1].split()[0]})
    return result


def parse_cpu(text, target):
    window = re.search(r"CPU usage from (\d+)ms to (\d+)ms ago", text)
    awake = re.search(r"with (\d+)% awake", text)
    total = re.search(r"^\s*([\d.]+)% TOTAL:", text, re.M)
    processes = [{"pid": int(pid), "name": name, "percent": float(percent)}
                 for percent, pid, name in re.findall(
                     r"^\s*[+-]?\s*([\d.]+)% (\d+)/(\S+):\s", text, re.M)]
    def group(package):
        values = {process["pid"]: process["percent"] for process in processes if belongs(process["name"], package)}
        return sum(values.values()) if values else None  # An omitted process is not an observed zero.
    targets = target if isinstance(target, list) else [target]
    by_package = {package: group(package) for package in targets}
    selected = {process["pid"]: process["percent"] for process in processes
                if any(belongs(process["name"], package) for package in targets)}
    return {"from_ago_ms": int(window[1]) if window else None,
            "to_ago_ms": int(window[2]) if window else None,
            "system_cpu_reported_percent": float(total[1]) if total else None,
            "agent_cpu_one_core_percent": sum(selected.values()) if selected else None,
            "per_package": by_package,
            "controller_cpu_one_core_percent": group(CONTROLLER), "processes": processes,
            "awake_percent": int(awake[1]) if awake else 100 if window else None,
            "window_label": re.search(r"CPU usage from[^\n]+", text)[0] if window else None}


def parse_pss(text):
    # Summary and detail may both be printed; count each process only once.
    blocks = re.split(r"\*\* MEMINFO in pid \d+ \[[^\]]+\] \*\*", text)
    totals = []
    for block in blocks[1:] if len(blocks) > 1 else blocks:
        match = re.search(r"TOTAL PSS:\s*(\d+)", block)
        if not match:
            match = re.search(r"^\s*TOTAL\s+(\d+)\s", block, re.M)
        if match:
            totals.append(int(match[1]))
    return sum(totals) if totals else None


def pss_by_pid(text):
    """Keep process identities so package reports cannot double-count a PID."""
    parts = re.split(r"\*\* MEMINFO in pid (\d+) \[[^\]]+\] \*\*", text)
    return {int(parts[index]): parse_pss(parts[index + 1]) for index in range(1, len(parts), 2)}


def parse_memory(text):
    fields = {k: int(v) for k, v in re.findall(r"^(MemTotal|MemAvailable):\s*(\d+) kB", text, re.M)}
    return fields["MemTotal"] - fields["MemAvailable"] if len(fields) == 2 else None


def parse_battery(text):
    def number(key):
        match = re.search(r"^\s*" + re.escape(key) + r":\s*(-?\d+)\s*$", text, re.M | re.I)
        return int(match[1]) if match else None
    power = re.findall(r"^\s*(?:AC|USB|Wireless|Dock) powered:\s*(true|false)", text, re.M | re.I)
    return {"charge_uah": number("Charge counter"), "voltage_mv": number("voltage"),
            "level": number("level"), "scale": number("scale"), "temperature_tenths_c": number("temperature"),
            "status": number("status"), "powered": any(p.lower() == "true" for p in power) if len(power) >= 3 else None,
            "simulated": "UPDATES STOPPED" in text.upper()}


class Probe:
    def __init__(self, serial, target):
        self.serial, self.target = serial, target
        self.targets = target if isinstance(target, list) else [target]

    def read(self, *args):
        try:
            return {"text": collector.adb("shell", *args, serial=self.serial, timeout=6), "error": None}
        except Exception as exc:
            return {"text": "", "error": str(exc)}

    def sample(self, start):
        before = time.monotonic()
        raw = {}
        raw["processes"] = self.read("ps", "-A", "-o", "PID,ARGS")
        processes = parse_processes(raw["processes"]["text"])
        raw["cpu"] = self.read("dumpsys", "cpuinfo")
        cpu_at = time.monotonic() - start
        memory_reports = {package: self.read("dumpsys", "meminfo", "-s", package) for package in self.targets}
        raw["agent_memory"] = memory_reports[self.targets[0]]
        raw["agent_memory_by_package"] = memory_reports
        raw["controller_memory"] = self.read("dumpsys", "meminfo", "-s", CONTROLLER)
        raw["system_memory"] = self.read("cat", "/proc/meminfo")
        raw["battery"] = self.read("dumpsys", "battery")
        battery_at = time.monotonic() - start
        controller_present = None if processes is None else any(belongs(p["name"], CONTROLLER) for p in processes)
        presence = {package: None if processes is None else any(belongs(p["name"], package) for p in processes)
                    for package in self.targets}
        agent_present = None if processes is None else any(presence.values())
        cpu = parse_cpu(raw["cpu"]["text"], self.target)
        package_memory, memory_pids, pid_reports = {}, {}, {}
        for package, report in memory_reports.items():
            package_memory[package] = 0 if presence[package] is False else parse_pss(report["text"])
            if presence[package] is False:
                cpu["per_package"][package] = 0
            pid_reports[package] = pss_by_pid(report["text"])
            memory_pids.update(pid_reports[package])
        if all(value is not None for value in cpu["per_package"].values()):
            cpu["agent_cpu_one_core_percent"] = sum({process["pid"]: process["percent"] for process in cpu["processes"]
                if any(belongs(process["name"], package) for package in self.targets)}.values())
        elif len(self.targets) > 1:
            cpu["agent_cpu_one_core_percent"] = None
        memory = None
        if all(value is not None for value in package_memory.values()):
            if len(self.targets) == 1:
                memory = package_memory[self.targets[0]]
            elif all(value == 0 for value in package_memory.values()):
                memory = 0
            elif memory_pids and all(value is not None for value in memory_pids.values()) and all(
                    presence[package] is False or pid_reports[package] for package in self.targets):
                memory = sum(memory_pids.values())
        pss = parse_pss(raw["controller_memory"]["text"])
        if controller_present is False:
            pss = 0  # ps independently confirms no process; not a missing-reading fallback.
            cpu["controller_cpu_one_core_percent"] = 0
        return {"offset_seconds": before - start, "cpu_read_offset_seconds": cpu_at,
                "battery_read_offset_seconds": battery_at, "probe_wall_seconds": time.monotonic() - before,
                "processes": processes, "agent_present": agent_present, "controller_present": controller_present,
                "cpu": cpu, "agent_pss_kib": memory,
                "per_package": {package: {"present": presence[package], "pss_kib": package_memory[package],
                    "cpu_one_core_percent": cpu["per_package"][package]} for package in self.targets},
                "controller_pss_kib": pss, "system_used_kib": parse_memory(raw["system_memory"]["text"]),
                "battery": parse_battery(raw["battery"]["text"]), "raw": raw}


def capabilities(serial, target, observer=VERSION):
    if observer == CURRENT_OBSERVER:
        from .resource_proc import Probe as CounterProbe
        probe = CounterProbe(serial, target)
    else:
        probe = Probe(serial, target)
    sample = probe.sample(time.monotonic())
    return {"observer": observer, "mutates_device": False,
            "cpu_available": sample["cpu"].get("counters_available", sample["cpu"]["system_cpu_reported_percent"] is not None),
            "agent_pss_available": sample["agent_pss_kib"] is not None,
            "system_memory_available": sample["system_used_kib"] is not None,
            "charge_counter_available": (sample["battery"]["charge_uah"] or 0) > 0,
            "controller_present": sample["controller_present"], "sample": sample,
            "note": "Snapshot availability only; CPU freshness and discharge resolution are checked during each run."}


def summarize(run, samples, elapsed, finished_normally):
    if samples and samples[0].get("observer") == CURRENT_OBSERVER:
        from .resource_proc import summarize as summarize_counters
        return summarize_counters(run, samples, elapsed, finished_normally)
    interval = run["sample_interval_seconds"]
    issues, values, cpu_rejections = [], defaultdict(list), []
    package_values = defaultdict(lambda: defaultdict(list))
    expect_controller = run["mode"] != "resource_agent"
    previous_cpu_end = -1.0
    for s in samples:
        if s["controller_present"] is not expect_controller:
            issues.append("Controller process presence does not match the selected arm")
        if s["agent_present"] is not True:
            issues.append("Target process not confirmed throughout the window")
        if s["probe_wall_seconds"] > interval:
            issues.append("Observer takes longer than the configured sample interval")
        for name in ("agent_pss_kib", "controller_pss_kib", "system_used_kib"):
            if s[name] is not None:
                values[name].append(s[name])
        for package, readings in s.get("per_package", {}).items():
            if readings.get("pss_kib") is not None:
                package_values[package]["pss_kib"].append(readings["pss_kib"])
        cpu = s["cpu"]
        if cpu.get("awake_percent", 100) != 100:
            cpu_rejections.append("CPU window includes device sleep or unknown awake state")
            continue
        old, new = cpu["from_ago_ms"], cpu["to_ago_ms"]
        if old is None or new is None or old <= new:
            cpu_rejections.append("CPU time window unavailable")
            continue
        left = s["cpu_read_offset_seconds"] - old / 1000
        right = s["cpu_read_offset_seconds"] - new / 1000
        if left < 0 or new > interval * 2000 or left < previous_cpu_end - .25:
            cpu_rejections.append("CPU window predates this run, is stale, or overlaps an accepted window")
            continue
        previous_cpu_end = right
        for package, readings in s.get("per_package", {}).items():
            if readings.get("cpu_one_core_percent") is not None:
                package_values[package]["cpu_one_core_percent"].append(readings["cpu_one_core_percent"])
        for name in ("system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent"):
            if cpu[name] is not None:
                values[name].append(cpu[name])
    if not finished_normally:
        issues.append("Fixed measurement window was interrupted")
    if len(samples) < 2:
        issues.append("Fewer than two samples")
    if elapsed < run["duration_seconds"]:
        issues.append("Measurement window shorter than requested")
    metrics = {}
    for name in ("system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent",
                 "agent_pss_kib", "controller_pss_kib", "system_used_kib"):
        data = values[name]
        metrics[name] = {"median": statistics.median(data) if len(data) >= 2 else None,
                         "peak": max(data) if data else None, "samples": len(data),
                         "reason": None if len(data) >= 2 else "Need at least two available, valid samples"}
    battery = battery_summary(samples)
    summary = {"observer": VERSION, "run_id": run["id"], "mode": run["mode"],
            "elapsed_seconds": elapsed, "requested_seconds": run["duration_seconds"],
            "sample_count": len(samples), "issues": sorted(set(issues)),
            "metrics": metrics, "battery": battery,
            "per_package": {package: {metric: {"median": statistics.median(data) if len(data) >= 2 else None,
                                              "samples": len(data), "peak": max(data) if data else None}
                                      for metric, data in measurements.items()}
                            for package, measurements in package_values.items()},
            "cpu_rejected_samples": len(cpu_rejections), "cpu_rejection_reasons": sorted(set(cpu_rejections)),
            "observer_wall_seconds": sum(s["probe_wall_seconds"] for s in samples),
            "limitations": ["Same ADB/dumpsys observer is active in all arms; its cost is not subtracted",
                            "CPU values are medians of accepted dumpsys windows, not integrated CPU time",
                            "System CPU includes I/O wait; process CPU uses one-core normalization and can exceed 100%",
                            "Package-shaped process names may miss shared or isolated workers; PSS is sampled",
                            "Battery energy is a whole-device charge-times-voltage estimate, not per-app measured energy"]}
    summary["sampling_quality"] = resource_quality.describe(samples, summary, run.get("trace_bytes"))
    return summary


def battery_summary(samples):
    result = {"charge_used_uah": None, "estimated_energy_mwh": None, "estimated_mean_power_mw": None,
              "level_drop_percentage_points": None, "window_seconds": None, "reason": None}
    if len(samples) < 2:
        result["reason"] = "Need at least two battery samples"
        return result
    batteries = [s["battery"] for s in samples]
    first, last = batteries[0], batteries[-1]
    seconds = samples[-1]["battery_read_offset_seconds"] - samples[0]["battery_read_offset_seconds"]
    result["window_seconds"] = seconds
    if any(b["simulated"] or b["powered"] is not False or b["status"] != 3 for b in batteries):
        result["reason"] = "Need real, unplugged, discharging readings throughout the run"
        return result
    if first["level"] is not None and last["level"] is not None and first["scale"] and last["scale"]:
        result["level_drop_percentage_points"] = 100 * (first["level"] / first["scale"] - last["level"] / last["scale"])
    if seconds < 120:
        result["reason"] = "Battery window shorter than 120 seconds; use a longer repeated/idle scenario"
        return result
    if any(not b["charge_uah"] or b["charge_uah"] < 0 or b["charge_uah"] >= 2**31 - 1 for b in batteries):
        result["reason"] = "Charge counter unsupported or invalid"
        return result
    charges = [b["charge_uah"] for b in batteries]
    if any(b > a for a, b in zip(charges, charges[1:])):
        result["reason"] = "Charge increased during discharge; counter is unsuitable for this interval"
        return result
    used = charges[0] - charges[-1]
    if used == 0:
        result["reason"] = "No charge change resolved; this does not mean zero energy cost"
        return result
    result["charge_used_uah"] = used
    if any(not b["voltage_mv"] or not 2000 <= b["voltage_mv"] <= 6000 for b in batteries):
        result["reason"] = "Voltage unavailable or outside supported single-cell range; charge only"
        return result
    # Integrate successive observed charge steps at mean endpoint voltage.
    energy = sum((a["charge_uah"] - b["charge_uah"]) * (a["voltage_mv"] + b["voltage_mv"]) / 2e6
                 for a, b in zip(batteries, batteries[1:]))
    result.update(estimated_energy_mwh=energy, estimated_mean_power_mw=energy * 3600 / seconds)
    return result


def save(folder, run, samples, elapsed, finished_normally):
    summary = summarize(run, samples, elapsed, finished_normally)
    save_json(folder / "resources.json", {"observer": summary["observer"], "run_id": run["id"], "samples": samples})
    save_json(folder / "resources_summary.json", summary)
    fields = ["offset_seconds", "probe_wall_seconds", "agent_pss_kib", "controller_pss_kib", "system_used_kib",
              "system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent",
              "charge_uah", "voltage_mv", "level", "status", "powered"]
    with (folder / "resources.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fields)
        writer.writeheader()
        for sample in samples:
            flat = {**sample, **sample["cpu"], **sample["battery"]}
            writer.writerow({key: flat.get(key) for key in fields})
    return summary


def capture(run, folder, stop, update):
    """Called only after resource-mode validation; never called by legacy runs."""
    serial = run["serial"]
    if run.get("protocol_version"):
        battery = parse_battery(collector.adb("shell", "dumpsys", "battery", serial=serial))
        if battery["powered"] is not False:
            raise RuntimeError("Confirm the phone is unplugged before resource recording")
        temperature = battery["temperature_tenths_c"]
        baseline = run.get("temperature_baseline_c")
        if baseline is not None and temperature is not None and abs(temperature / 10 - baseline) > 2:
            raise RuntimeError("Wait until the phone is within 2 degrees C of the pilot temperature")
        update(resource_preflight={"battery": battery, "temperature_control_available": temperature is not None})
        if run["mode"] != "resource_agent":
            services = collector.adb("shell", "dumpsys", "activity", "services", CONTROLLER, serial=serial)
            if re.search(r"ServiceRecord\{[^\n]*(?:ExperimentMarkerService|FloatingMarkersService)", services):
                raise RuntimeError("Stop marker services using the controller resource-profile button before B/C")
    if run["mode"] == "resource_agent":
        # Explicit UI acknowledgment is required by the server; only our controller is stopped.
        collector.adb("shell", "am", "force-stop", CONTROLLER, serial=serial)
    update(status="settling", settling_seconds=run["settle_seconds"],
           settling_until=time.time() + run["settle_seconds"])
    if stop.wait(run["settle_seconds"]):
        raise RuntimeError("Resource experiment stopped before measurement")
    targets = run.get("target_packages") or run["target_package"]
    if run.get("observer") == CURRENT_OBSERVER:
        from .resource_proc import Probe as CounterProbe
        probe = CounterProbe(serial, targets)
    else:
        probe = Probe(serial, targets)
    fingerprint = collector.adb("shell", "getprop", "ro.build.fingerprint", serial=serial)
    version = collector.package_details(serial, run["target_package"])
    controller_version = collector.package_details(serial, CONTROLLER)
    update(resource_identity={"build": fingerprint, "agent": version, "controller": controller_version,
                              "target_packages": run.get("target_packages", [run["target_package"]]),
                              "identity_snapshot": run.get("identity_snapshot"),
                              "trace_config_sha256": hashlib.sha256(collector.CONFIG.read_bytes()).hexdigest()})
    recording = collector.Recording(run, folder) if run["mode"] == "resource_trace" else None
    samples, started, finished, trace = [], None, False, None
    try:
        if recording:
            # Include observer startup/finalization margin without silently cutting the fixed window.
            recording.duration = run["duration_seconds"] + 45
            recording.start()
        started = time.monotonic()
        update(status="recording", resource_started_at=time.time())
        deadline = started + run["duration_seconds"]
        while True:
            samples.append(probe.sample(started))
            save_json(folder / "resources.json", {"observer": run.get("observer", VERSION), "run_id": run["id"], "samples": samples})
            if time.monotonic() >= deadline:
                finished = not stop.is_set()
                break
            next_tick = min(deadline, started + len(samples) * run["sample_interval_seconds"])
            if stop.wait(max(0, next_tick - time.monotonic())):
                break
        update(status="collecting")
    finally:
        if started is not None:
            save(folder, run, samples, time.monotonic() - started, finished)
        if recording and recording.pid:
            trace = recording.collect(True)
    return trace


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
        if any(len(arms[m]) != 1 for m in MODES):
            excluded.append({"device": key[0], "conditions": key[1], "repetition": key[4],
                             "issues": ["Need exactly one valid run in each of the three arms"],
                             "run_ids": [r["id"] for entries in arms.values() for r, _ in entries]})
            continue
        measurements = {}
        for mode in MODES:
            _, summary = arms[mode][0]
            measurements[mode] = {k: v["median"] for k, v in summary["metrics"].items()}
            measurements[mode].update({k: summary["battery"][k] for k in (
                "charge_used_uah", "estimated_energy_mwh", "estimated_mean_power_mw")})
        differences = {}
        for name, base, measured in (("controller", MODES[0], MODES[1]),
                                     ("tracing", MODES[1], MODES[2]), ("total", MODES[0], MODES[2])):
            differences[name] = {}
            for metric, b in measurements[base].items():
                m = measurements[measured][metric]
                differences[name][metric] = {"baseline": b, "measured": m,
                    "delta": m - b if m is not None and b is not None else None,
                    "relative_percent": 100 * (m - b) / b if m is not None and b not in (None, 0) else None,
                    "reason": "Metric unavailable in one or both arms" if m is None or b is None
                              else "Relative change undefined for zero baseline" if b == 0 else None}
        comparisons.append({"device": key[0], "conditions": key[1], "agent": key[2], "workload": key[3],
                            "repetition": key[4], "duration_seconds": key[5],
                            "sample_interval_seconds": key[6], "settle_seconds": key[7],
                            "identity": json.loads(key[8]), "observer": key[9], "campaign_id": key[10],
                            "attempt": key[11],
                            "comparability": resource_quality.pair_context({mode: arms[mode][0] for mode in MODES}),
                            "run_ids": {mode: arms[mode][0][0]["id"] for mode in MODES}, "differences": differences})
    groups = defaultdict(list)
    for triple in comparisons:
        cohort = json.dumps({k: triple[k] for k in ("device", "conditions", "agent", "workload", "duration_seconds",
                                                   "sample_interval_seconds", "settle_seconds", "identity", "observer", "campaign_id")}, sort_keys=True)
        groups[cohort].append(triple)
    aggregates = []
    for cohort, triples in groups.items():
        metrics = {}
        for kind in ("controller", "tracing", "total"):
            metrics[kind] = {}
            for metric in triples[0]["differences"][kind]:
                data = [t["differences"][kind][metric]["delta"] for t in triples
                        if t["differences"][kind][metric]["delta"] is not None]
                metrics[kind][metric] = {"valid_triplets": len(data),
                    "median_delta": statistics.median(data) if data else None,
                    "min_delta": min(data) if data else None, "max_delta": max(data) if data else None}
        aggregates.append({**json.loads(cohort), "triplet_count": len(triples),
                           "three_repetitions_complete": len({t["repetition"] for t in triples}) >= 3,
                           "metrics": metrics})
    return {"method": VERSION, "triplets": comparisons, "groups": aggregates, "excluded": excluded,
            "limitations": ["Instrumented baseline: observer remains active in all arms",
                            "Total is full minus Agent-only for the tested controller profile; not universal overhead",
                            "Energy is estimated whole-device energy, not hardware-meter or per-app energy",
                            "Keep order counterbalanced, screen/network/temperature comparable; retain negative deltas"]}
