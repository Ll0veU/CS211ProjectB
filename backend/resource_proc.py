"""Cumulative CPU counters and identity-checked per-PID PSS for stock phones.

This implements the report's measurement definitions independently. It is not a
copy of the teammate collector, and its implementation fingerprint is exported.
"""
import re
import statistics
import time
from collections import defaultdict

from . import resources, resource_quality

VERSION = "adb-proc-stat-v2"
IMPLEMENTATION = "projectb-proc-counter-1"
CPU_FIELDS = ("system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent")


def system_counters(text):
    match = re.search(r"^cpu\s+((?:\d+\s+){3,}\d+)\s*$", text, re.M)
    if not match:
        return None
    values = list(map(int, match[1].split()))
    if len(values) < 5:
        return None
    # guest/guest_nice are already included in user/nice and must not be added twice.
    total = sum(values[:8])
    cores = len(re.findall(r"^cpu\d+\s", text, re.M))
    return {"total": total, "idle": values[3], "iowait": values[4], "cores": cores} if cores else None


def process_counters(text):
    start, end = text.find("("), text.rfind(")")
    if start < 0 or end <= start:
        return None
    try:
        fields = text[end + 1:].split()
        return {"pid": int(text[:start].strip()), "ticks": int(fields[11]) + int(fields[12]),
                "start_ticks": int(fields[19])}
    except (ValueError, IndexError):
        return None


def cpu_difference(previous, current, previous_processes, current_processes, names, targets):
    result = {field: None for field in CPU_FIELDS}
    result.update(per_package={package: None for package in targets}, baseline=previous is None,
                  reasons=[], method=VERSION, counters_available=current is not None)
    if previous is None:
        return result
    if current is None or previous["cores"] != current["cores"]:
        result["reasons"].append("System counters unavailable or CPU count changed")
        return result
    total = current["total"] - previous["total"]
    idle = current["idle"] - previous["idle"]
    iowait = current["iowait"] - previous["iowait"]
    if total <= 0 or min(idle, iowait) < 0 or idle + iowait > total:
        result["reasons"].append("System counters reset or did not advance")
        return result
    result["system_cpu_reported_percent"] = 100 * (total - idle - iowait) / total

    def group(packages):
        if previous_processes is None or current_processes is None or names is None:
            return None
        old = {pid: process for pid, process in previous_processes.items()
               if any(resources.belongs(process["name"], package) for package in packages)}
        new = {pid: process for pid, process in current_processes.items()
               if any(resources.belongs(process["name"], package) for package in packages)}
        if old.keys() != new.keys():
            result["reasons"].append("Process membership changed during CPU interval")
            return None
        ticks = 0
        for pid, process in new.items():
            before, after = old[pid].get("stat"), process.get("stat")
            if not before or not after or before["start_ticks"] != after["start_ticks"] or after["ticks"] < before["ticks"]:
                result["reasons"].append("Process CPU identity unavailable, exited or PID reused")
                return None
            ticks += after["ticks"] - before["ticks"]
        # Normalize against average cumulative ticks per logical core. CPU hotplug
        # invalidates the interval above rather than silently changing its units.
        return 100 * ticks * current["cores"] / total

    result["agent_cpu_one_core_percent"] = group(targets)
    result["controller_cpu_one_core_percent"] = group([resources.CONTROLLER])
    result["per_package"] = {package: group([package]) for package in targets}
    result["reasons"] = sorted(set(result["reasons"]))
    return result


