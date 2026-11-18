"""Run lifecycle routes and immutable reanalysis/export endpoints."""
import csv
import hashlib
import io
import json
import uuid
from . import analyzer, protocol
from .contracts import APIError, EXPORTS, RUN_ID, PACKAGE, TERMINAL, now


def export_run(handler, run_id, name, runs):
    run = runs.get(run_id)
    kind = {"csv": "text/csv", "json": "application/json", "pftrace": "application/octet-stream"}[name.split(".")[-1]]
    file = runs.folder(run_id) / name
    if name == "metadata.csv":
        data = run
    elif name == "summary.csv" and run["status"] in TERMINAL and file.with_suffix(".json").is_file():
        data = json.loads(file.with_suffix(".json").read_bytes())
    elif file.is_file() and (run["status"] in TERMINAL or name == "metadata.json"):
        return handler.respond(200, file.read_bytes(), kind, name)
    else:
        raise APIError(409, "This export is not available yet.")
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["field", "value_json"])
    writer.writerows((key, json.dumps(value, ensure_ascii=False)) for key, value in data.items())
    handler.respond(200, buffer.getvalue().encode(), kind, name)


def reanalyze(handler, method, run_id, runs):
    root = runs.root / ".analyses" / run_id
    if method == "GET":
        handler.respond(200, [json.loads(file.read_text(encoding="utf-8")) for file in root.glob("*/analysis.json")])
        return
    body = handler.body()
    names = body.get("target_packages")
    if not isinstance(names, list) or not names or len(names) > 6 or any(not isinstance(name, str) or not PACKAGE.fullmatch(name) for name in names):
        raise APIError(400, "Select observation packages", "invalid_packages")
    source_run = runs.get(run_id)
    trace = runs.folder(run_id) / "capture.pftrace"
    if source_run["status"] not in TERMINAL or not trace.is_file():
        raise APIError(409, "A completed trace file is required", "capture_incomplete")
    analysis_id = uuid.uuid4().hex
    folder = root / analysis_id
    folder.mkdir(parents=True)
    observed = {**source_run, "target_packages": list(dict.fromkeys(names)), "scope_confirmed": False}
    transactions, summary = analyzer.analyze(trace, observed)
    analyzer.export(folder, transactions, summary)
    result = {"id": analysis_id, "source_run_id": run_id, "source_sha256": hashlib.sha256(trace.read_bytes()).hexdigest(),
              "created_at": now(), "target_packages": names, "summary": summary,
              "quality": protocol.validate(source_run, summary), "formal_eligible": False}
    analyzer.save_json(folder / "analysis.json", result)
    handler.respond(201, result)


def route_run(handler, method, parts, runs):
    if parts == ["api", "runs"]:
        if method == "GET":
            handler.respond(200, runs.list())
            return True
        if method == "POST":
            handler.respond(202, runs.start(handler.body(), handler.headers.get("X-ProjectB-Client", "desktop")))
            return True
    if parts[:2] != ["api", "runs"] or len(parts) < 3 or not RUN_ID.fullmatch(parts[2]):
        return False
    run_id, action = parts[2], parts[3:]
    if method == "GET" and not action:
        handler.respond(200, {key: value for key, value in runs.get(run_id).items() if key != "packages"})
    elif method == "GET" and action == ["artifacts"]:
        handler.respond(200, runs.artifacts(run_id))
    elif method == "GET" and action == ["quality"]:
        handler.respond(200, runs.quality(run_id))
    elif method == "POST" and action in (["stop"], ["markers"], ["controller-ready"], ["outcome"]):
        operation = {"stop": runs.stop, "markers": runs.marker, "controller-ready": runs.controller_ready, "outcome": runs.outcome}[action[0]]
        result = operation(run_id) if action == ["stop"] else operation(run_id, handler.body())
        handler.respond({"stop": 202, "markers": 201}.get(action[0], 200), result)
    elif action == ["analyses"] and method in ("GET", "POST"):
        reanalyze(handler, method, run_id, runs)
    elif method == "GET" and len(action) == 1 and action[0] in EXPORTS:
        export_run(handler, run_id, action[0], runs)
    else:
        return False
    return True
