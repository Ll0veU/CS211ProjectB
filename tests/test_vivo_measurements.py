"""Numerical and identity regressions for independent Vivo measurements/exports."""
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend import analyzer, resource_proc, resources, study_export


def proc_stat(pid=42, user=10, system=5, started=100):
    fields = ["S", *(["0"] * 19)]
    fields[11], fields[12], fields[19] = str(user), str(system), str(started)
    return f"{pid} (a process (with parens)) " + " ".join(fields)


class CumulativeCPUAndMemoryTests(unittest.TestCase):
    def test_system_excludes_iowait_and_guest_not_double_counted(self):
        parsed = resource_proc.system_counters("cpu 100 0 50 500 100 20 30 0 10 0\ncpu0 1 2 3 4\ncpu1 1 2 3 4\n")
        self.assertEqual(parsed, {"total": 800, "idle": 500, "iowait": 100, "cores": 2})
        old = {"total": 1000, "idle": 500, "iowait": 100, "cores": 2}
        new = {"total": 2000, "idle": 1000, "iowait": 200, "cores": 2}
        before = {42: {"name": "org.agent:worker", "stat": {"ticks": 10, "start_ticks": 100}}}
        after = {42: {"name": "org.agent:worker", "stat": {"ticks": 30, "start_ticks": 100}}}
        measured = resource_proc.cpu_difference(old, new, before, after, [], ["org.agent"])
        self.assertEqual(measured["system_cpu_reported_percent"], 40)
        self.assertEqual(measured["agent_cpu_one_core_percent"], 4)
        self.assertEqual(measured["controller_cpu_one_core_percent"], 0)

    def test_pid_reuse_invalidates_agent_only_not_system(self):
        old = {"total": 1000, "idle": 500, "iowait": 100, "cores": 2}
        new = {"total": 2000, "idle": 1000, "iowait": 200, "cores": 2}
        before = {42: {"name": "org.agent", "stat": {"ticks": 10, "start_ticks": 100}}}
        after = {42: {"name": "org.agent", "stat": {"ticks": 30, "start_ticks": 200}}}
        measured = resource_proc.cpu_difference(old, new, before, after, [], ["org.agent"])
        self.assertIsNone(measured["agent_cpu_one_core_percent"])
        self.assertEqual(measured["system_cpu_reported_percent"], 40)
        self.assertTrue(measured["reasons"])

    def test_membership_change_not_reported_as_zero_cpu(self):
        old = {"total": 1000, "idle": 500, "iowait": 100, "cores": 2}
        new = {"total": 2000, "idle": 1000, "iowait": 200, "cores": 2}
        after = {42: {"name": "org.agent", "stat": {"ticks": 30, "start_ticks": 100}}}
        measured = resource_proc.cpu_difference(old, new, {}, after, [], ["org.agent"])
        self.assertIsNone(measured["agent_cpu_one_core_percent"])

    def test_stat_comm_parentheses_do_not_shift_fields(self):
        self.assertEqual(resource_proc.process_counters(proc_stat()), {"pid": 42, "ticks": 15, "start_ticks": 100})

    def test_pid_pss_and_missing_counters_preserve_evidence(self):
        probe = resource_proc.Probe("phone", ["org.agent"])
        calls = []

        def read(*args):
            calls.append(args)
            data = {("ps", "-A", "-o", "PID,ARGS"): "PID ARGS\n42 org.agent:worker",
                    ("cat", "/proc/stat"): "permission denied",
                    ("cat", "/proc/42/stat"): proc_stat(),
                    ("cat", "/proc/42/cmdline"): "org.agent:worker\0",
                    ("dumpsys", "meminfo", "-s", "42"): "** MEMINFO in pid 42 [org.agent:worker] **\nTOTAL PSS: 456"}
            return {"text": data.get(args, ""), "error": None}

        with patch.object(probe, "read", side_effect=read):
            sample = probe.sample(0)
        self.assertEqual(sample["agent_pss_kib"], 456)
        self.assertEqual(sample["controller_pss_kib"], 0)
        self.assertIsNone(sample["cpu"]["system_cpu_reported_percent"])
        self.assertFalse(sample["cpu"]["counters_available"])
        self.assertIn(("dumpsys", "meminfo", "-s", "42"), calls)
        self.assertNotIn(("dumpsys", "meminfo", "-s", "org.agent"), calls)

    def test_first_snapshot_baseline_is_not_a_zero_cpu_interval(self):
        run = {"id": "test", "mode": "resource_agent", "duration_seconds": 300, "sample_interval_seconds": 15}
        baseline = {"observer": resource_proc.VERSION, "agent_present": True, "controller_present": False,
                    "cpu": {"baseline": True, "reasons": [], **{key: None for key in resource_proc.CPU_FIELDS}},
                    "probe_wall_seconds": 1, "agent_pss_kib": 100, "controller_pss_kib": 0, "system_used_kib": 500,
                    "battery": {"powered": True, "status": 2, "simulated": False}, "battery_read_offset_seconds": 0, "raw": {}}
        sample = {**baseline, "battery_read_offset_seconds": 300,
                  "cpu": {"baseline": False, "reasons": [], **{key: 4 for key in resource_proc.CPU_FIELDS}}}
        summary = resources.summarize(run, [baseline, sample], 301, True)
        self.assertEqual(summary["observer"], resource_proc.VERSION)
        self.assertEqual(summary["metrics"]["agent_cpu_one_core_percent"]["samples"], 1)
        self.assertIsNone(summary["metrics"]["agent_cpu_one_core_percent"]["median"])
        self.assertEqual(summary["cpu_rejected_samples"], 0)


class StudyExportTests(unittest.TestCase):
    def test_bundle_excludes_credentials_preserves_bytes_and_marks_partial_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / ("a" * 32)
            folder.mkdir()
            metadata = {"id": folder.name, "status": "complete", "workload": "W1", "mode": "trace",
                        "target_package": "org.agent", "markers": [], "outcome": "success", "created_at": "2026-11-18T00:00:00+00:00",
                        "device_label": "vivo-x80", "conditions": "test", "repetition": 1}
            original = json.dumps(metadata).encode()
            (folder / "metadata.json").write_bytes(original)
            (folder / "capture.pftrace").write_bytes(b"raw-fixture")
            (folder / ".access-token").write_text("secret")
            (root / ".access-token").write_text("secret")
            data = study_export.bundle(root)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.assertFalse(any("token" in name for name in archive.namelist()))
                self.assertEqual(archive.read(f"runs/{folder.name}/metadata.json"), original)
                manifest = json.loads(archive.read("manifest.sha256.json"))
                for name, digest in manifest.items():
                    self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), digest)
                report = archive.read("report.zh-CN.md").decode()
                self.assertIn("进行中", report)
                self.assertIn("Not a formal record", report)
            self.assertEqual((folder / "metadata.json").read_bytes(), original)
