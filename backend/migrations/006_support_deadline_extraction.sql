ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_input_hash TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_model TEXT;
ALTER TABLE support_measures ADD COLUMN IF NOT EXISTS deadline_checked_at TIMESTAMPTZ;
