import { getProfile, getSessionState, saveActivityClassification, saveMaxUser, saveOperatingRegion, saveProfile, setSessionState } from '../db/profiles.js';
import type { MaxUser } from '../db/profiles.js';
import type { Database } from '../db/client.js';
import { extractIdentifier } from '../identifiers.js';
import { CheckoError, lookupOrganization } from '../integrations/checko_client.js';
import type { Organization } from '../integrations/checko_client.js';
import { ActivityClassificationError, classifyActivities } from '../integrations/gigachat_classifier.js';

type Lookup = typeof lookupOrganization;
type Classify = typeof classifyActivities;

function classificationFailure(error: unknown): string {
  if (error instanceof ActivityClassificationError) {
    console.error('GigaChat classification failed:', {
      reason: error.reason,
      status: error.status,
      code: error.code,
    });
    if (error.reason === 'configuration') return 'В настройках бота нет ключа GigaChat.';
    if (error.status === 401 || error.status === 403) return 'GigaChat не принял ключ или для него нет доступа к модели.';
    if (error.status === 429) return 'GigaChat ограничил частоту запросов. Попробуй позже.';
    if (error.reason === 'invalid_response') return 'GigaChat ответил в неожиданном формате. Попробуй ещё раз.';
    return 'GigaChat сейчас не ответил. Попробуй ещё раз позже.';
  }
  console.error('Activity classification failed:', error instanceof Error ? error.name : 'unknown');
  return 'Не удалось определить направления. Попробуй ещё раз позже.';
}

