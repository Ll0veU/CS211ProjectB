"""Fixed-window resource acquisition; observer parsing is supplied by resources."""
import hashlib
import re
import time
from . import collector, resources
from .analyzer import save_json
from .resource_contracts import CONTROLLER, CURRENT_OBSERVER, VERSION


def capture(run, folder, stop, update):
    serial = run["serial"]
    if run.get("protocol_version"):
        battery = resources.parse_battery(collector.adb("shell", "dumpsys", "battery", serial=serial))
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
        # The admission layer has already required explicit controller-stop acknowledgment.
        collector.adb("shell", "am", "force-stop", CONTROLLER, serial=serial)
    update(status="settling", settling_seconds=run["settle_seconds"], settling_until=time.time() + run["settle_seconds"])
    if stop.wait(run["settle_seconds"]):
        raise RuntimeError("Resource experiment stopped before measurement")
    targets = run.get("target_packages") or run["target_package"]
    if run.get("observer") == CURRENT_OBSERVER:
        from .resource_proc import Probe
        probe = Probe(serial, targets)
    else:
        probe = resources.Probe(serial, targets)
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
            resources.save(folder, run, samples, time.monotonic() - started, finished)
        if recording and recording.pid:
            trace = recording.collect(True)
    return trace
