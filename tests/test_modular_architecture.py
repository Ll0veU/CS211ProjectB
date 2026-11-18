"""Exercise module seams and compatibility without touching physical devices."""
import ast
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend import auth, contracts, http_handler, run_store, server, source_identity, study_export

ROOT = Path(__file__).resolve().parents[1]


class ModularArchitectureTests(unittest.TestCase):
    def test_entrypoint_preserves_public_imports(self):
        self.assertIs(server.Runs, run_store.Runs)
        self.assertIs(server.Handler, http_handler.Handler)
        self.assertIs(server.APIError, contracts.APIError)
        self.assertIs(server.access_token, auth.access_token)

    def test_domain_modules_do_not_import_http_or_cli_modules(self):
        for name in ("run_store", "run_capture", "run_events", "run_quality", "behavior_classifier", "resource_capture", "resource_compare"):
            tree = ast.parse((ROOT / "backend" / f"{name}.py").read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    dependencies = [node.module or "", *(alias.name for alias in node.names)]
                    self.assertFalse(any(dependency == "server" or dependency.startswith("http_") for dependency in dependencies), name)

    def test_new_source_identity_covers_extracted_implementations(self):
        hashes = source_identity.backend_hashes()
        for name in ("run_capture.py", "run_events.py", "run_quality.py", "behavior_classifier.py", "resource_capture.py", "resource_compare.py"):
            self.assertIn(name, hashes)
            self.assertEqual(len(hashes[name]), 64)

    def test_bundle_carries_modular_source_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = study_export.bundle(Path(directory))
        with zipfile.ZipFile(io.BytesIO(archive)) as exported:
            for name in ("contracts.py", "run_store.py", "http_handler.py", "resource_compare.py", "resource_capture.py", "behavior_classifier.py"):
                self.assertIn(f"source/backend/{name}", exported.namelist())
            manifest = json.loads(exported.read("manifest.sha256.json"))
            self.assertIn("source/backend/source_identity.py", manifest)

    def test_legacy_module_routes_and_traversal(self):
        from http.server import ThreadingHTTPServer
        import threading
        from urllib.error import HTTPError
        from urllib.request import urlopen

        with tempfile.TemporaryDirectory() as directory, patch.object(http_handler, "DIST", Path(directory) / "missing-dist"):
            with ThreadingHTTPServer(("127.0.0.1", 0), http_handler.Handler) as http:
                http.token = "fixture"
                http.runs = run_store.Runs(Path(directory))
                worker = threading.Thread(target=http.serve_forever, daemon=True)
                worker.start()
                try:
                    origin = f"http://127.0.0.1:{http.server_port}"
                    for path, expected in (("/", b'type="module"'), ("/app.js", b"./legacy/client.js"),
                                           ("/legacy/client.js", b"export async function api"), ("/legacy/packages.js", b"export function packagePicker")):
                        with urlopen(origin + path, timeout=4) as response:
                            self.assertIn(expected, response.read())
                    with self.assertRaises(HTTPError) as error:
                        urlopen(origin + "/legacy/../app.js", timeout=4)
                    self.assertEqual(error.exception.code, 404)
                    error.exception.close()
                finally:
                    http.shutdown()
                    worker.join(timeout=3)