function okvedDescription(profile: Organization): string {
  const extra = [...new Set((profile.okvedExtraDetails ?? []).map((entry) => entry.name))];
  return [
    profile.okvedMainName ? `Основной ОКВЭД: ${profile.okvedMainName}` : '',
    extra.length ? `Дополнительные ОКВЭД: ${extra.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function formatProfile(profile: Organization): string {
  const lines = [
    profile.name,
    `ИНН: ${profile.inn}`,
    `${profile.entityType === 'entrepreneur' ? 'ОГРНИП' : 'ОГРН'}: ${profile.ogrn}`,
  ];
  if (profile.regionName) lines.push(`Регион регистрации: ${profile.regionName}`);
  if (profile.operatingRegionName) lines.push(`Регион работы хозяйства: ${profile.operatingRegionName}`);
  if (profile.okvedMain) lines.push(`Основной ОКВЭД: ${profile.okvedMain}`);
  if (profile.activityLabels?.length) lines.push(`Направления: ${profile.activityLabels.join(', ')}`);
  if (profile.legalStatus) lines.push(`Статус: ${profile.legalStatus}`);
  return lines.join('\n');
}

export async function handleStart(database: Database, user: MaxUser): Promise<string> {
  const userId = await saveMaxUser(database, user);
  const profile = await getProfile(database, userId);
  await setSessionState(database, userId, profile ? 'ready' : 'await_identifier');

  const greeting = user.first_name ? `Привет, ${user.first_name}!` : 'Привет!';
  if (profile) {
    return `${greeting} Я сохранил указанное тобой хозяйство:\n\n${formatProfile(profile)}\n\nПроверь направления и открой подбор кнопкой ниже. Уточнить деятельность: /activity <описание>.`;
  }
  return `${greeting} Я помогу найти меры поддержки для хозяйства. Пришли его ИНН (10 или 12 цифр) либо ОГРН/ОГРНИП (13 или 15 цифр).`;
}

export async function handleMessage(
  database: Database,
  user: MaxUser,
  text: string | null,
  lookup: Lookup = lookupOrganization,
  classify: Classify = classifyActivities,
): Promise<string> {
  const userId = await saveMaxUser(database, user);
  const message = text?.trim() ?? '';

  if (/^\/start(?:\s|$)/i.test(message)) return handleStart(database, user);
  if (/^\/help(?:\s|$)/i.test(message)) {
    return 'Пришли ИНН или ОГРН хозяйства. /support — подобрать поддержку, /catalog — каталог региона, /applications — мои заявки, /menu — меню, /profile — профиль, /region <название> — регион работы, /classify — повторить классификацию по ОКВЭД, /activity <описание> — уточнить направления работы, /change — другое хозяйство.';
  }
  if (/^\/profile(?:\s|$)/i.test(message)) {
    const profile = await getProfile(database, userId);
    return profile ? `Указанное хозяйство:\n\n${formatProfile(profile)}` : 'Профиль пока не заполнен. Пришли ИНН или ОГРН хозяйства.';
  }
  if (/^\/change(?:\s|$)/i.test(message)) {
    await setSessionState(database, userId, 'await_identifier');
    return 'Пришли ИНН или ОГРН другого хозяйства. Старый профиль сохранится, пока новый не будет найден.';
  }
  if (/^\/region(?:\s|$)/i.test(message)) {
    const profile = await getProfile(database, userId);
    if (!profile) return 'Сначала пришли ИНН или ОГРН хозяйства.';
    const region = message.replace(/^\/region\s*/i, '').trim().replace(/\s+/g, ' ');
    if (!region) return `Сейчас для подбора используется: ${profile.operatingRegionName ?? profile.regionName ?? 'регион не указан'}. Если хозяйство работает в другом регионе, напиши /region <название региона>.`;
    if (region.length > 100 || /[\d<>]/.test(region)) return 'Напиши название региона словами, например: /region Ивановская область.';
    await saveOperatingRegion(database, userId, region);
    return `Регион работы хозяйства: ${region}. Подбор обновится при следующем открытии /support.`;
  }
  if (/^\/classify(?:\s|$)/i.test(message)) {
    const profile = await getProfile(database, userId);
    if (!profile) return 'Сначала пришли ИНН или ОГРН хозяйства.';
    const description = okvedDescription(profile);
    if (!description) return 'У Checko нет названий ОКВЭД для этого хозяйства. Опиши его работу через /activity <описание>.';
    let labels: Organization['activityLabels'];
    try {
      labels = await classify(description);
    } catch (error) {
      return `${classificationFailure(error)} Повторить: /classify.`;
    }
    await saveActivityClassification(database, userId, null, labels);
    return labels.length
      ? `По зарегистрированным ОКВЭД выделил направления: ${labels.join(', ')}. Для уточнения фактической работы напиши /activity <описание>.`
      : 'По зарегистрированным ОКВЭД не удалось выделить сельскохозяйственные направления. Можно описать работу через /activity <описание>.';
  }
  if (/^\/activity(?:\s|$)/i.test(message)) {
    const profile = await getProfile(database, userId);
    if (!profile) return 'Сначала пришли ИНН или ОГРН хозяйства.';
    const description = message.replace(/^\/activity\s*/i, '').trim();
    if (!description) {
      return profile.activityLabels?.length
        ? `Сейчас отмечены направления: ${profile.activityLabels.join(', ')}. Чтобы уточнить, напиши /activity и опиши, что производит хозяйство.`
        : 'Напиши /activity и через пробел опиши, что выращивает, разводит или производит хозяйство.';
    }
    let labels: Organization['activityLabels'];
    try {
      labels = await classify(description);
    } catch (error) {
      return classificationFailure(error);
    }
    if (!labels.length) {
      return 'Не смог определить сельскохозяйственное направление по описанию. Уточни, что именно выращиваешь, разводишь или производишь.';
    }
    await saveActivityClassification(database, userId, description, labels);
    return `По твоему описанию выделил направления: ${labels.join(', ')}. Посмотреть профиль: /profile.`;
  }
  if (message.startsWith('/')) return 'Не знаю эту команду. Напиши /help.';

  const profile = await getProfile(database, userId);
  const state = await getSessionState(database, userId);
  if (profile && state !== 'await_identifier') {
    return `Профиль уже заполнен:\n\n${formatProfile(profile)}\n\nНапиши /activity <описание>, чтобы уточнить направления, или /change, чтобы заменить хозяйство.`;
  }
  if (state === null) await setSessionState(database, userId, 'await_identifier');

  const result = extractIdentifier(message);
  if (result.status === 'missing') {
    return 'Не вижу ИНН или ОГРН. Пришли один номер: 10/12 цифр для ИНН или 13/15 для ОГРН и ОГРНИП.';
  }
  if (result.status === 'multiple') return 'В сообщении несколько номеров. Пришли один ИНН или ОГРН.';
  if (result.status === 'invalid') return 'Контрольная цифра номера не сходится. Проверь ИНН или ОГРН и отправь ещё раз.';

  let organization: Organization;
  try {
    organization = await lookup(result.identifier);
  } catch (error) {
    if (error instanceof CheckoError && error.reason === 'not_found') {
      return 'Не нашёл организацию или ИП по этому номеру. Проверь его и попробуй ещё раз.';
    }
    if (error instanceof CheckoError) {
      return 'Сервис проверки сейчас не ответил. Попробуй отправить номер чуть позже.';
    }
    throw error;
  }

  await saveProfile(database, userId, organization);
  await setSessionState(database, userId, 'ready');
  const activityText = okvedDescription(organization);
  if (activityText) {
    let labels: Organization['activityLabels'];
    try {
      labels = await classify(activityText);
    } catch (error) {
      return `Нашёл и сохранил хозяйство по данным Checko:\n\n${formatProfile(organization)}\n\n${classificationFailure(error)} Повторить по ОКВЭД: /classify.`;
    }
    organization.activityLabels = labels;
    await saveActivityClassification(database, userId, null, labels);
  }
  return `Нашёл и сохранил хозяйство по данным Checko:\n\n${formatProfile(organization)}\n\nПроверь направления и открой подбор кнопкой ниже. Чтобы уточнить фактическую работу, напиши /activity <описание>. Если это не то хозяйство, напиши /change.`;
}
