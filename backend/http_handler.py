"""Authenticate HTTP requests and dispatch to feature-specific route modules."""
import hmac
import mimetypes
from urllib.parse import urlsplit
from . import campaigns, experiments, report_reference, study_export
from .contracts import APIError, DIST, TERMINAL, WEB
from .http_campaigns import route_campaign
from .http_devices import route_device
from .http_runs import route_run
from .http_transport import JsonHandler


class Handler(JsonHandler):
    def route(self):
        path, method = urlsplit(self.path).path, self.command
        static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
        if method == "GET" and (path == "/" or path.startswith("/assets/")) and DIST.is_dir():
            file = (DIST / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
            if not file.is_relative_to(DIST.resolve()) or not file.is_file():
                raise APIError(404, "Unknown frontend asset", "not_found")
            return self.respond(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        if method == "GET" and path in static:
            file, kind = static[path]
            return self.respond(200, (WEB / file).read_bytes(), kind + "; charset=utf-8")
        if method == "GET" and path.startswith("/legacy/"):
            file = (WEB / path.lstrip("/")).resolve()
            if not file.is_relative_to((WEB / "legacy").resolve()) or file.suffix != ".js" or not file.is_file():
                raise APIError(404, "Unknown legacy frontend asset", "not_found")
            return self.respond(200, file.read_bytes(), "text/javascript; charset=utf-8")
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {self.server.token}".encode()):
            raise APIError(401, "Enter the backend access token.")
        runs = self.server.runs
        if method == "GET" and path == "/api/protocol":
            return self.respond(200, campaigns.SPEC)
        if method == "GET" and path == "/api/reference-report":
            return self.respond(200, report_reference.read_reference())
        if method == "GET" and path in ("/api/study/report.en.md", "/api/study/report.zh-CN.md"):
            locale = "zh-CN" if "zh-CN" in path else "en"
            with runs.lock:
                data = study_export.study_report(runs.root, locale)
            return self.respond(200, data, "text/markdown; charset=utf-8", f"vivo-report.{locale}.md")
        if method == "GET" and path == "/api/study/bundle.zip":
            with runs.lock:
                if any(record["status"] not in TERMINAL for record in runs.runs.values()):
                    raise APIError(409, "Export after the active capture finishes", "experiment_active")
                data = study_export.bundle(runs.root)
            return self.respond(200, data, "application/zip", "vivo-study-evidence.zip")
        if method == "GET" and path == "/api/evaluation.json":
            with runs.lock:
                result = experiments.report(runs.root)
            return self.respond(200, result, filename="evaluation.json")
        parts = path.strip("/").split("/")
        for route in (route_campaign, route_device, route_run):
            if route(self, method, parts, runs):
                return
        raise APIError(404, "Unknown endpoint.")
