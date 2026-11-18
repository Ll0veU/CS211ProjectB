"""Regression tests for reproducible plans and evidence-preserving protocol v2."""
import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import analyzer, campaigns, protocol, resources, server, experiments


def config_fixture():
    return {"device_label": "phone-1", "target_packages": ["com.agent", "com.host"],
            "browser_package": "com.browser", "account_label": "account-a", "gemini_mode": "standard",
            "network": "lab-wifi", "brightness": "50%", "volume": "20%", "read_aloud": "off",
            "resource_seconds": 300}


class ProtocolV2Tests(unittest.TestCase):
    def test_gemini_packages_are_one_logical_agent(self):
        aliases = ["com.google.android.apps.bard", "com.google.android.googlequicksearchbox"]
        self.assertEqual({experiments.logical_agent({"target_package": name}) for name in aliases}, {"gemini"})

    def voice_run(self, wait=60):
        # Start above JS's safe integer range to catch accidental float conversions.
        base = 10**16 + 123
        return {"workload": "W2", "protocol_version": "2.0", "outcome": "success",
                "conditions_confirmed": True, "recognized_text_available": False,
                "actual_response": "Opened the browser", "markers": [
                    {"label": label, "boottime_ns": str(base + seconds * 10**9),
                     "source": "android_elapsed_realtime"}
                    for label, seconds in (("voice_start", 0), ("voice_end", 12), ("response_complete", 12 + wait))]}

    def test_voice_timeout_starts_after_input(self):
        result = protocol.validate(self.voice_run())
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["task_duration_seconds"], 72)
        self.assertEqual(result["response_wait_seconds"], 60)
        self.assertFalse(protocol.validate(self.voice_run(61))["valid"])

    def test_legacy_voice_interpretation_is_preserved(self):
        run = self.voice_run()
        run.pop("protocol_version")
        self.assertFalse(protocol.validate(run)["valid"])

    def test_missing_w1_evidence_never_becomes_valid(self):
        result = protocol.validate({"workload": "W1", "outcome": "success", "markers": []})
        self.assertFalse(result["valid"])
        self.assertEqual(len(result["issues"]), 3)

    def test_decimal_nanoseconds_are_exact(self):
        self.assertEqual(protocol.nanoseconds("10000000000000123"), 10000000000000123)
        self.assertIsNone(protocol.nanoseconds(True))
        self.assertIsNone(protocol.nanoseconds(1.2))

    def test_marker_idempotence_and_terminal_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            runs = server.Runs(Path(folder))
            run_id = "a" * 32
            runs.folder(run_id).mkdir()
            runs.runs[run_id] = {"id": run_id, "status": "recording", "protocol_version": "2.0",
                                "workload": "W2", "mode": "trace", "markers": []}
            runs.stops[run_id] = threading.Event()
            body = {"label": "voice_start", "event_id": "unique-event-1", "boottime_ns": "10000000000000123"}
            marker = runs.marker(run_id, body)
            self.assertEqual(runs.marker(run_id, body), marker)
            self.assertEqual(len(runs.get(run_id)["markers"]), 1)
            with self.assertRaises(server.APIError):
                runs.marker(run_id, {**body, "boottime_ns": "10000000000000124"})
            runs.update(run_id, status="complete")
            self.assertEqual(runs.marker(run_id, body), marker)

    def test_union_counts_internal_request_once(self):
        request = {"id": "one", "ts_ns": 20, "sender": {"upid": 1, "process": "com.agent", "utid": 1},
                   "receiver": {"upid": 2, "process": "com.host", "utid": 2}, "type": "sync",
                   "latency_ns": 5, "interface": None, "method": None, "server_ts_ns": 20, "server_duration_ns": 5}
        selected, summary = analyzer.summarize([request], {1, 2}, 10, 100, [], [])
        self.assertEqual(len(selected), 1)
        self.assertEqual(summary["direction_counts"], {"internal": 1})
        self.assertEqual(summary["peer_process_count"], 0)


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = campaigns.Campaigns(self.root)
        self.plan = self.store.create({"name": "Test protocol", "config": config_fixture()})

    def test_six_pilots_then_eighteen_formal_slots(self):
        self.assertEqual(len(self.plan["trials"]), 6)
        formal = campaigns.make_trials("formal", 300)
        self.assertEqual(len(formal), 18)
        self.assertEqual([item["workload"] for item in formal[:9]], ["W0", "W1", "W2", "W1", "W2", "W0", "W2", "W0", "W1"])
        self.assertEqual([item["mode"] for item in formal[9:12]], list(campaigns.RESOURCE_MODES))

    def test_freeze_requires_real_pilot_records(self):
        with self.assertRaises(campaigns.CampaignError):
            self.store.freeze(self.plan["id"], {"scope_confirmed": True, "pilot_reviewed": True}, {}, lambda _: {}, self.root)

    def test_full_and_task_only_agents_share_task_conditions(self):
        second = self.store.create({"name": "Second Agent", "config": {
            **config_fixture(), "agent_id": "palmclaw", "scope": "tasks_only",
            "target_packages": ["com.palmclaw"], "gemini_mode": "provider-model",
            "account_label": "independent-account", "resource_seconds": 540}})
        self.assertEqual(self.plan["comparison_signature"], second["comparison_signature"])
        self.assertNotEqual(self.plan["config_signature"], second["config_signature"])
        for field, value in (("network", "other-wifi"), ("brightness", "60%"),
                             ("volume", "40%"), ("read_aloud", "on"),
                             ("browser_package", "com.otherbrowser")):
            with self.subTest(field=field):
                changed = self.store.create({"config": {**second["config"], field: value}})
                self.assertNotEqual(self.plan["comparison_signature"], changed["comparison_signature"])

    def test_revision_preserves_frozen_config(self):
        self.plan["state"] = "frozen"
        self.store.save(self.plan)
        revised_config = {**self.plan["config"], "resource_seconds": 540}
        revised = self.store.revise(self.plan["id"], {"config": revised_config})
        self.assertEqual(revised["parent_id"], self.plan["id"])
        self.assertEqual(revised["state"], "draft")
        self.assertEqual(self.store.get(self.plan["id"])["config"]["resource_seconds"], 300)

    def test_resource_retry_replaces_whole_block(self):
        records = {}
        for index, trial in enumerate(self.plan["trials"]):
            trial["run_ids"] = [str(index)]
            records[str(index)] = {"status": "complete"}
        self.store.save(self.plan)
        updated = self.store.retry(self.plan["id"], self.plan["trials"][3]["id"], "Charging interruption", records)
        resource_trials = [item for item in updated["trials"] if item["mode"] in campaigns.RESOURCE_MODES]
        self.assertEqual(len(resource_trials), 6)
        self.assertEqual(sum(item["superseded"] for item in resource_trials), 3)
        self.assertTrue(all(item["attempt"] == 2 for item in resource_trials if not item["superseded"]))

    def test_order_and_duplicate_start_are_rejected(self):
        with self.assertRaises(campaigns.CampaignError):
            self.store.prepare(self.plan["id"], self.plan["trials"][1]["id"], {})
        first = self.plan["trials"][0]["id"]
        self.store.attach(self.plan["id"], first, "run-1")
        with self.assertRaises(campaigns.CampaignError):
            self.store.prepare(self.plan["id"], first, {})

    def test_freeze_checks_metrics_and_versions(self):
        records = {}
        for index, trial in enumerate(self.plan["trials"]):
            run_id = str(index)
            trial["run_ids"] = [run_id]
            records[run_id] = {"outcome": "success", "identity_snapshot": {"build": "same"}}
            if trial["mode"] in campaigns.RESOURCE_MODES:
                folder = self.root / run_id
                folder.mkdir()
                analyzer.save_json(folder / "resources_summary.json", {"metrics": {
                    "agent_cpu_one_core_percent": {"median": 5}, "agent_pss_kib": {"median": 100}},
                    "battery": {"estimated_energy_mwh": None}})
                analyzer.save_json(folder / "resources.json", {"samples": [{"battery": {"temperature_tenths_c": 290}}]})
        self.plan["comparison_signature"] = "legacy-derived-cohort"
        original_config_signature = self.plan["config_signature"]
        original_records = copy.deepcopy(records)
        self.store.save(self.plan)
        body = {"scope_confirmed": True, "pilot_reviewed": True, "energy_unresolved_ack": True}
        frozen = self.store.freeze(self.plan["id"], body, records, lambda _: {"valid": False, "protocol_valid": True}, self.root)
        self.assertEqual(len(frozen["trials"]), 24)
        self.assertEqual(frozen["temperature_baseline_c"], 29)
        self.assertNotEqual(frozen["comparison_signature"], "legacy-derived-cohort")
        self.assertEqual(frozen["config_signature"], original_config_signature)
        self.assertEqual(records, original_records)
        self.assertEqual(frozen["comparison_signature_version"], 2)
        self.assertTrue(any(entry["event"] == "comparison_signature_updated" for entry in frozen["audit"]))
        self.assertEqual(self.store.freeze(self.plan["id"], body, records, lambda _: {}, self.root), frozen)


