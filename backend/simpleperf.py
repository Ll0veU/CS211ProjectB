"""Optional non-root CPU sampling using the phone's preinstalled Simpleperf.

No APK repackaging, adb root, run-as installation, global pkill or device settings
changes. OEM permission failures are diagnostic results, not Binder failures.
"""
import re
import shlex
import subprocess
import threading
import time
from datetime import datetime, timezone

from . import collector
from .analyzer import save_json

VERSION = "simpleperf-cpu-clock-100hz-v1"
BINARY = "/system/bin/simpleperf"
EXPORTS = {"simpleperf.json", "simpleperf.data", "simpleperf_report.txt", "simpleperf_log.txt"}


def now():
    return datetime.now(timezone.utc).isoformat()


def capabilities(serial, package):
    """Read-only preflight. Eligible means a recording attempt is allowed, not guaranteed."""
    if not re.fullmatch(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+", package):
        raise ValueError("Invalid package")
    result = {"package": package, "eligible": False, "checks": {}, "reason": None}
    def shell(*args):
        return collector.adb("shell", *args, serial=serial, timeout=10)
    try:
        # Do not accidentally test with a privileged adbd session.
        uid = shell("id", "-u")
        result["checks"]["shell_uid"] = uid
        if uid != "2000":
            raise ValueError("Requires the normal non-root ADB shell (UID 2000)")
        result["device"] = {key: shell("getprop", prop) for key, prop in (
            ("model", "ro.product.model"), ("android", "ro.build.version.release"),
            ("sdk", "ro.build.version.sdk"), ("build", "ro.build.fingerprint"))}
        user = shell("am", "get-current-user")
        result["checks"]["android_user"] = user
        if user != "0":
            raise ValueError("This adapter currently supports the primary Android user only; no silent work-profile fallback")
        result["checks"]["version"] = shell(BINARY, "--version")
        # App runner performs the platform's actual package-policy check (Android 12+).
        app_type = shell("simpleperf_app_runner", package, "--show-app-type").strip()
        result["checks"]["app_type"] = app_type
        if app_type not in {"debuggable", "profileable"}:
            raise ValueError(f"Installed target is not shell-profileable/debuggable (app type: {app_type})")
        help_text = shell(BINARY, "help", "record")
        if "--start_profiling_fd" not in help_text or "--clockid" not in help_text:
            raise ValueError("Preinstalled Simpleperf lacks the readiness/clock options this adapter needs")
        shell("timeout", "--help")
        # A finite app wait is enforced by timeout too; avoid waiting for an unopened app.
        listing = shell("ps", "-A", "-o", "PID,NAME")
        processes = []
        for line in listing.splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[0].isdigit() and (parts[1] == package or parts[1].startswith(package + ":")):
                processes.append({"pid": int(parts[0]), "name": parts[1]})
        result["processes_before"] = processes
        if not processes:
            raise ValueError("Open the selected Agent first; no matching running process was found")
        result["eligible"] = True
        result["reason"] = "Preflight passed; actual perf-event permissions and sample availability are checked during recording"
    except Exception as exc:
        result["reason"] = str(exc)
    return result


class Recording:
    def __init__(self, run, folder, update):
        if not re.fullmatch(r"[0-9a-f]{32}", run["id"]):
            raise ValueError("Invalid run id")
        self.run, self.folder, self.update = run, folder, update
        self.remote = f"/data/local/tmp/cs211-simpleperf-{run['id']}.data"
        self.proc = self.log = self.reader = None
        self.ready = threading.Event()
        self.pid = None
        self.stdout = bytearray()
        self.finished = False
        self.stop_requested = False
        self.deadline = None
        self.result = {"adapter": VERSION, "run_id": run["id"], "package": run["target_package"],
                       "status": "pending", "reason": None, "event": "cpu-clock:u", "frequency_hz": 100,
                       "clock": "boottime", "call_graph": "dwarf", "issues": [],
                       "sample_count": None, "raw_bytes": None,
                       "limitations": ["CPU samples are not Binder transactions or total CPU utilization",
                                       "Only the selected package's accessible processes are profiled; delegated work in other packages is not included",
                                       "New zygote-created sibling processes may be absent; inspect PIDs in the report",
                                       "Missing symbols and empty samples remain unavailable; sampling adds overhead"]}

    def publish(self):
        save_json(self.folder / "simpleperf.json", self.result)
        self.update(simpleperf={k: self.result.get(k) for k in ("status", "reason", "sample_count", "raw_bytes")})

    def shell(self, *args, **kwargs):
        return collector.adb("shell", *args, serial=self.run["serial"], **kwargs)

    def _read_stdout(self):
        while True:
            byte = self.proc.stdout.read(1)
            if not byte:
                break
            if len(self.stdout) < 8192:
                self.stdout.extend(byte)
            match = re.search(rb"PROJECTB_PID=(\d+)\r?\n", self.stdout)
            if match:
                self.pid = match[1].decode()
            if b"STARTED" in self.stdout:
                self.ready.set()

    def start(self):
        try:
            self.result["preflight"] = check = capabilities(self.run["serial"], self.run["target_package"])
            if not check["eligible"]:
                self.result.update(status="unavailable", reason=check["reason"])
                self.publish()
                return
            duration = self.run["duration_seconds"] + 45
            options = [BINARY, "record", "--app", self.run["target_package"],
                       "-e", "cpu-clock:u", "-f", "100", "-g", "--clockid", "boottime",
                       "--duration", str(duration), "--size-limit", "64M",
                       "--start_profiling_fd", "1", "-o", self.remote]
            # timeout is a second bound if the target exits before Simpleperf finds it.
            # echo $$ gives the shell-owned wrapper PID, which exec preserves. Its
            # SIGINT handler stops the app-context child via Simpleperf's own pipe.
            inner = "echo PROJECTB_PID=$$; exec " + shlex.join(options)
            command = shlex.join(["timeout", "-s", "INT", str(duration + 15), "sh", "-c", inner])
            self.result.update(command=options, started_at=now(), status="starting")
            self.log = (self.folder / "simpleperf_log.txt").open("wb")
            self.proc = subprocess.Popen(["adb", "-s", self.run["serial"], "shell", "-T", command],
                                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=self.log)
            self.deadline = time.monotonic() + duration + 25
            self.reader = threading.Thread(target=self._read_stdout, daemon=True)
            self.reader.start()
            limit = time.monotonic() + 8
            while not self.ready.wait(.1) and self.proc.poll() is None and time.monotonic() < limit:
                pass
            if not self.ready.is_set() or self.proc.poll() is not None:
                self.result.update(status="unavailable", reason="Simpleperf did not confirm recording; see simpleperf_log.txt")
                self.finish()
                return
            self.result.update(status="recording", ready_at=now())
            self.publish()
        except Exception as exc:
            self.result.update(status="unavailable", reason=str(exc))
            self.finish()

    def request_stop(self):
        if self.stop_requested or self.proc is None:
            return
        self.stop_requested = True
        if self.proc.poll() is not None:
            if self.ready.is_set():
                self.result["ended_before_stop"] = True
                self.result["issues"].append("Sampler ended before the experiment stop; coverage may be partial")
            return
        try:
            if not self.pid:
                raise RuntimeError("Recorder PID unavailable; waiting for bounded recorder timeout")
            cmdline = self.shell("cat", f"/proc/{self.pid}/cmdline")
            if BINARY not in cmdline or self.remote not in cmdline:
                raise RuntimeError("Recorder PID ownership could not be verified; no signal sent")
            self.shell("kill", "-INT", self.pid)
            self.result["stop_requested_at"] = now()
        except Exception as exc:
            self.result["issues"].append(str(exc))

    def finish(self):
        if self.finished:
            return
        self.finished = True
        try:
            if self.proc is None:
                return
            self.request_stop()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.result["issues"].append("Graceful stop delayed; waiting for the recorder's finite timeout")
                self.proc.wait(timeout=max(1, self.deadline - time.monotonic()))
            self.reader.join(timeout=2)
            code = self.proc.returncode
            self.result.update(exit_code=code, finished_at=now())
            if not self.ready.is_set():
                self.result.update(status="unavailable", reason="Recording never became ready; see simpleperf_log.txt")
                return
            path = self.folder / "simpleperf.data"
            collector.adb("pull", self.remote, str(path), serial=self.run["serial"], timeout=90)
            self.result["raw_bytes"] = path.stat().st_size
            with path.open("rb") as file:
                magic = file.read(8)
            if magic != b"PERFILE2":
                self.result.update(status="failed", reason="Recorder returned an invalid or incomplete perf.data file")
                return
            if code != 0:
                self.result["issues"].append(f"Recorder exited with code {code}; raw data retained as partial evidence")
            try:
                report = self.shell(BINARY, "report", "-i", self.remote,
                                    "--sort", "comm,pid,tid,dso,symbol", timeout=60)
                (self.folder / "simpleperf_report.txt").write_text(report, encoding="utf-8")
                match = re.search(r"(?:Total\s+)?Samples?\s*:\s*([\d,]+)", report, re.I)
                count = int(match[1].replace(",", "")) if match else None
                self.result["sample_count"] = count
                status = "partial" if code != 0 or self.result.get("ended_before_stop") else "empty" if count == 0 else "complete" if count else "recorded"
                self.result.update(status=status, reason="No CPU samples captured" if count == 0 else
                                   "Report sample count unavailable; inspect the raw report" if count is None else None)
                # Delete only this run's remote file after verified local retrieval/report.
                self.shell("rm", "-f", self.remote)
            except Exception as exc:
                self.result.update(status="recorded", reason="Raw data saved; on-device report unavailable: " + str(exc))
                self.result["remote_data"] = self.remote
        except Exception as exc:
            self.result.update(status="failed", reason=str(exc), remote_data=self.remote)
        finally:
            if self.proc is not None and self.proc.poll() is None:
                # Only terminate this host adb client. Never use global pkill on the phone.
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait(timeout=3)
            if self.reader:
                self.reader.join(timeout=2)
            if self.proc and self.proc.stdout:
                self.proc.stdout.close()
            if self.log:
                self.log.close()
            self.publish()
