ALTER TABLE profiles
  ADD COLUMN okved_main_name text,
  ADD COLUMN okved_extra_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN activity_description text,
  ADD COLUMN activity_labels text[] NOT NULL DEFAULT '{}';
