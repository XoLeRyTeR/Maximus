"""Export every collected support measure and document from PostgreSQL.

Run from the repository root: python test.py
The full export is written to parsed_data.json; --stdout also prints it.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "worker"))
# The local test installation is optional; normal installations use site-packages.
if (ROOT / "worker" / ".deps").exists():
    sys.path.insert(0, str(ROOT / "worker" / ".deps"))

import psycopg
from psycopg.rows import dict_row

from app.config import database_url


def export_data() -> dict:
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is missing from the environment and root .env")

    with psycopg.connect(url, row_factory=dict_row) as conn:
        measures = conn.execute(
            "SELECT * FROM support_measures ORDER BY source, published_at DESC NULLS LAST, id"
        ).fetchall()
        documents = conn.execute(
            "SELECT * FROM support_documents ORDER BY measure_id, id"
        ).fetchall()

    by_measure: dict[int, list[dict]] = defaultdict(list)
    for document in documents:
        by_measure[document["measure_id"]].append(document)
    for measure in measures:
        measure["documents"] = by_measure[measure["id"]]

    return {
        "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "total_measures": len(measures),
        "total_documents": len(documents),
        "by_source": dict(sorted(Counter(m["source"] for m in measures).items())),
        "measures": measures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export all parsed grant data for inspection")
    parser.add_argument("--output", type=Path, default=ROOT / "parsed_data.json")
    parser.add_argument("--csv", type=Path, default=ROOT / "parsed_data.csv")
    parser.add_argument("--stdout", action="store_true", help="also print the complete JSON")
    args = parser.parse_args()

    result = export_data()
    payload = json.dumps(result, ensure_ascii=False, indent=2, default=str)
    args.output.write_text(payload + "\n", encoding="utf-8")
    columns = ("id", "source", "kind", "title", "short_description", "support_type",
               "application_url", "region", "published_at", "application_start",
               "application_deadline", "deadline_status", "deadline_evidence", "source_url",
               "activity_labels", "activity_exclusions",
               "activity_scope", "activity_status", "document_count")
    with args.csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for measure in result["measures"]:
            writer.writerow({key: len(measure["documents"]) if key == "document_count"
                             else ", ".join(measure.get(key) or []) if key in {"activity_labels", "activity_exclusions"}
                             else measure.get(key) for key in columns})
    if args.stdout:
        print(payload)
    print(
        f"Saved {result['total_measures']} measures and {result['total_documents']} documents "
        f"to {args.output.resolve()} and {args.csv.resolve()}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
