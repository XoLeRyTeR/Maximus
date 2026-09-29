from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path

import psycopg

from app.ingestion.base import Measure
from app.processing.card_fields import card_fields

SCHEMA = Path(__file__).resolve().parents[1] / "sql" / "001_support_ingestion.sql"


def connect(database_url: str) -> psycopg.Connection:
    conn = psycopg.connect(database_url)
    conn.execute(SCHEMA.read_text(encoding="utf-8"))
    conn.commit()
    return conn


def save_run(conn: psycopg.Connection, source: str, measures: list[Measure]) -> tuple[int, int]:
    inserted = 0
    changed = 0
    with conn.transaction():
        run_id = conn.execute(
            "INSERT INTO support_ingestion_runs (source, status) VALUES (%s, 'running') RETURNING id",
            (source,),
        ).fetchone()[0]
        for measure in measures:
            support_type, application_url = card_fields(
                measure.source, measure.source_url, measure.title, measure.kind, measure.description,
            )
            payload = asdict(measure)
            payload.pop("documents")
            digest = hashlib.sha256(json.dumps(payload, default=str, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            old = conn.execute(
                "SELECT id, content_hash FROM support_measures WHERE source=%s AND external_id=%s",
                (measure.source, measure.external_id),
            ).fetchone()
            if old is None:
                inserted += 1
            elif old[1] != digest:
                changed += 1
            measure_id = conn.execute(
                """INSERT INTO support_measures
                (source, external_id, source_url, title, region, kind, description, terms, amount,
                 published_at, application_start, application_deadline, content_hash,
                 short_description, support_type, application_url)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (source, external_id) DO UPDATE SET
                    source_url=EXCLUDED.source_url, title=EXCLUDED.title, region=EXCLUDED.region,
                    kind=EXCLUDED.kind, description=EXCLUDED.description, terms=EXCLUDED.terms,
                    amount=EXCLUDED.amount, published_at=EXCLUDED.published_at,
                    application_start=EXCLUDED.application_start,
                    application_deadline=EXCLUDED.application_deadline,
                    short_description=CASE WHEN support_measures.content_hash<>EXCLUDED.content_hash
                                           THEN NULL ELSE support_measures.short_description END,
                    support_type=EXCLUDED.support_type,
                    application_url=EXCLUDED.application_url,
                    content_hash=EXCLUDED.content_hash, last_seen_at=now(),
                    updated_at=CASE WHEN support_measures.content_hash<>EXCLUDED.content_hash
                                    THEN now() ELSE support_measures.updated_at END
                RETURNING id""",
                (measure.source, measure.external_id, measure.source_url, measure.title,
                 measure.region, measure.kind, measure.description, measure.terms, measure.amount,
                 measure.published_at, measure.application_start, measure.application_deadline, digest,
                 None, support_type, application_url),
            ).fetchone()[0]
            for document in measure.documents:
                conn.execute(
                    """INSERT INTO support_documents (measure_id, url, title, extracted_text, extraction_status)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (measure_id, url) DO UPDATE SET
                        title=EXCLUDED.title, extracted_text=COALESCE(EXCLUDED.extracted_text, support_documents.extracted_text),
                        extraction_status=CASE WHEN EXCLUDED.extraction_status IN ('not_fetched','fetch_error')
                                                    AND support_documents.extracted_text IS NOT NULL
                                               THEN support_documents.extraction_status
                                               ELSE EXCLUDED.extraction_status END,
                        updated_at=now()""",
                    (measure_id, document.url, document.title, document.text, document.extraction_status),
                )
        conn.execute(
            "UPDATE support_ingestion_runs SET status='success', finished_at=now(), records_seen=%s WHERE id=%s",
            (len(measures), run_id),
        )
    return inserted, changed


def backfill_card_fields(conn: psycopg.Connection, force: bool = False) -> int:
    with conn.transaction():
        rows = conn.execute(
            """SELECT id, source, source_url, title, kind, description
            FROM support_measures
            WHERE %s OR support_type IS NULL OR application_url IS NULL""",
            (force,),
        ).fetchall()
        for measure_id, source, source_url, title, kind, description in rows:
            support, application_url = card_fields(source, source_url, title, kind, description)
            conn.execute(
                """UPDATE support_measures SET
                    support_type=CASE WHEN %s THEN %s ELSE COALESCE(support_type, %s) END,
                    application_url=CASE WHEN %s THEN %s ELSE COALESCE(application_url, %s) END
                WHERE id=%s""",
                (force, support, support, force,
                 application_url, application_url, measure_id),
            )
    return len(rows)


def save_error(conn: psycopg.Connection, source: str, error: Exception) -> None:
    with conn.transaction():
        conn.execute(
            "INSERT INTO support_ingestion_runs (source,status,finished_at,error_message) VALUES (%s,'error',now(),%s)",
            (source, str(error)[:1000]),
        )
