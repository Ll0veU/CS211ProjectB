"""Serve an isolated browser-QA fixture; never connect to a phone or real runs."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import campaigns, server


def main():
    with tempfile.TemporaryDirectory(prefix="projectb-ui-qa-") as directory:
        root = Path(directory)
        config = {"device_label": "SIMULATED-PHONE", "target_packages": campaigns.SPEC["target_packages"],
                  "browser_package": "com.android.chrome", "account_label": "QA only", "gemini_mode": "QA fixture",
                  "network": "not connected", "brightness": "50% example", "volume": "20% example",
                  "read_aloud": "off example", "resource_seconds": 300}
        runs = server.Runs(root)
        runs.campaigns.create({"name": "UI QA — simulated, no phone", "config": config})
        # Disable every physical-device entry point in this isolated process.
        server.collector.devices = lambda: []
        with server.ThreadingHTTPServer(("127.0.0.1", 8767), server.Handler) as http:
            http.token = "ui-qa-only"
            http.runs = runs
            http.serve_forever()


if __name__ == "__main__":
    main()