class Probe(resources.Probe):
    def __init__(self, serial, target):
        super().__init__(serial, target)
        self.previous_system = None
        self.previous_processes = None
        self.previous_offset = None

    def sample(self, start):
        before = time.monotonic()
        raw = {"processes": self.read("ps", "-A", "-o", "PID,ARGS"),
               "cpu": self.read("cat", "/proc/stat")}
        processes = resources.parse_processes(raw["processes"]["text"])
        system = system_counters(raw["cpu"]["text"])
        cpu_offset = time.monotonic() - start
        selected = None if processes is None else {
            process["pid"]: {"name": process["name"]} for process in processes
            if any(resources.belongs(process["name"], package) for package in [*self.targets, resources.CONTROLLER])}
        memory, raw_processes = {}, {}
        for pid, process in (selected or {}).items():
            responses = {"identity": self.read("cat", f"/proc/{pid}/stat"),
                         "cmdline": self.read("cat", f"/proc/{pid}/cmdline"),
                         "memory": self.read("dumpsys", "meminfo", "-s", str(pid)),
                         "identity_after": self.read("cat", f"/proc/{pid}/stat")}
            raw_processes[str(pid)] = responses
            first = process_counters(responses["identity"]["text"])
            last = process_counters(responses["identity_after"]["text"])
            command = responses["cmdline"]["text"].split("\0", 1)[0]
            identity_valid = bool(first and last and first["pid"] == last["pid"] == pid
                                  and first["start_ticks"] == last["start_ticks"] and command == process["name"])
            process["stat"] = first if identity_valid else None
            header = re.search(r"MEMINFO in pid (\d+)", responses["memory"]["text"])
            memory[pid] = resources.parse_pss(responses["memory"]["text"]) if (
                identity_valid and header and int(header[1]) == pid) else None
        raw["per_pid"] = raw_processes
        cpu = cpu_difference(self.previous_system, system, self.previous_processes, selected, processes, self.targets)
        cpu["interval_start_seconds"] = self.previous_offset
        cpu["interval_end_seconds"] = cpu_offset
        self.previous_system, self.previous_processes, self.previous_offset = system, selected, cpu_offset

        def present(packages):
            return None if processes is None else any(any(resources.belongs(process["name"], package) for package in packages)
                                                      for process in processes)

        def pss(packages):
            if selected is None:
                return None
            values = [memory[pid] for pid, process in selected.items()
                      if any(resources.belongs(process["name"], package) for package in packages)]
            return sum(values) if all(value is not None for value in values) else None

        raw["system_memory"] = self.read("cat", "/proc/meminfo")
        raw["battery"] = self.read("dumpsys", "battery")
        battery_offset = time.monotonic() - start
        return {"observer": VERSION, "implementation": IMPLEMENTATION, "offset_seconds": before - start,
                "cpu_read_offset_seconds": cpu_offset, "battery_read_offset_seconds": battery_offset,
                "probe_wall_seconds": time.monotonic() - before, "processes": processes,
                "agent_present": present(self.targets), "controller_present": present([resources.CONTROLLER]),
                "cpu": cpu, "agent_pss_kib": pss(self.targets), "controller_pss_kib": pss([resources.CONTROLLER]),
                "system_used_kib": resources.parse_memory(raw["system_memory"]["text"]),
                "battery": resources.parse_battery(raw["battery"]["text"]), "raw": raw,
                "per_package": {package: {"present": present([package]), "pss_kib": pss([package]),
                                          "cpu_one_core_percent": cpu["per_package"][package]} for package in self.targets}}


def summarize(run, samples, elapsed, finished_normally):
    values, package_values, issues, rejected = defaultdict(list), defaultdict(lambda: defaultdict(list)), [], []
    expected = run["mode"] != "resource_agent"
    for sample in samples:
        if sample["agent_present"] is not True:
            issues.append("Target process not confirmed throughout the window")
        if sample["controller_present"] is not expected:
            issues.append("Controller process presence does not match the selected arm")
        if sample["probe_wall_seconds"] > run["sample_interval_seconds"]:
            issues.append("Observer takes longer than the configured sample interval")
        for key in ("agent_pss_kib", "controller_pss_kib", "system_used_kib"):
            if sample[key] is not None:
                values[key].append(sample[key])
        cpu = sample["cpu"]
        if not cpu["baseline"]:
            if cpu["reasons"]:
                rejected.append(cpu["reasons"])
            for key in CPU_FIELDS:
                if cpu[key] is not None:
                    values[key].append(cpu[key])
        for package, readings in sample.get("per_package", {}).items():
            for key in ("pss_kib", "cpu_one_core_percent"):
                if readings[key] is not None and (key != "cpu_one_core_percent" or not cpu["baseline"]):
                    package_values[package][key].append(readings[key])
    if not finished_normally:
        issues.append("Fixed measurement window was interrupted")
    if elapsed < run["duration_seconds"]:
        issues.append("Measurement window shorter than requested")
    if len(samples) < 2:
        issues.append("Fewer than two samples")

    def metric(data):
        return {"median": statistics.median(data) if len(data) >= 2 else None, "peak": max(data) if data else None,
                "samples": len(data), "reason": None if len(data) >= 2 else "Need at least two available, valid intervals/samples"}

    summary = {"observer": VERSION, "implementation": IMPLEMENTATION, "run_id": run["id"], "mode": run["mode"],
               "requested_seconds": run["duration_seconds"], "elapsed_seconds": elapsed, "sample_count": len(samples),
               "metrics": {key: metric(values[key]) for key in (*CPU_FIELDS, "agent_pss_kib", "controller_pss_kib", "system_used_kib")},
               "per_package": {package: {key: metric(data) for key, data in readings.items()}
                               for package, readings in package_values.items()},
               "battery": resources.battery_summary(samples), "issues": sorted(set(issues)),
               "cpu_rejected_samples": len(rejected), "cpu_rejection_reasons": sorted({reason for reasons in rejected for reason in reasons}),
               "observer_wall_seconds": sum(sample["probe_wall_seconds"] for sample in samples),
               "limitations": ["First snapshot is a baseline, not a valid CPU interval",
                               "System CPU excludes idle and iowait; process CPU is normalized to one logical core",
                               "Changed process membership, PID reuse and unreadable identities leave group CPU unavailable",
                               "Short-lived or isolated workers without package identity may be missed",
                               "Proc counters are not atomic across processes; acquisition times and raw diagnostics are retained",
                               "Observer is present in every arm; battery energy is whole-device estimated energy",
                               "No OPPO voltage conversion is applied to the Vivo device"]}
    summary["sampling_quality"] = resource_quality.describe(samples, summary, run.get("trace_bytes"))
    return summary
