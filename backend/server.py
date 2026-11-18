"""LAN API entry point with backwards-compatible coordinator imports."""
import argparse
import secrets
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from . import analyzer, collector, resources
from .auth import access_token
from .contracts import APIError, TERMINAL
from .http_handler import Handler
from .run_store import Runs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--runs", type=Path, default=Path("runs"))
    args = parser.parse_args()
    token = access_token(args.runs)
    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        server.token = token
        server.runs = Runs(args.runs)
        print(f"Project B at http://{args.host}:{args.port} | Access token: {token}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
