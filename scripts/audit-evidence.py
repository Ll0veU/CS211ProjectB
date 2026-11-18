"""Audit local evidence and report arithmetic without editing original recordings."""
import argparse
import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import protocol, report_reference


def audit(root, report):
    records = []
    for path in sorted(root.glob("*/metadata.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        entry = {"id": run.get("id"), "workload": run.get("workload"), "mode": run.get("mode", "trace"),
                 "status": run.get("status"), "outcome": run.get("outcome"),
                 "metadata_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                 "target_package": run.get("target_package"), "markers": len(run.get("markers", []))}
        summary_path = path.with_name("summary.json")
        trace = path.with_name("capture.pftrace")
        entry["trace_bytes"] = trace.stat().st_size if trace.is_file() else None
        if run.get("mode", "trace") in ("trace", "baseline"):
            summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else None
            entry["protocol_checks"] = protocol.validate(run, summary)
            if run.get("target_package") in ("com.google.android.apps.bard", "com.google.android.googlequicksearchbox") and not run.get("scope_confirmed"):
                entry["attribution"] = "unreviewed_observation_scope"
            if summary:
                transactions_path = path.with_name("transactions.json")
                transactions = json.loads(transactions_path.read_text(encoding="utf-8")) if transactions_path.is_file() else []
                csv_path = path.with_name("transactions.csv")
                csv_count = None
                if csv_path.is_file():
                    with csv_path.open(encoding="utf-8", newline="") as file:
                        csv_count = sum(1 for _ in csv.DictReader(file))
                counts = {"summary": summary["transaction_count"], "json": len(transactions), "csv": csv_count,
                          "timeline": sum(row.get(direction, 0) for row in summary.get("timeline", [])
                                          for direction in ("incoming", "outgoing", "internal"))}
                entry["counts"] = counts
                entry["accounting_consistent"] = all(value == counts["summary"] for value in counts.values())
                entry["unique_transaction_ids"] = len({item["id"] for item in transactions}) == len(transactions)
        records.append(entry)
    reference = report_reference.read_reference(report)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "local_runs_root": str(root.resolve()),
            "local_record_count": len(records), "records": records,
            "report_source_sha256": reference.get("sha256"), "report_source": str(report.resolve()),
            "report_records": len(reference["runs"]), "report_arithmetic": report_reference.check_arithmetic(reference),
            "reported_raw_runs_present": all(any(row.get("id", "").startswith(item["short_id"]) for row in records)
                                             for item in reference["runs"]) if reference["runs"] else False,
            "limitation": "Report arithmetic and local accounting do not prove task success, causality, or complete formal experiment coverage"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, default=Path("runs"))
    parser.add_argument("--report", type=Path, default=report_reference.REPORT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit(args.runs, args.report)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        # Audit artifacts must stay outside immutable original run folders.
        output = args.output.resolve()
        for metadata in args.runs.glob("*/metadata.json"):
            if output.is_relative_to(metadata.parent.resolve()):
                parser.error("Store the audit outside original run folders")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
    print(json.dumps({"local_records": result["local_record_count"], "reported_records": result["report_records"],
                      "report_arithmetic": result["report_arithmetic"],
                      "reported_raw_runs_present": result["reported_raw_runs_present"],
                      "output": str(args.output) if args.output else None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
