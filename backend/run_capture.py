"""Capture worker lifecycle independent of HTTP transport and operator event handling."""
import hashlib
import time
from . import analyzer, collector, resources
from .contracts import now
from .source_identity import backend_hashes


def capture_run(store, run_id, stop):
    stage = "preparing"
    try:
        run = store.get(run_id)
        folder = store.folder(run_id)
        serial, package = run["serial"], run["target_package"]
        packages = collector.packages(serial)
        if package not in packages:
            raise RuntimeError("Target package is not installed for the current Android user.")
        store.update(run_id, target_uid=packages[package], packages=packages,
                     android_sdk=collector.adb("shell", "getprop", "ro.build.version.sdk", serial=serial))
        if run.get("protocol_version"):
            names = list(dict.fromkeys([*run["target_packages"], resources.CONTROLLER, run["condition_profile"]["browser_package"]]))
            identity = {"build": collector.adb("shell", "getprop", "ro.build.fingerprint", serial=serial).strip(),
                        "packages": [collector.package_details(serial, name) for name in sorted(names)],
                        "backend_sha256": backend_hashes(),
                        "trace_config_sha256": hashlib.sha256(collector.CONFIG.read_bytes()).hexdigest()}
            store.update(run_id, identity_snapshot=identity)
            run["identity_snapshot"] = identity
            settings = {}
            for name, args in {"model": ("getprop", "ro.product.model"),
                               "brightness": ("settings", "get", "system", "screen_brightness"),
                               "automatic_brightness": ("settings", "get", "system", "screen_brightness_mode")}.items():
                try:
                    settings[name] = collector.adb("shell", *args, serial=serial).strip()
                except Exception as error:
                    settings[name] = {"unavailable": str(error)}
            settings["battery"] = resources.parse_battery(collector.adb("shell", "dumpsys", "battery", serial=serial))
            store.update(run_id, device_conditions_snapshot=settings)
            campaign = store.campaigns.get(run["campaign_id"])
            if run["phase"] == "formal" and identity != campaign.get("identity_snapshot"):
                raise RuntimeError("Device/application identity changed after protocol freeze; create a revision")
        if run.get("mode") in resources.MODES:
            stage = "resources"
            trace = resources.capture(run, folder, stop, lambda **changes: store.update(run_id, **changes))
            store.update(run_id, status="complete", finished_at=now(), trace_bytes=trace.stat().st_size if trace else None)
            return
        recording = collector.Recording(run, folder)
        baseline = run.get("mode") == "baseline"
        if run.get("protocol_version"):
            store.update(run_id, status="awaiting_controller")
            deadline = time.monotonic() + 180
            while not store.ready_events[run_id].wait(.25):
                if stop.is_set() or time.monotonic() >= deadline:
                    raise RuntimeError("Phone marker readiness was cancelled or timed out")
        if not baseline:
            recording.start()
        stage = "recording"
        store.update(run_id, status=stage, recording_at=now())
        deadline = time.monotonic() + run["duration_seconds"] + 2
        while not stop.wait(.4) and time.monotonic() < deadline and (baseline or recording.running()):
            pass
        if baseline:
            store.update(run_id, status="complete", finished_at=now())
            return
        stage = "collecting"
        store.update(run_id, status=stage)
        trace = recording.collect(stop.is_set())
        store.update(run_id, trace_bytes=trace.stat().st_size)
        stage = "analyzing"
        store.update(run_id, status=stage)
        started = time.monotonic()
        analyzer.export(folder, *analyzer.analyze(trace, store.get(run_id)))
        store.update(run_id, status="complete", finished_at=now(), analysis_wall_seconds=time.monotonic() - started)
    except Exception as exc:
        store.update(run_id, status="failed", failed_stage=stage, error=str(exc), finished_at=now())
    finally:
        with store.lock:
            store.stops.pop(run_id, None)
            store.ready_events.pop(run_id, None)