class ResourceScopeTests(unittest.TestCase):
    def test_cpu_deduplicates_pid(self):
        result = resources.parse_cpu("CPU usage from 20000ms to 0ms ago\n 10% 42/com.agent:worker: x\n 10% 42/com.agent:worker: x\n 5% 43/com.host:search: x\n 15% TOTAL: x", ["com.agent", "com.host"])
        self.assertEqual(result["agent_cpu_one_core_percent"], 15)

    def test_pss_retains_process_identity(self):
        parsed = resources.pss_by_pid("** MEMINFO in pid 42 [com.agent] **\nTOTAL PSS: 120\n** MEMINFO in pid 43 [com.host] **\nTOTAL PSS: 200")
        self.assertEqual(parsed, {42: 120, 43: 200})

    def test_partial_group_memory_stays_unavailable(self):
        def read(*args):
            if args[0] == "ps": return {"text": "PID ARGS\n42 com.agent\n43 com.host", "error": None}
            if args[:3] == ("dumpsys", "meminfo", "-s") and args[-1] == "com.agent":
                return {"text": "** MEMINFO in pid 42 [com.agent] **\nTOTAL PSS: 120", "error": None}
            return {"text": "", "error": None}
        probe = resources.Probe("phone", ["com.agent", "com.host"])
        with patch.object(probe, "read", side_effect=read):
            sample = probe.sample(0)
        self.assertIsNone(sample["agent_pss_kib"])
        self.assertEqual(sample["per_package"]["com.agent"]["pss_kib"], 120)


if __name__ == "__main__":
    unittest.main()
