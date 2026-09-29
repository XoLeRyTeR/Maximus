import type { Organization } from '../integrations/checko_client.js';
import type { Database } from './client.js';

export type SessionState = 'await_identifier' | 'ready';
export type MaxUser = {
  user_id: number;
  first_name: string;
  last_name?: string;
  username: string | null;
};

export async function saveMaxUser(database: Database, user: MaxUser): Promise<string> {
  const userId = String(user.user_id);
  await database.query(
    `INSERT INTO users (max_user_id, first_name, last_name, username)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (max_user_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       username = EXCLUDED.username,
       updated_at = now()`,
    [userId, user.first_name ?? '', user.last_name ?? null, user.username ?? null],
  );
  return userId;
}

export async function getSessionState(database: Database, userId: string): Promise<SessionState | null> {
  const result = await database.query<{ state: SessionState }>(
    'SELECT state FROM bot_sessions WHERE max_user_id = $1',
    [userId],
  );
  return result.rows[0]?.state ?? null;
}

export async function setSessionState(database: Database, userId: string, state: SessionState): Promise<void> {
  await database.query(
    `INSERT INTO bot_sessions (max_user_id, state)
     VALUES ($1, $2)
     ON CONFLICT (max_user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [userId, state],
  );
}

export async function getProfile(database: Database, userId: string): Promise<Organization | null> {
  const result = await database.query<{
    entity_type: Organization['entityType']; inn: string; ogrn: string; name: string;
    region_code: string | null; region_name: string | null; operating_region_name: string | null; opf: string | null;
    okved_main: string | null; okved_extra: string[]; registration_date: string | null;
    okved_main_name: string | null;
    okved_extra_details: { code: string; name: string }[];
    activity_description: string | null; activity_labels: Organization['activityLabels'];
    legal_status: string | null;
  }>(
    `SELECT entity_type, inn, ogrn, name, region_code, region_name, operating_region_name, opf,
            okved_main, okved_extra, okved_main_name, okved_extra_details,
            activity_description, activity_labels, registration_date::text, legal_status
     FROM profiles WHERE max_user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    entityType: row.entity_type,
    inn: row.inn,
    ogrn: row.ogrn,
    name: row.name,
    regionCode: row.region_code,
    regionName: row.region_name,
    operatingRegionName: row.operating_region_name,
    opf: row.opf,
    okvedMain: row.okved_main,
    okvedExtra: row.okved_extra,
    okvedMainName: row.okved_main_name,
    okvedExtraDetails: row.okved_extra_details,
    activityDescription: row.activity_description,
    activityLabels: row.activity_labels,
    registrationDate: row.registration_date,
    legalStatus: row.legal_status,
  };
}

export async function saveProfile(database: Database, userId: string, profile: Organization): Promise<void> {
  await database.query(
    `INSERT INTO profiles (
       max_user_id, entity_type, inn, ogrn, name, region_code, region_name,
       operating_region_name, opf, okved_main, okved_extra, okved_main_name, okved_extra_details,
       activity_description, activity_labels, registration_date, legal_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17)
     ON CONFLICT (max_user_id) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       inn = EXCLUDED.inn,
       ogrn = EXCLUDED.ogrn,
       name = EXCLUDED.name,
       region_code = EXCLUDED.region_code,
       region_name = EXCLUDED.region_name,
       operating_region_name = EXCLUDED.operating_region_name,
       opf = EXCLUDED.opf,
       okved_main = EXCLUDED.okved_main,
       okved_extra = EXCLUDED.okved_extra,
       okved_main_name = EXCLUDED.okved_main_name,
       okved_extra_details = EXCLUDED.okved_extra_details,
       activity_description = EXCLUDED.activity_description,
       activity_labels = EXCLUDED.activity_labels,
       registration_date = EXCLUDED.registration_date,
       legal_status = EXCLUDED.legal_status,
       fetched_at = now()`,
    [
      userId, profile.entityType, profile.inn, profile.ogrn, profile.name,
      profile.regionCode, profile.regionName, profile.operatingRegionName ?? null,
      profile.opf, profile.okvedMain,
      profile.okvedExtra, profile.okvedMainName ?? null,
      JSON.stringify(profile.okvedExtraDetails ?? []), profile.activityDescription ?? null,
      profile.activityLabels ?? [], profile.registrationDate, profile.legalStatus,
    ],
  );
}

export async function saveOperatingRegion(database: Database, userId: string, regionName: string): Promise<void> {
  await database.query('UPDATE profiles SET operating_region_name = $2 WHERE max_user_id = $1', [userId, regionName]);
}

export async function saveActivityClassification(
  database: Database,
  userId: string,
  description: string | null,
  labels: NonNullable<Organization['activityLabels']>,
): Promise<void> {
  await database.query(
    'UPDATE profiles SET activity_description = $2, activity_labels = $3 WHERE max_user_id = $1',
    [userId, description, labels],
  );
}
