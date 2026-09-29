import assert from 'node:assert/strict';
import { createDatabase, applyMigrations } from '../dist/db/client.js';
import { handleMessage, handleStart } from '../dist/bots/support_scenario.js';
import { getProfile } from '../dist/db/profiles.js';
import { extractIdentifier } from '../dist/identifiers.js';
import { ActivityClassificationError, parseActivityResponse } from '../dist/integrations/gigachat_classifier.js';
import { ACTIVITY_RESPONSE_FORMAT, activityClassificationMessages } from '../dist/prompts/activity_classification.js';

assert.deepEqual(parseActivityResponse('{"activities":["пищевые яйца","картофель"]}'), [
  'пищевые яйца', 'картофель', 'птицеводство', 'растениеводство', 'животноводство',
]);
assert.deepEqual(parseActivityResponse('{"activities":[]}'), []);
assert.throws(() => parseActivityResponse('{"activities":["выдуманная метка"]}'));
const prompt = activityClassificationMessages('Выращиваем картофель');
assert.equal(prompt[0].role, 'system');
assert.equal(prompt.at(-1).content, 'Выращиваем картофель');
assert.ok(prompt.some((message) => message.role === 'assistant' && message.content === '{"activities":[]}'));
assert.equal(ACTIVITY_RESPONSE_FORMAT.type, 'json_schema');
assert.deepEqual(ACTIVITY_RESPONSE_FORMAT.schema.required, ['activities']);
assert.ok(ACTIVITY_RESPONSE_FORMAT.schema.properties.activities.items.enum.includes('птицеводство'));

for (const [value, entityType] of [
  ['4027148080', 'company'],
  ['402907671076', 'entrepreneur'],
  ['1224000000278', 'company'],
  ['310402910200035', 'entrepreneur'],
]) {
  const parsed = extractIdentifier(`Номер: ${value}`);
  assert.equal(parsed.status, 'valid');
  assert.equal(parsed.identifier.entityType, entityType);
}
assert.equal(extractIdentifier('4027148081').status, 'invalid');
assert.equal(extractIdentifier('4027148080 и 1224000000278').status, 'multiple');

const database = createDatabase();
const user = { user_id: -Date.now(), first_name: 'Тест', username: null };
const userId = String(user.user_id);

try {
  await applyMigrations(database);
  assert.match(await handleStart(database, user), /ИНН/);
  const reply = await handleMessage(database, user, 'ИНН 4027148080', async () => ({
    entityType: 'company',
    inn: '4027148080',
    ogrn: '1224000000278',
    name: 'Тестовое хозяйство',
    regionCode: '37',
    regionName: 'Ивановская область',
    opf: 'ООО',
    okvedMain: '01.41',
    okvedExtra: [],
    okvedMainName: 'Разведение молочного крупного рогатого скота, производство сырого молока',
    okvedExtraDetails: [],
    registrationDate: '2022-01-18',
    legalStatus: 'Действует',
  }), async () => ['молочное скотоводство']);
  assert.match(reply, /сохранил/);
  assert.equal((await getProfile(database, userId))?.inn, '4027148080');
  assert.deepEqual((await getProfile(database, userId))?.activityLabels, ['молочное скотоводство']);
  assert.match(await handleMessage(database, user, '/classify', undefined, async () => ['молочное скотоводство']), /молочное скотоводство/);
  assert.match(await handleMessage(database, user, '/classify', undefined, async () => {
    throw new ActivityClassificationError('api_error', 429);
  }), /частоту запросов/);
  assert.match(await handleMessage(database, user, '/profile'), /Ивановская область/);
  assert.match(await handleMessage(database, user, '/activity Развожу кур и продаю яйца', undefined, async () => ['птицеводство', 'пищевые яйца']), /пищевые яйца/);
  assert.deepEqual((await getProfile(database, userId))?.activityLabels, ['птицеводство', 'пищевые яйца']);
  assert.match(await handleMessage(database, user, '/change'), /Пришли ИНН/);
  console.log('ONBOARDING_SMOKE_OK');
} finally {
  await database.query('DELETE FROM users WHERE max_user_id = $1', [userId]);
  await database.end();
}
