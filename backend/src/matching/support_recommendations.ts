import type { ActivityLabel } from '../activity_labels.js';

export type SupportMeasure = {
  id: string;
  title: string;
  region: string | null;
  kind: 'measure' | 'selection';
  sourceUrl: string;
  applicationUrl: string | null;
  description: string;
  shortDescription: string | null;
  terms: string;
  amount: string | null;
  supportType: string | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  updatedAt: string;
  activityLabels: ActivityLabel[];
  activityExclusions: ActivityLabel[];
  activityScope: 'specific' | 'all' | 'unknown';
  activityStatus: string;
};

// Parent labels are used only in the matching direction: a broad measure can fit
// a narrow farm. A broad farm label does not prove a narrow measure fits it.
const PARENTS: Partial<Record<ActivityLabel, ActivityLabel[]>> = {
  зерновые: ['растениеводство'], зернобобовые: ['растениеводство'], масличные: ['растениеводство'],
  картофель: ['растениеводство'], овощи: ['растениеводство'], 'тепличное хозяйство': ['растениеводство'],
  ягоды: ['растениеводство'], 'плодовые культуры': ['растениеводство'],
  'кормовые культуры': ['растениеводство'], лён: ['растениеводство'],
  'техническая конопля': ['растениеводство'], семеноводство: ['растениеводство'],
  'рассада и питомники': ['растениеводство'],
  'молочное скотоводство': ['животноводство'], 'мясное скотоводство': ['животноводство'],
  свиноводство: ['животноводство'], овцеводство: ['животноводство'],
  козоводство: ['животноводство'], коневодство: ['животноводство'],
  кролиководство: ['животноводство'], птицеводство: ['животноводство'],
  'пищевые яйца': ['птицеводство'], 'инкубация и молодняк птицы': ['птицеводство'],
  пчеловодство: ['животноводство'], 'племенное животноводство': ['животноводство'],
  'переработка молока': ['переработка сельхозпродукции'],
  'переработка мяса': ['переработка сельхозпродукции'],
  'переработка зерна': ['переработка сельхозпродукции'],
  'переработка овощей и фруктов': ['переработка сельхозпродукции'],
  'производство кормов': ['переработка сельхозпродукции'],
};

function ancestors(label: ActivityLabel): ActivityLabel[] {
  const direct = PARENTS[label] ?? [];
  return [...direct, ...direct.flatMap(ancestors)];
}

function supports(measureLabel: ActivityLabel, userLabel: ActivityLabel): boolean {
  return measureLabel === userLabel || ancestors(userLabel).includes(measureLabel);
}

function regionMatches(measureRegion: string | null, userRegion: string | null): boolean {
  if (!measureRegion) return true;
  if (!userRegion) return false;
  const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/\s+/g, ' ').trim();
  return normalize(measureRegion) === normalize(userRegion);
}

export type Recommendation = {
  measure: SupportMeasure;
  matchedLabels: ActivityLabel[];
  exclusionConflict: boolean;
  provisional: boolean;
  timing: 'open' | 'upcoming' | 'unknown';
  score: number;
};

export function currentDateMoscow(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function recommendMeasures(
  measures: SupportMeasure[], userLabels: ActivityLabel[], userRegion: string | null,
  today = currentDateMoscow(),
): Recommendation[] {
  const scored: Recommendation[] = [];
  for (const measure of measures) {
    const provisional = measure.activityStatus === 'needs_review';
    if (measure.activityStatus !== 'classified' && !provisional) continue;
    if (measure.activityScope === 'unknown' || (provisional && measure.activityScope !== 'specific')) continue;
    if (!regionMatches(measure.region, userRegion)) continue;
    if (!measure.applicationDeadline || measure.applicationDeadline < today) continue;
    const leafLabels = userLabels.filter((label) => !userLabels.some((other) =>
      other !== label && ancestors(other).includes(label)));
    const eligibleLabels = leafLabels.filter((label) =>
      !measure.activityExclusions.some((excluded) => supports(excluded, label)));
    if (!eligibleLabels.length) continue;
    const matchedLabels = measure.activityScope === 'all'
      ? []
      : measure.activityLabels.filter((label) => eligibleLabels.some((userLabel) => supports(label, userLabel)));
    if (measure.activityScope !== 'all' && !matchedLabels.length) continue;

    const exclusionConflict = eligibleLabels.length < leafLabels.length;
    const exact = matchedLabels.filter((label) => eligibleLabels.includes(label)).length;
    const timing = measure.applicationStart && measure.applicationDeadline
      ? measure.applicationStart > today ? 'upcoming' : 'open'
      : 'unknown';
    const score = (measure.activityScope === 'all' ? 1 : 10 + exact * 5 + matchedLabels.length)
      + (measure.kind === 'selection' ? 2 : 0) - (exclusionConflict ? 4 : 0)
      - (provisional ? 100 : 0);
    scored.push({ measure, matchedLabels, exclusionConflict, provisional, timing, score });
  }
  return scored.sort((a, b) =>
    b.score - a.score ||
    (a.measure.applicationDeadline ?? '9999').localeCompare(b.measure.applicationDeadline ?? '9999') ||
    a.measure.id.localeCompare(b.measure.id));
}
