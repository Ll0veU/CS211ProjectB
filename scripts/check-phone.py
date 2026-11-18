"""Save a reproducible device capability check, optionally including a short trace.

All output stays under diagnostics and is excluded from formal repetitions.
Charging is allowed for this diagnostic, but never establishes usable energy data.
"""
import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import analyzer, collector, resource_proc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--packages", nargs="+", default=["com.google.android.apps.bard", "com.google.android.googlequicksearchbox"])
    parser.add_argument("--trace-seconds", type=int, choices=range(5, 31), metavar="5..30")
    args = parser.parse_args()
    installed = collector.packages(args.serial)
    if any(package not in installed for package in args.packages):
        parser.error("Every selected observation package must be installed")
    run_id = uuid.uuid4().hex
    folder = args.runs / "diagnostics" / run_id
    folder.mkdir(parents=True)
    probe = resource_proc.Probe(args.serial, args.packages)
    started = time.monotonic()
    samples = [probe.sample(started)]
    time.sleep(2)
    samples.append(probe.sample(started))
    capability = {"created_at": datetime.now(timezone.utc).isoformat(), "observer": resource_proc.VERSION,
                  "implementation": resource_proc.IMPLEMENTATION, "serial": args.serial,
                  "model": collector.adb("shell", "getprop", "ro.product.model", serial=args.serial),
                  "versions": [collector.package_details(args.serial, package) for package in args.packages],
                  "automatic_brightness": collector.adb("shell", "settings", "get", "system", "screen_brightness_mode", serial=args.serial),
                  "brightness": collector.adb("shell", "settings", "get", "system", "screen_brightness", serial=args.serial),
                  "samples": samples, "formal_eligible": False}
    analyzer.save_json(folder / "capability.json", capability)
    result = {"folder": str(folder), "cpu": samples[-1]["cpu"], "agent_pss_kib": samples[-1]["agent_pss_kib"],
              "battery": samples[-1]["battery"], "formal_eligible": False}
    if args.trace_seconds:
        run = {"id": run_id, "serial": args.serial, "status": "preparing", "mode": "trace", "phase": "diagnostic",
               "target_package": args.packages[0], "target_packages": args.packages, "packages": installed,
               "target_uid": installed[args.packages[0]], "duration_seconds": args.trace_seconds,
               "workload": "W0", "markers": [], "outcome": None, "scope_confirmed": False,
               "created_at": capability["created_at"], "notes": "Device preflight only; no task performed; not an experimental repetition"}
        analyzer.save_json(folder / "metadata.json", run)
        try:
            recorder = collector.Recording(run, folder)
            recorder.start()
            trace = recorder.collect(False)
            transactions, summary = analyzer.analyze(trace, run)
            analyzer.export(folder, transactions, summary)
            run.update(status="complete", trace_bytes=trace.stat().st_size)
            result["trace"] = {"bytes": trace.stat().st_size, "seconds": summary["trace_duration_seconds"],
                               "requests": summary["transaction_count"], "warnings": summary["warnings"]}
        except Exception as error:
            run.update(status="failed", error=str(error))
            raise
        finally:
            run["finished_at"] = datetime.now(timezone.utc).isoformat()
            analyzer.save_json(folder / "metadata.json", run)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
