"""Read-only cumulative CPU counters and explicitly identified battery voltage sources."""
import re
import time

METRICS = ("system_cpu_reported_percent", "agent_cpu_one_core_percent", "controller_cpu_one_core_percent")
VOLTAGE_REFERENCE = "https://github.com/oppo-source/android_kernel_modules_oppo_mt6989/blob/oppo_mt6989_u_14.0.1_oppo_find_x7/vendor/oplus/kernel/charger/v2/oplus_chg_gki.c#L528"


def parse_system(text):
    text = text.replace("\r\n", "\n")
    match = re.search(r"^cpu\s+(.+)$", text, re.M)
    boot = re.search(r"^btime\s+(\d+)$", text, re.M)
    if not match or not boot:
        return None
    try:
        ticks = [int(v) for v in match[1].split()[:8]]
        if len(ticks) != 8 or any(v < 0 for v in ticks):
            return None
        return {"ticks": ticks, "boot": int(boot[1])}
    except ValueError:
        return None


def parse_task(text, expected_pid, expected_name):
    # comm can contain spaces and parentheses and is truncated by the kernel.
    match = re.match(r"(\d+) \(.*\) (.+)", text.splitlines()[0] if text else "")
    if not match or int(match[1]) != expected_pid:
        return None
    fields = match[2].split()
    try:
        return {"pid": expected_pid, "name": expected_name, "start_ticks": int(fields[19]),
                "ticks": int(fields[11]) + int(fields[12])}
    except (ValueError, IndexError):
        return None


def cpu_delta(previous, current):
    out = {k: None for k in METRICS}
    out.update(method="proc-stat-v2", reasons={}, baseline=previous is None)
    if previous is None:
        out["reasons"] = {k: "First snapshot establishes the counter baseline" for k in METRICS}
        return out
    a, b = previous.get("system"), current.get("system")
    if a and b and a["boot"] == b["boot"]:
        delta = [y - x for x, y in zip(a["ticks"], b["ticks"])]
        if min(delta) >= 0 and sum(delta) > 0:
            # First eight counters only: guest is already counted in user/nice.
            # CPU busy excludes idle AND iowait; version is separate from dumpsys-v1.
            out[METRICS[0]] = 100 * (sum(delta) - delta[3] - delta[4]) / sum(delta)
    if out[METRICS[0]] is None:
        out["reasons"][METRICS[0]] = "Missing, reset, rebooted or non-increasing system counters"
    for group, metric in (("agent", METRICS[1]), ("controller", METRICS[2])):
        old, new = previous.get(group), current.get(group)
        hz = current.get("clock_ticks")
        if not a or not b or a["boot"] != b["boot"] or old is None or new is None or not hz or hz != previous.get("clock_ticks"):
            out["reasons"][metric] = "Missing process counters, clock rate or boot identity"
            continue
        if set(old) != set(new) or any(old[k]["start_ticks"] != new[k]["start_ticks"] for k in old):
            out["reasons"][metric] = "Process set changed or PID reused; rebaseline this interval"
            continue
        value = 0.0
        for pid, task in new.items():
            elapsed = task["at"] - old[pid]["at"]
            ticks = task["ticks"] - old[pid]["ticks"]
            if elapsed <= 0 or ticks < 0:
                value = None
                break
            value += 100 * ticks / hz / elapsed
        out[metric] = value
        if value is None:
            out["reasons"][metric] = "Invalid process interval or counter reset"
    return out


class Counters:
    def __init__(self, read, target, controller):
        self.read, self.target, self.controller = read, target, controller
        self.previous = None
        self.hz = None
        self.setup = {}

    def sample(self, processes, raw):
        if not self.setup:
            self.setup["clock_ticks"] = self.read("getconf", "CLK_TCK")
            value = self.setup["clock_ticks"]["text"].strip()
            self.hz = int(value) if value.isdigit() and int(value) > 0 else None
        raw["counter_setup"] = self.setup
        raw["cpu"] = self.read("cat", "/proc/stat")
        current = {"system": parse_system(raw["cpu"]["text"]), "clock_ticks": self.hz}
        for group, package in (("agent", self.target), ("controller", self.controller)):
            tasks = {} if processes is not None else None
            if processes is not None:
                selected = [p for p in processes if p["name"] == package or p["name"].startswith(package + ":")]
                for p in selected:
                    pid = p["pid"]
                    before = time.monotonic()
                    # Full cmdline validates package attribution independently of truncated comm.
                    result = self.read("cat", f"/proc/{pid}/stat", f"/proc/{pid}/cmdline")
                    after = time.monotonic()
                    raw[f"proc_{pid}"] = result
                    lines = result["text"].splitlines()
                    task = parse_task(result["text"], pid, p["name"])
                    cmdline = lines[1].split("\0")[0] if len(lines) > 1 else ""
                    if result["error"] or task is None or cmdline != p["name"]:
                        tasks = None
                        break
                    task.update(at=(before + after) / 2, read_wall_seconds=after - before)
                    tasks[str(pid)] = task
            current[group] = tasks
        output = cpu_delta(self.previous, current)
        output["counters"] = current
        self.previous = current
        return output


def voltage(battery, sysfs_text, model, realpath):
    """Never scale arbitrary 4-digit sysfs values by magnitude alone."""
    result = dict(battery)
    result.update(voltage_source="dumpsys_battery_mv", voltage_raw=battery.get("voltage_mv"),
                  voltage_unit="mV", voltage_note=None)
    value = battery.get("voltage_mv")
    if value is not None and 2000 <= value <= 6000:
        return result
    fields = {k: v.strip() for k, v in re.findall(r"^([A-Z_]+)=(.*)$", sysfs_text, re.M)}
    raw = fields.get("POWER_SUPPLY_VOLTAGE_NOW", "").strip()
    result.update(voltage_mv=None, voltage_raw=raw, voltage_source="sysfs_battery", voltage_unit=None,
                  voltage_note="No verified voltage source/unit")
    if not raw.isdigit() or fields.get("POWER_SUPPLY_PRESENT") != "1":
        return result
    value = int(raw)
    if 2000000 <= value <= 6000000 and fields.get("POWER_SUPPLY_TYPE") == "Battery":
        result.update(voltage_mv=value / 1000, voltage_unit="uV", voltage_note="Linux power_supply ABI")
    elif (model == "PHZ110" and "soc:oplus,mms_gauge/oplus_mms/gauge/battery" in realpath
          and fields.get("POWER_SUPPLY_MODEL_NAME") == "oplus battery" and 2000 <= value <= 6000):
        result.update(voltage_mv=value, voltage_unit="mV", voltage_source="oppo_phz110_mtk_gauge_mv",
                      voltage_note="Device-specific MTK branch: GAUGE_ITEM_VOL_MAX is exported without x1000; source corroborated, not hardware calibrated",
                      voltage_reference=VOLTAGE_REFERENCE)
    return result
