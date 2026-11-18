"""Stable run identifiers, export allowlists and API errors shared across layers."""
import re
from datetime import datetime, timezone
from pathlib import Path

WEB = Path(__file__).with_name("web")
DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
PACKAGE = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+")
RUN_ID = re.compile(r"[0-9a-f]{32}")
TERMINAL = {"complete", "failed"}
EXPORTS = {"metadata.json", "metadata.csv", "summary.json", "summary.csv", "transactions.json",
           "transactions.csv", "edges.csv", "timeline.csv", "capture.pftrace",
           "resources.json", "resources.csv", "resources_summary.json"}


def now():
    return datetime.now(timezone.utc).isoformat()


class APIError(Exception):
    def __init__(self, status, message, code="request_failed"):
        super().__init__(message)
        self.status = status
        self.code = code
