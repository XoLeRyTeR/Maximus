CREATE TABLE IF NOT EXISTS support_measures (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT NOT NULL,
    region TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('measure', 'selection')),
    description TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    amount TEXT,
    published_at DATE,
    application_start DATE,
    application_deadline DATE,
    content_hash TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS support_measures_region_deadline_idx
    ON support_measures (region, application_deadline);

ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_labels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_exclusions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_scope TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_input_hash TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_model TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_error TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS activity_classified_at TIMESTAMPTZ;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS support_type TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS application_url TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_input_hash TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_model TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_checked_at TIMESTAMPTZ;
ALTER TABLE support_measures DROP COLUMN IF EXISTS parent_measure_id;

CREATE INDEX IF NOT EXISTS support_measures_activity_labels_idx
    ON support_measures USING GIN (activity_labels);

CREATE TABLE IF NOT EXISTS support_documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    measure_id BIGINT NOT NULL REFERENCES support_measures(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    extracted_text TEXT,
    extraction_status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (measure_id, url)
);

CREATE TABLE IF NOT EXISTS support_ingestion_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
    records_seen INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
);
