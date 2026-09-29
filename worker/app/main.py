from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import asdict
from datetime import date

from app.config import database_url
from app.db import backfill_card_fields, connect, save_error, save_run
from app.ingestion import ivanovo_announcements, ivanovo_support, svoefermerstvo
from app.ingestion.base import Fetcher
from app.llm.activity_classifier import classify_pending
from app.llm.gigachat_client import GigaChatClient, GigaChatError
from app.llm.summary_classifier import summarize_pending

LOG = logging.getLogger("agrogrant.worker")
SOURCES = ("ivanovo_support", "ivanovo_announcements", "federal_catalog")


def run(args: argparse.Namespace) -> int:
    fetcher = Fetcher(timeout=args.timeout)
    selected = SOURCES if args.source == "all" else (args.source,)
    conn = None
    if not args.dry_run:
        url = database_url()
        if not url:
            LOG.error("DATABASE_URL is missing (set it in the environment or root .env)")
            return 2
        conn = connect(url)
    failed = False
    try:
        if conn is not None:
            count = backfill_card_fields(conn, force=args.backfill_card_fields)
            if count:
                LOG.info("card fields backfilled: %s", count)
        for source in (() if args.classify_only or args.backfill_card_fields or args.summary_only else selected):
            try:
                if source == "ivanovo_support":
                    measures = ivanovo_support.collect(fetcher, max_documents=args.max_support_documents)
                elif source == "ivanovo_announcements":
                    measures = ivanovo_announcements.collect(fetcher, max_pdfs=args.max_pdfs, year=args.year)
                else:
                    measures = svoefermerstvo.collect(fetcher, max_pages=args.max_federal_pages)
                if args.dry_run:
                    print(json.dumps({"source": source, "count": len(measures), "sample": [asdict(m) for m in measures[:args.sample]]}, ensure_ascii=False, default=str))
                else:
                    inserted, changed = save_run(conn, source, measures)
                    LOG.info("%s: seen=%s inserted=%s changed=%s", source, len(measures), inserted, changed)
            except Exception as exc:
                failed = True
                LOG.exception("%s failed", source)
                if conn is not None:
                    save_error(conn, source, exc)
        if conn is not None and not args.skip_summary and not args.backfill_card_fields:
            try:
                summarized, summary_errors = summarize_pending(
                    conn, GigaChatClient(),
                    source=None if args.source == "all" else {
                        "ivanovo_support": "ivanovo_official_support",
                        "ivanovo_announcements": "ivanovo_official_selections",
                        "federal_catalog": "svoefermerstvo_federal",
                    }[args.source],
                    limit=args.summary_limit,
                    force=args.force_summaries,
                )
                LOG.info("short descriptions: processed=%s errors=%s", summarized, summary_errors)
                failed = failed or summary_errors > 0
            except GigaChatError as exc:
                LOG.error("GigaChat summaries unavailable: %s", exc)
                failed = True
            except Exception:
                LOG.exception("short description generation failed")
                failed = True
        if conn is not None and not args.skip_classification and not args.backfill_card_fields and not args.summary_only:
            try:
                processed, errors = classify_pending(
                    conn, GigaChatClient(),
                    source=None if args.source == "all" else {
                        "ivanovo_support": "ivanovo_official_support",
                        "ivanovo_announcements": "ivanovo_official_selections",
                        "federal_catalog": "svoefermerstvo_federal",
                    }[args.source],
                    limit=args.classification_limit,
                    force=args.force_classification,
                )
                LOG.info("activity classification: processed=%s errors=%s", processed, errors)
                failed = failed or errors > 0
            except GigaChatError as exc:
                LOG.error("activity classification unavailable: %s", exc)
                failed = True
            except Exception:
                LOG.exception("activity classification failed")
                failed = True
    finally:
        if conn is not None:
            conn.close()
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect agricultural support measures for Ivanovo and Russia")
    parser.add_argument("--source", choices=("all",) + SOURCES, default="all")
    parser.add_argument("--year", type=int, default=date.today().year, help="announcement publication year")
    parser.add_argument("--max-pdfs", type=int, default=50, help="newest selection PDFs to parse")
    parser.add_argument("--max-support-documents", type=int, default=100, help="maximum normative files to fetch")
    parser.add_argument("--max-federal-pages", type=int, default=200, help="safety limit for catalog pagination")
    parser.add_argument("--timeout", type=int, default=25)
    parser.add_argument("--dry-run", action="store_true", help="fetch and parse without database writes")
    parser.add_argument("--sample", type=int, default=2, help="records printed per source in dry run")
    parser.add_argument("--loop", action="store_true", help="repeat once every 24 hours")
    parser.add_argument("--classify-only", action="store_true", help="classify already stored measures without fetching sources")
    parser.add_argument("--backfill-card-fields", action="store_true", help="fill card fields for stored measures without fetching sources or running GigaChat")
    parser.add_argument("--summary-only", action="store_true", help="generate short descriptions for stored measures without fetching sources or classifying activities")
    parser.add_argument("--skip-summary", action="store_true", help="do not generate GigaChat short descriptions")
    parser.add_argument("--summary-limit", type=int, help="maximum number of short descriptions to generate")
    parser.add_argument("--force-summaries", action="store_true", help="regenerate short descriptions even when one is already stored")
    parser.add_argument("--skip-classification", action="store_true", help="only collect source data")
    parser.add_argument("--classification-limit", type=int, help="maximum number of measures to classify in this run")
    parser.add_argument("--force-classification", action="store_true", help="reclassify records even when their input is unchanged")
    args = parser.parse_args()
    if args.classify_only and args.dry_run:
        parser.error("--classify-only cannot be combined with --dry-run")
    if args.classify_only and args.skip_classification:
        parser.error("--classify-only cannot be combined with --skip-classification")
    if args.backfill_card_fields and (args.dry_run or args.classify_only):
        parser.error("--backfill-card-fields cannot be combined with --dry-run or --classify-only")
    if args.summary_only and (args.dry_run or args.classify_only or args.backfill_card_fields):
        parser.error("--summary-only cannot be combined with --dry-run, --classify-only or --backfill-card-fields")
    if args.summary_only and args.skip_summary:
        parser.error("--summary-only cannot be combined with --skip-summary")
    if args.summary_limit is not None and args.summary_limit < 1:
        parser.error("--summary-limit must be positive")
    if args.classification_limit is not None and args.classification_limit < 1:
        parser.error("--classification-limit must be positive")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    while True:
        result = run(args)
        if not args.loop:
            return result
        time.sleep(24 * 60 * 60)


if __name__ == "__main__":
    sys.exit(main())
