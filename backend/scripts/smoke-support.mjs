import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyMigrations, createDatabase } from '../dist/db/client.js';
import { saveMaxUser, saveProfile, setSessionState } from '../dist/db/profiles.js';
import { handleCatalogAction, openApplications, openCatalog, openRecommendations } from '../dist/bots/support_catalog.js';
import { getApplicationStatus } from '../dist/db/support.js';
import { handleMessage } from '../dist/bots/support_scenario.js';

const database = createDatabase();
const suffix = randomUUID();
const source = `smoke_support_${suffix}`;
const user = { user_id: -Date.now(), first_name: 'Тест', username: null };
const userId = String(user.user_id);

try {
  await applyMigrations(database);
  await saveMaxUser(database, user);
  await saveProfile(database, userId, {
    entityType: 'company', inn: '4027148080', ogrn: '1224000000278',
    name: 'Тестовое хозяйство', regionCode: '37', regionName: 'Ивановская область',
    opf: 'ООО', okvedMain: '01.47', okvedExtra: [], okvedMainName: 'Разведение птицы',
    okvedExtraDetails: [], activityLabels: ['пищевые яйца', 'птицеводство', 'животноводство'],
    registrationDate: '2022-01-18', legalStatus: 'Действует',
  });
  await setSessionState(database, userId, 'ready');
  const inserted = await database.query(
    `INSERT INTO support_measures
       (source, external_id, source_url, title, region, kind, description, content_hash,
        activity_labels, activity_scope, activity_status, application_start, application_deadline)
     VALUES ($1, 'egg', 'https://example.org/egg', 'Поддержка производства яиц',
             'Ивановская область', 'selection', 'Тестовая мера для птицеводства', $2,
             ARRAY['пищевые яйца'], 'specific', 'classified', '2026-01-01', '2099-12-31')
     RETURNING id::text`, [source, suffix]);
  const id = inserted.rows[0].id;
  await database.query(
    `INSERT INTO support_documents (measure_id, url, title, extraction_status)
     VALUES ($1::bigint, 'https://example.org/egg/announcement.pdf', 'Объявление об отборе', 'not_fetched')`, [id]);
  const regionReply = await handleMessage(database, user, '/region Ивановская область');
  assert.match(regionReply, /Регион работы/);
  assert.match((await openCatalog(database, userId)).text, /Каталог региона/);
  const first = await openRecommendations(database, userId);
  assert.match(first.text, /Поддержка производства яиц/);
  assert.match(first.text, /https:\/\/example\.org\/egg/);
  assert.match(first.text, /https:\/\/example\.org\/egg\/announcement\.pdf/);
  assert.ok(first.buttons.flat().some((button) => button.type === 'link' && button.url.endsWith('announcement.pdf')));
  const add = first.buttons.flat().find((button) => button.type === 'callback' && button.text.includes('Хочу податься'));
  assert.ok(add);
  const saved = await handleCatalogAction(database, userId, add.payload);
  assert.match(saved.text, /Добавлено в «Мои заявки»/);
  assert.equal(await getApplicationStatus(database, userId, id), 'preparing');
  const list = await openApplications(database, userId);
  assert.match(list.text, /Готовлю документы/);
  const submitted = list.buttons.flat().find((button) => button.type === 'callback' && button.text === 'Отметить поданной');
  assert.ok(submitted);
  await handleCatalogAction(database, userId, submitted.payload);
  assert.equal(await getApplicationStatus(database, userId, id), 'submitted');
  const stale = await handleCatalogAction(database, userId, add.payload);
  assert.match(stale.text, /устарела/);
  console.log('SUPPORT_SMOKE_OK');
} finally {
  try {
    await database.query('DELETE FROM users WHERE max_user_id = $1', [userId]);
    await database.query('DELETE FROM support_measures WHERE source = $1', [source]);
  } finally {
    await database.end();
  }
}
