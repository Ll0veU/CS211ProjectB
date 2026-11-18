import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import proc_resources as pc, resources
import test_resources


def snapshot(ticks=(100, 0, 100, 800, 0, 0, 0, 0), at=1, task_ticks=20):
    return {"system": {"boot": 1, "ticks": list(ticks)}, "clock_ticks": 100,
            "agent": {"42": {"start_ticks": 200, "ticks": task_ticks, "at": at}}, "controller": {}}


class CounterTests(unittest.TestCase):
    def test_system_and_process_deltas(self):
        a = snapshot()
        b = snapshot((110, 0, 120, 860, 10, 0, 0, 0), 6, 70)
        r = pc.cpu_delta(a, b)
        self.assertEqual(r[pc.METRICS[0]], 30)  # 60 idle, 10 iowait excluded.
        self.assertEqual(r[pc.METRICS[1]], 10)  # 50 ticks / 100 / 5s, one core.
        self.assertEqual(r[pc.METRICS[2]], 0)
        self.assertIsNone(pc.cpu_delta(None, a)[pc.METRICS[1]])

    def test_guest_not_counted_twice(self):
        r = pc.parse_system("cpu 100 0 20 50 10 0 0 0 80 0\r\nbtime 123\r\n")
        self.assertEqual(sum(r["ticks"]), 180)
        self.assertEqual(r["boot"], 123)
        self.assertIsNone(pc.parse_system("Permission denied"))

    def test_pid_restart_population_change_denial_and_counter_reset(self):
        a = snapshot()
        for change in ("restart", "new", "exit", "denied", "reset", "clock", "reboot"):
            b = snapshot(at=6, task_ticks=30)
            if change == "restart": b["agent"]["42"]["start_ticks"] = 201
            if change == "new": b["agent"]["43"] = b["agent"]["42"].copy()
            if change == "exit": b["agent"] = {}
            if change == "denied": b["agent"] = None
            if change == "reset": b["agent"]["42"]["ticks"] = 10
            if change == "clock": b["clock_ticks"] = None
            if change == "reboot": b["system"]["boot"] = 2
            with self.subTest(change=change): self.assertIsNone(pc.cpu_delta(a,b)[pc.METRICS[1]])

    def test_comm_parentheses_and_field_offsets(self):
        fields = ["S"] + ["0"] * 21
        fields[11], fields[12], fields[19] = "661", "683", "43280874"
        text = "6828 (odd name) with ) brackets) " + " ".join(fields)
        r = pc.parse_task(text, 6828, "org.agent:search")
        self.assertEqual((r["ticks"], r["start_ticks"]), (1344, 43280874))
        self.assertIsNone(pc.parse_task(text, 1, "org.agent"))

    def test_identity_rechecked_not_truncated_comm(self):
        def read(*args):
            if args[0] == "getconf": return {"text":"100", "error":None}
            if args == ("cat", "/proc/stat"): return {"text":"cpu 1 2 3 4 5 6 7 8\nbtime 1", "error":None}
            return {"text":"42 (org.agent) S " + "0 " * 21 + "\norg.other\0", "error":None}
        r = pc.Counters(read,"org.agent","org.controller").sample([{"pid":42,"name":"org.agent"}],{})
        self.assertIsNone(r["counters"]["agent"])

    def test_voltage_requires_recognized_device_or_standard_units(self):
        battery = {"voltage_mv":4}
        text = "POWER_SUPPLY_PRESENT=1\nPOWER_SUPPLY_TYPE=Battery\nPOWER_SUPPLY_MODEL_NAME=oplus battery\nPOWER_SUPPLY_VOLTAGE_NOW=4121"
        path = "/sys/devices/platform/soc/soc:oplus,mms_gauge/oplus_mms/gauge/battery"
        r=pc.voltage(battery,text.replace("\n","\r\n"),"PHZ110",path)
        self.assertEqual(r["voltage_mv"],4121)
        self.assertEqual(r["voltage_unit"],"mV")
        self.assertIsNone(pc.voltage(battery,text,"unknown",path)["voltage_mv"])
        self.assertIsNone(pc.voltage(battery,text,"PHZ110","unknown")["voltage_mv"])
        self.assertEqual(pc.voltage(battery,text.replace("4121","4121000"),"unknown","")["voltage_mv"],4121)
        self.assertEqual(pc.voltage({"voltage_mv":4000},text,"unknown","")["voltage_mv"],4000)

    def test_preflight_rejects_charging_and_wrong_foreground(self):
        good="AC powered: false\nUSB powered: false\nWireless powered: false\nstatus: 3"
        for battery, foreground in [(good.replace("USB powered: false","USB powered: true"),"org.agent"), (good,"org.other")]:
            with patch.object(resources.collector,"adb",side_effect=[battery,"topResumedActivity=ActivityRecord{123 u0 "+foreground+"/.Main t1}"]):
                with self.assertRaises(RuntimeError): resources.check_start("phone","org.agent")
        with patch.object(resources.collector,"adb",side_effect=[good,"topResumedActivity=ActivityRecord{123 u0 org.agent/.Main t1}"]):
            self.assertIn("battery",resources.check_start("phone","org.agent"))

    def test_methods_do_not_pool_in_aggregate(self):
        import json
        helper=test_resources.ResourceComparisonTests()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for repetition,method in ((1,"adb-dumpsys-v1"),(2,"adb-proc-stat-v2")):
                for mode in resources.MODES:
                    folder=helper.write_arm(root,mode,10,str(repetition))
                    p=folder/"metadata.json";r=json.loads(p.read_text());r["repetition"]=repetition;p.write_text(json.dumps(r))
                    p=folder/"resources_summary.json";s=json.loads(p.read_text());s["observer"]=method;p.write_text(json.dumps(s))
            groups=resources.compare(root)["groups"]
            self.assertEqual(len(groups),2)
            self.assertEqual({g["observer"] for g in groups},{"adb-dumpsys-v1","adb-proc-stat-v2"})

    def test_memory_sums_suffixed_processes_and_rejects_partial_reads(self):
        probe=resources.Probe("phone","org.agent")
        tasks=[{"pid":42,"name":"org.agent:a"},{"pid":43,"name":"org.agent:b"}]
        replies=[{"text":"** MEMINFO in pid 42 [org.agent:a] **\n TOTAL PSS: 100", "error":None},
                 {"text":"** MEMINFO in pid 43 [org.agent:b] **\n TOTAL PSS: 200", "error":None}]
        with patch.object(probe,"read",side_effect=replies):
            self.assertEqual(probe.memory("org.agent",tasks,{},"agent_memory"),300)
        for invalid in ({"text":"No process found", "error":None}, {"text":"** MEMINFO in pid 43 [org.other] **\n TOTAL PSS: 200", "error":None}):
            with patch.object(probe,"read",side_effect=[replies[0],invalid]):
                self.assertIsNone(probe.memory("org.agent",tasks,{},"agent_memory"))
