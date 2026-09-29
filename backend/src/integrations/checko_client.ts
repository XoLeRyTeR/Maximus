import { getCheckoKey } from '../config.js';
import type { Identifier } from '../identifiers.js';
import type { ActivityLabel } from '../activity_labels.js';

export type Organization = {
  entityType: 'company' | 'entrepreneur';
  inn: string;
  ogrn: string;
  name: string;
  regionCode: string | null;
  regionName: string | null;
  operatingRegionName?: string | null;
  opf: string | null;
  okvedMain: string | null;
  okvedExtra: string[];
  okvedMainName?: string | null;
  okvedExtraDetails?: { code: string; name: string }[];
  activityDescription?: string | null;
  activityLabels?: ActivityLabel[];
  registrationDate: string | null;
  legalStatus: string | null;
};

export class CheckoError extends Error {
  constructor(readonly reason: 'not_found' | 'unavailable' | 'invalid_response') {
    super(`Checko lookup failed: ${reason}`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nestedString(data: Record<string, unknown>, field: string, nested: string): string | null {
  return nonempty(record(data[field])?.[nested]);
}

export function normalizeChecko(data: unknown, identifier: Identifier): Organization {
  const item = record(data);
  if (!item) throw new CheckoError('not_found');

  const inn = nonempty(item['ИНН']);
  const ogrn = nonempty(item['ОГРН']) ?? nonempty(item['ОГРНИП']);
  const name = identifier.entityType === 'company'
    ? nonempty(item['НаимСокр']) ?? nonempty(item['НаимПолн'])
    : nonempty(item['ФИО']) && `${nonempty(item['ТипСокр']) ?? 'ИП'} ${nonempty(item['ФИО'])}`;

  if (!inn || !ogrn || !name || (identifier.kind === 'inn' ? inn : ogrn) !== identifier.value) {
    throw new CheckoError('invalid_response');
  }

  const additional = Array.isArray(item['ОКВЭДДоп']) ? item['ОКВЭДДоп'] : [];
  const extraDetails = additional.map((entry) => {
    const code = nonempty(record(entry)?.['Код']);
    const name = nonempty(record(entry)?.['Наим']);
    return code && name ? { code, name } : null;
  }).filter((entry): entry is { code: string; name: string } => entry !== null);
  const rawDate = nonempty(item['ДатаРег']);

  return {
    entityType: identifier.entityType,
    inn,
    ogrn,
    name,
    regionCode: nestedString(item, 'Регион', 'Код'),
    regionName: nestedString(item, 'Регион', 'Наим'),
    opf: nestedString(item, 'ОКОПФ', 'Наим') ?? nonempty(item['Тип']),
    okvedMain: nestedString(item, 'ОКВЭД', 'Код'),
    okvedExtra: additional.map((entry) => nonempty(record(entry)?.['Код'])).filter((code): code is string => code !== null),
    okvedMainName: nestedString(item, 'ОКВЭД', 'Наим'),
    okvedExtraDetails: extraDetails,
    registrationDate: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    legalStatus: nestedString(item, 'Статус', 'Наим'),
  };
}

export async function lookupOrganization(identifier: Identifier): Promise<Organization> {
  const url = new URL(`https://api.checko.ru/v2/${identifier.entityType}`);
  url.searchParams.set('key', getCheckoKey());
  url.searchParams.set(identifier.kind, identifier.value);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new CheckoError('unavailable');
  }

  if (response.status === 404) throw new CheckoError('not_found');
  if (!response.ok) throw new CheckoError('unavailable');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CheckoError('invalid_response');
  }

  const envelope = record(payload);
  const metaStatus = nonempty(record(envelope?.meta)?.status);
  if (metaStatus && metaStatus !== 'ok') throw new CheckoError('unavailable');
  return normalizeChecko(envelope?.data, identifier);
}
