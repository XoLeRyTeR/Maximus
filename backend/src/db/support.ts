import { randomUUID } from 'node:crypto';
import type { Database } from './client.js';
import type { SupportMeasure } from '../matching/support_recommendations.js';

type MeasureRow = {
  id: string; title: string; region: string | null; kind: SupportMeasure['kind'];
  source_url: string; application_url: string | null; description: string;
  short_description: string | null; terms: string; amount: string | null;
  support_type: string | null; application_start: string | null;
  application_deadline: string | null; updated_at: string;
  activity_labels: SupportMeasure['activityLabels'];
  activity_exclusions: SupportMeasure['activityExclusions'];
  activity_scope: SupportMeasure['activityScope']; activity_status: string;
};

const MEASURE_SELECT = `SELECT id::text, title, region, kind, source_url, application_url,
  description, short_description, terms, amount, support_type,
  application_start::text, application_deadline::text, updated_at::text,
  activity_labels, activity_exclusions, activity_scope, activity_status
  FROM support_measures`;

function mapMeasure(row: MeasureRow): SupportMeasure {
  return {
    id: row.id, title: row.title, region: row.region, kind: row.kind,
    sourceUrl: row.source_url, applicationUrl: row.application_url,
    description: row.description, shortDescription: row.short_description,
    terms: row.terms, amount: row.amount, supportType: row.support_type,
    applicationStart: row.application_start, applicationDeadline: row.application_deadline,
    updatedAt: row.updated_at, activityLabels: row.activity_labels,
    activityExclusions: row.activity_exclusions, activityScope: row.activity_scope,
    activityStatus: row.activity_status,
  };
}

export async function listMeasures(database: Database): Promise<SupportMeasure[]> {
  const result = await database.query<MeasureRow>(
    `${MEASURE_SELECT} WHERE activity_status = 'classified'
       OR (activity_status = 'needs_review' AND activity_scope = 'specific')`);
  return result.rows.map(mapMeasure);
}

export async function listCatalogMeasures(database: Database, region: string | null): Promise<SupportMeasure[]> {
  const result = await database.query<MeasureRow>(
    `${MEASURE_SELECT} WHERE (region IS NULL OR lower(trim(region)) = lower(trim($1)))
     AND application_deadline >= (now() AT TIME ZONE 'Europe/Moscow')::date
     ORDER BY CASE WHEN kind = 'selection' THEN 0 ELSE 1 END,
              application_deadline ASC NULLS LAST, updated_at DESC`, [region]);
  return result.rows.map(mapMeasure);
}

export async function getMeasuresByIds(database: Database, ids: string[]): Promise<SupportMeasure[]> {
  if (!ids.length) return [];
  const result = await database.query<MeasureRow>(`${MEASURE_SELECT} WHERE id = ANY($1::bigint[])`, [ids]);
  const byId = new Map(result.rows.map((row) => [row.id, mapMeasure(row)]));
  return ids.map((id) => byId.get(id)).filter((item): item is SupportMeasure => Boolean(item));
}

export type SupportDocumentLink = { url: string; title: string };

export async function getMeasureDocumentLinks(database: Database, measureId: string): Promise<SupportDocumentLink[]> {
  const result = await database.query<SupportDocumentLink>(
    `SELECT url, title FROM support_documents WHERE measure_id = $1::bigint
     ORDER BY CASE WHEN lower(title) LIKE '%объявлен%' THEN 0 ELSE 1 END, id
     LIMIT 3`, [measureId]);
  return result.rows;
}

export type SupportNavigation = { token: string; mode: 'recommendations' | 'applications' | 'catalog'; ids: string[]; position: number };

export async function setNavigation(database: Database, userId: string, mode: SupportNavigation['mode'], ids: string[]): Promise<SupportNavigation> {
  const navigation: SupportNavigation = { token: randomUUID().slice(0, 12), mode, ids, position: 0 };
  await database.query(
    `INSERT INTO bot_sessions (max_user_id, state, support_navigation)
     VALUES ($1, 'ready', $2::jsonb)
     ON CONFLICT (max_user_id) DO UPDATE SET support_navigation = EXCLUDED.support_navigation, updated_at = now()`,
    [userId, JSON.stringify(navigation)]);
  return navigation;
}

export async function getNavigation(database: Database, userId: string): Promise<SupportNavigation | null> {
  const result = await database.query<{ support_navigation: SupportNavigation | null }>(
    'SELECT support_navigation FROM bot_sessions WHERE max_user_id = $1', [userId]);
  const nav = result.rows[0]?.support_navigation;
  return nav?.token && Array.isArray(nav.ids) ? nav : null;
}

export async function moveNavigation(database: Database, userId: string, token: string, position: number): Promise<boolean> {
  const result = await database.query(
    `UPDATE bot_sessions SET support_navigation = jsonb_set(support_navigation, '{position}', to_jsonb($3::int))
     WHERE max_user_id = $1 AND support_navigation->>'token' = $2`, [userId, token, position]);
  return Boolean(result.rowCount);
}

export type ApplicationStatus = 'preparing' | 'submitted' | 'approved' | 'rejected' | 'withdrawn';

export async function listApplicationIds(database: Database, userId: string): Promise<string[]> {
  const result = await database.query<{ measure_id: string }>(
    `SELECT measure_id::text FROM user_applications WHERE max_user_id = $1 AND status <> 'withdrawn'
     ORDER BY updated_at DESC, id DESC`, [userId]);
  return result.rows.map((row) => row.measure_id);
}

export async function getApplicationStatus(database: Database, userId: string, measureId: string): Promise<ApplicationStatus | null> {
  const result = await database.query<{ status: ApplicationStatus }>(
    'SELECT status FROM user_applications WHERE max_user_id = $1 AND measure_id = $2::bigint', [userId, measureId]);
  return result.rows[0]?.status ?? null;
}

export async function saveApplication(database: Database, userId: string, measureId: string): Promise<void> {
  await database.query(
    `INSERT INTO user_applications (max_user_id, measure_id) VALUES ($1, $2::bigint)
     ON CONFLICT (max_user_id, measure_id) DO UPDATE SET
       status = CASE WHEN user_applications.status = 'withdrawn' THEN 'preparing' ELSE user_applications.status END,
       updated_at = now()`, [userId, measureId]);
}

export async function updateApplicationStatus(database: Database, userId: string, measureId: string, status: ApplicationStatus): Promise<boolean> {
  const result = await database.query(
    `UPDATE user_applications SET status = $3, updated_at = now()
     WHERE max_user_id = $1 AND measure_id = $2::bigint AND status <> 'withdrawn'`,
    [userId, measureId, status]);
  return Boolean(result.rowCount);
}
