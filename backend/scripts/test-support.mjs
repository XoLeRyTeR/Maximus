import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendMeasures } from '../dist/matching/support_recommendations.js';

const base = {
  id: '1', title: 'Поддержка', region: 'Ивановская область', kind: 'selection',
  sourceUrl: 'https://example.org', applicationUrl: null, description: '',
  shortDescription: null, terms: '', amount: null, supportType: null,
  applicationStart: '2026-01-01', applicationDeadline: '2026-12-31',
  updatedAt: '2026-01-01', activityLabels: [], activityExclusions: [],
  activityScope: 'specific', activityStatus: 'classified',
};

test('matching is directional across the activity hierarchy', () => {
  const measures = [
    { ...base, id: '1', activityLabels: ['молочное скотоводство'] },
    { ...base, id: '2', activityLabels: ['животноводство'] },
    { ...base, id: '3', activityLabels: ['пищевые яйца'] },
  ];
  const eggFarm = recommendMeasures(measures, ['пищевые яйца', 'птицеводство', 'животноводство'], 'Ивановская область', '2026-06-01');
  assert.deepEqual(eggFarm.map((x) => x.measure.id).sort(), ['2', '3']);
  const broadFarm = recommendMeasures(measures, ['животноводство'], 'Ивановская область', '2026-06-01');
  assert.deepEqual(broadFarm.map((x) => x.measure.id), ['2']);
});

test('region, deadline, classification and exclusions restrict recommendations', () => {
  const measures = [
    { ...base, id: '1', activityLabels: ['картофель'], applicationDeadline: '2025-01-01' },
    { ...base, id: '2', activityLabels: ['картофель'], region: 'Другая область' },
    { ...base, id: '3', activityLabels: ['картофель'], activityStatus: 'needs_review' },
    { ...base, id: '4', region: null, activityScope: 'all', activityExclusions: ['картофель'] },
    { ...base, id: '5', region: null, activityScope: 'all' },
    { ...base, id: '6', activityLabels: ['картофель'], applicationDeadline: null },
  ];
  assert.deepEqual(recommendMeasures(measures, ['картофель'], 'Ивановская область', '2026-06-01').map((x) => x.measure.id), ['5', '3']);
});

test('a mixed farm keeps eligible directions when another direction is excluded', () => {
  const measure = { ...base, activityScope: 'all', activityExclusions: ['молочное скотоводство'] };
  assert.equal(recommendMeasures([measure], ['молочное скотоводство', 'животноводство'], 'Ивановская область', '2026-06-01').length, 0);
  const mixed = recommendMeasures([measure], ['молочное скотоводство', 'пищевые яйца', 'птицеводство', 'животноводство'], 'Ивановская область', '2026-06-01');
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].exclusionConflict, true);
});

test('reviewed directions appear after confirmed matches with an explicit provisional flag', () => {
  const measures = [
    { ...base, id: '1', activityLabels: ['птицеводство'], activityStatus: 'needs_review' },
    { ...base, id: '2', activityLabels: ['птицеводство'] },
    { ...base, id: '3', activityLabels: ['птицеводство'], activityStatus: 'pending' },
    { ...base, id: '4', activityScope: 'all', activityStatus: 'needs_review' },
  ];
  const result = recommendMeasures(measures, ['птицеводство'], 'Ивановская область', '2026-06-01');
  assert.deepEqual(result.map((x) => x.measure.id), ['2', '1']);
  assert.equal(result[1].provisional, true);
});
