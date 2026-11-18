"""HTTP framing, bounded JSON input and consistent error responses."""
import json
from http.server import BaseHTTPRequestHandler
from .campaigns import CampaignError
from .contracts import APIError


class JsonHandler(BaseHTTPRequestHandler):
    def respond(self, status, body, kind="application/json", filename=None):
        # Drain rejected POST bodies so Windows clients still receive structured errors.
        if self.command == "POST" and not getattr(self, "body_consumed", False):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if 0 < length <= 16384:
                self.rfile.read(length)
            self.body_consumed = True
        data = json.dumps(body, ensure_ascii=False).encode() if kind == "application/json" and not isinstance(body, bytes) else body
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 <= length <= 16384:
                raise ValueError()
            raw = self.rfile.read(length)
            self.body_consumed = True
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (ValueError, UnicodeError) as exc:
            raise APIError(400, "Expected a JSON object of at most 16 KiB.") from exc

    def dispatch(self):
        try:
            self.route()
        except APIError as exc:
            self.respond(exc.status, {"error": str(exc), "code": exc.code, "params": {}})
        except CampaignError as exc:
            self.respond(400, {"error": str(exc), "code": exc.code, "params": {}})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.respond(500, {"error": str(exc), "code": "server_error", "params": {}})

    do_GET = dispatch
    do_POST = dispatch
