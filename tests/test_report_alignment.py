"""Check report provenance, task-only plans and comparability without real devices."""
import json
import tempfile
import unittest
from pathlib import Path

from backend import campaigns, report_reference, resource_quality, resources
import test_resources as fixtures
from test_workbench import config_fixture


class TaskOnlyPlanTests(unittest.TestCase):
    def test_task_only_freeze_does_not_require_or_create_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = campaigns.Campaigns(root)
            config = {**config_fixture(), "scope": "tasks_only", "agent_id": "second-agent"}
            plan = store.create({"config": config})
            self.assertEqual(len(plan["trials"]), 3)
            records = {}
            for index, trial in enumerate(plan["trials"]):
                trial["run_ids"] = [str(index)]
                records[str(index)] = {"outcome": "success", "identity_snapshot": {"build": "same"}}
            store.save(plan)
            frozen = store.freeze(plan["id"], {"scope_confirmed": True, "pilot_reviewed": True}, records,
                                  lambda _: {"valid": True, "protocol_valid": True}, root)
            self.assertEqual(len(frozen["trials"]), 12)
            self.assertTrue(all(trial["mode"] == "trace" for trial in frozen["trials"]))
            self.assertEqual(frozen["config"]["agent_id"], "second-agent")
            prepared = store.prepare(plan["id"], frozen["trials"][3]["id"], {})
            self.assertEqual(prepared["agent_id"], "second-agent")

    def test_invalid_scope_and_agent_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = campaigns.Campaigns(Path(directory))
            for override in ({"scope": "unknown"}, {"agent_id": "Two Agents"}, {"agent_id": "../agent"}):
                with self.subTest(override=override), self.assertRaises(campaigns.CampaignError):
                    store.create({"config": {**config_fixture(), **override}})

    def test_common_cohort_ignores_identity_but_not_network_or_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            store = campaigns.Campaigns(Path(directory))
            first = store.create({"config": {**config_fixture(), "agent_id": "gemini", "scope": "tasks_only"}})
            second_config = {**config_fixture(), "agent_id": "second-agent", "target_packages": ["org.second"],
                             "gemini_mode": "other-model", "scope": "tasks_only"}
            second = store.create({"config": second_config})
            self.assertEqual(first["comparison_signature"], second["comparison_signature"])
            self.assertNotEqual(first["config_signature"], second["config_signature"])
            self.assertNotIn("Gemini", second["protocol"]["workloads"]["W0"]["instructions"]["en"])
            changed = store.create({"config": {**second_config, "network": "other-wifi"}})
            self.assertNotEqual(first["comparison_signature"], changed["comparison_signature"])

    def test_renaming_gemini_cannot_establish_second_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            store = campaigns.Campaigns(Path(directory))
            with self.assertRaises(campaigns.CampaignError) as error:
                store.create({"config": {**config_fixture(), "agent_id": "second-agent",
                                         "target_packages": ["com.google.android.googlequicksearchbox"]}})
            self.assertEqual(error.exception.code, "agent_alias")


