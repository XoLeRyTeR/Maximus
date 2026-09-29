CREATE TABLE users (
    max_user_id text PRIMARY KEY,
    first_name text NOT NULL DEFAULT '',
    last_name text,
    username text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
    max_user_id text PRIMARY KEY REFERENCES users(max_user_id) ON DELETE CASCADE,
    entity_type text NOT NULL CHECK (entity_type IN ('company', 'entrepreneur')),
    inn text NOT NULL,
    ogrn text NOT NULL,
    name text NOT NULL,
    region_code text,
    region_name text,
    opf text,
    okved_main text,
    okved_extra text[] NOT NULL DEFAULT '{}',
    registration_date date,
    legal_status text,
    source text NOT NULL DEFAULT 'checko',
    fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_sessions (
    max_user_id text PRIMARY KEY REFERENCES users(max_user_id) ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('await_identifier', 'ready')),
    updated_at timestamptz NOT NULL DEFAULT now()
);