class ReferenceTests(unittest.TestCase):
    def test_report_values_do_not_become_raw_run_evidence(self):
        text = """# Teammate report
## 3. metrics
|1|C|abcd1234|11-17 01:18:46|5.845|3.381|0.469|346564|116610|5875272|18000|68.578|827.723|
### 3.1 sampling
|1/C|21|20/20/20|0|0|30.5–30.7|42–43|298.265|41.301|6671891|
## 4. differences
|三轮中位数|C−B|1.095|0.122|-0.001|60503|1648|104796|-2000|-8.697|-105.207|
## Appendix
|1|C|not-a-run|anything|5|3|1|2|3|4|5|6|7|
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.md"
            path.write_text(text, encoding="utf-8")
            report = report_reference.read_reference(path)
            self.assertEqual(len(report["runs"]), 1)
            self.assertEqual(len(report["quality"]), 1)
            self.assertEqual(report["differences"][0]["metrics"]["estimated_mean_power_mw"], -105.207)
            self.assertFalse(report["raw_data_verified"])
            self.assertEqual(len(report["sha256"]), 64)
            self.assertEqual(path.read_text(encoding="utf-8"), text)

    def test_missing_report_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(report_reference.read_reference(Path(directory) / "absent.md")["available"])

    def test_arithmetic_catches_changed_sign_without_rewriting_data(self):
        reference = {"runs": [{"repetition": 1, "arm": "B", "metrics": {"power": 1000}},
                               {"repetition": 1, "arm": "C", "metrics": {"power": 900}}],
                     "differences": [{"repetition": 1, "comparison": "C−B", "metrics": {"power": 100}}]}
        result = report_reference.check_arithmetic(reference)
        self.assertFalse(result["consistent"])
        self.assertEqual(result["failures"][0]["computed"], -100)
        self.assertEqual(reference["differences"][0]["metrics"]["power"], 100)


class QualityContextTests(unittest.TestCase):
    def test_identical_errors_in_two_commands_count_as_two(self):
        error = {"text": "", "error": "device offline"}
        raw = {"cpu": error, "processes": error, "agent_memory": error,
               "agent_memory_by_package": {"com.agent": error}}
        result = resource_quality.command_errors(raw)
        self.assertEqual(len(result), 3)
        self.assertEqual({item["command"] for item in result}, {"cpu", "processes", "agent_memory_by_package/com.agent"})

    def test_delayed_cold_arm_flagged_without_removing_signed_deltas(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = fixtures.ResourceComparisonTests()
            for mode, value, hour, temperature in zip(resources.MODES, (10, 12, 11), (20, 18, 18), (26, 33, 31)):
                folder = helper.write_arm(root, mode, value)
                run = json.loads((folder / "metadata.json").read_text())
                run["created_at"] = f"2026-11-17T{hour:02d}:00:00+00:00"
                (folder / "metadata.json").write_text(json.dumps(run))
                summary = json.loads((folder / "resources_summary.json").read_text())
                summary["sampling_quality"]["temperature_c"] = {"min": temperature, "max": temperature}
                (folder / "resources_summary.json").write_text(json.dumps(summary))
            result = resources.compare(root)
            self.assertEqual(len(result["triplets"]), 1)
            triple = result["triplets"][0]
            self.assertEqual(triple["differences"]["tracing"]["system_cpu_reported_percent"]["delta"], -1)
            self.assertIn("pair_time_gap", triple["comparability"]["warnings"])
            self.assertIn("pair_temperature_span", triple["comparability"]["warnings"])
            self.assertEqual(triple["comparability"]["start_gap_seconds"], 7200)

    def test_different_observers_never_pool_aggregate_groups(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = fixtures.ResourceComparisonTests()
            for repetition, observer in ((1, "adb-dumpsys-v1"), (2, "adb-proc-stat-v2")):
                for mode in resources.MODES:
                    folder = helper.write_arm(root, mode, 10, f"-r{repetition}")
                    run = json.loads((folder / "metadata.json").read_text())
                    run["repetition"] = repetition
                    (folder / "metadata.json").write_text(json.dumps(run))
                    summary = json.loads((folder / "resources_summary.json").read_text())
                    summary["observer"] = observer
                    (folder / "resources_summary.json").write_text(json.dumps(summary))
            result = resources.compare(root)
            self.assertEqual(len(result["triplets"]), 2)
            self.assertEqual(len(result["groups"]), 2)
            self.assertEqual({group["observer"] for group in result["groups"]}, {"adb-dumpsys-v1", "adb-proc-stat-v2"})

    def test_sampling_quality_keeps_missing_temperature_and_errors(self):
        samples = [fixtures.sample_fixture(150), fixtures.sample_fixture(300)]
        samples[1]["raw"] = {"cpu": {"error": "device offline", "text": ""}}
        summary = resources.summarize(fixtures.run_fixture(), samples, 301, True)
        quality = summary["sampling_quality"]
        self.assertIsNone(quality["temperature_c"])
        self.assertEqual(quality["raw_command_error_count"], 1)
        self.assertEqual(quality["cpu_valid_intervals"]["system_cpu_reported_percent"], 2)
        self.assertEqual(quality["raw_command_errors"][0]["sample"], 1)
