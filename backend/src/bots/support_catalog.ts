import { Keyboard } from '@maxhub/max-bot-api';
import type { Database } from '../db/client.js';
import { getProfile } from '../db/profiles.js';
import {
  getApplicationStatus, getMeasureDocumentLinks, getMeasuresByIds, getNavigation, listApplicationIds,
  listCatalogMeasures, listMeasures, moveNavigation, saveApplication, setNavigation,
  updateApplicationStatus,
} from '../db/support.js';
import type { ApplicationStatus, SupportNavigation } from '../db/support.js';
import { currentDateMoscow, recommendMeasures } from '../matching/support_recommendations.js';
import type { SupportMeasure } from '../matching/support_recommendations.js';

type Button = Parameters<typeof Keyboard.inlineKeyboard>[0][number][number];
export type CatalogView = { text: string; buttons: Button[][] };
const action = Keyboard.button.callback;
const link = Keyboard.button.link;

export const MENU_BUTTONS: Button[][] = [
  [action('🌾 Моё хозяйство', 'support:profile'), action('📋 Мои заявки', 'support:applications')],
  [action('🔎 Подобрать поддержку', 'support:open')],
  [action('📚 Каталог региона', 'support:catalog')],
];

function cleanText(value: string | null | undefined, max = 450): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

function dateText(date: string | null): string {
  if (!date) return 'не указан';
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function statusText(status: ApplicationStatus | null): string {
  return ({
    preparing: 'Готовлю документы', submitted: 'Подана', approved: 'Одобрена',
    rejected: 'Отказ', withdrawn: 'Передумал',
  } as Record<ApplicationStatus, string>)[status ?? 'preparing'];
}

async function card(database: Database, userId: string, nav: SupportNavigation): Promise<CatalogView> {
  const id = nav.ids[nav.position];
  const measure = (await getMeasuresByIds(database, [id]))[0];
  if (!measure) return { text: 'Эта карточка больше не доступна. Открой подбор заново.', buttons: MENU_BUTTONS };
  if (nav.mode !== 'applications' &&
      (!measure.applicationDeadline || measure.applicationDeadline < currentDateMoscow())) {
    return { text: 'Срок подачи этой меры не подтверждён или уже прошёл. Открой актуальный список заново.', buttons: MENU_BUTTONS };
  }
  const status = await getApplicationStatus(database, userId, id);
  const profile = await getProfile(database, userId);
  const match = profile ? recommendMeasures([measure], profile.activityLabels ?? [], profile.operatingRegionName ?? profile.regionName)[0] : undefined;
  const intro = nav.mode === 'applications' ? 'Мои заявки'
    : nav.mode === 'catalog' ? 'Каталог региона' : 'Поддержка вашего хозяйства';
  const lines = [
    `${intro} · ${nav.position + 1} из ${nav.ids.length}`,
    '', measure.title,
    '', cleanText(measure.shortDescription || measure.description || measure.terms, 520) || 'Описание уточняется в источнике.',
  ];


  if (nav.mode === 'recommendations') {
    if (measure.activityStatus === 'needs_review') {
      lines.push('', '⚠️ Предварительное совпадение. Направления этой меры ещё проверяются по документам.');
    }
    lines.push('', `Почему предложено: ${match?.matchedLabels.length ? match.matchedLabels.join(', ') : 'общая мера для сельхозпроизводителей'}.`);
    if (match?.exclusionConflict) lines.push('⚠️ В условиях есть исключение по одному из ваших направлений. Проверьте применимость.');
  } else if (nav.mode === 'catalog') {
    lines.push('', 'Направления и право на поддержку по этой мере ещё нужно проверить.');
  } else {
    lines.push('', `Статус: ${statusText(status)}`);
  }
  lines.push(`📍 ${measure.region ?? 'Федеральная мера'}`);
  if (measure.supportType) lines.push(`Тип: ${cleanText(measure.supportType, 100)}`);
  if (measure.amount) lines.push(`💰 ${cleanText(measure.amount, 160)}`);
  if (measure.applicationStart && measure.applicationDeadline) {
    lines.push(`📅 Приём заявок: ${dateText(measure.applicationStart)} — ${dateText(measure.applicationDeadline)}`);
    if (measure.applicationStart > currentDateMoscow()) {
      lines.push('Приём заявок ещё не начался.');
    }
  } else if (measure.applicationDeadline) {
    lines.push(`📅 Дедлайн: ${dateText(measure.applicationDeadline)}. Дата начала не подтверждена.`);
  } else if (measure.applicationStart) {
    lines.push(`📅 Начало приёма: ${dateText(measure.applicationStart)}. Дедлайн не подтверждён.`);
  } else {
    lines.push('📅 Сроки приёма не подтверждены. Проверьте условия по ссылке.');
  }
  if (measure.kind === 'measure') lines.push('Это программа поддержки; наличие открытого отбора проверьте в источнике.');
  if (measure.terms && cleanText(measure.terms, 270) !== cleanText(measure.description, 270)) {
    lines.push('', `Условия: ${cleanText(measure.terms, 270)}`);
  }
  const buttons: Button[][] = [];
  const sourceUrl = safeLink(measure.sourceUrl);
  const applicationUrl = safeLink(measure.applicationUrl);
  const document = (await getMeasureDocumentLinks(database, id))
    .map((item) => ({ title: item.title, url: safeLink(item.url) }))
    .find((item) => item.url);
  lines.push('', 'Ссылки:');
  if (sourceUrl) {
    lines.push(`🔗 Сайт с условиями: ${sourceUrl}`);
    buttons.push([link('🌐 Открыть сайт', sourceUrl)]);
  }
  if (document?.url && document.url !== sourceUrl) {
    lines.push(`📄 ${cleanText(document.title, 80) || 'Объявление'}: ${document.url}`);
    buttons.push([link('📄 Открыть объявление', document.url)]);
  }
  if (applicationUrl && applicationUrl !== sourceUrl && applicationUrl !== document?.url) {
    lines.push(`✍️ Страница подачи: ${applicationUrl}`);
    buttons.push([link('✍️ Перейти к подаче', applicationUrl)]);
  } else {
    lines.push('Прямая ссылка на подачу пока не подтверждена. Порядок подачи смотри в объявлении.');
  }
  if (!sourceUrl && !document?.url && !applicationUrl) lines.push('Ссылка на источник пока не проверена.');
  lines.push('', 'Совпадение направления не подтверждает право на получение поддержки.');

  if (nav.mode === 'recommendations' || nav.mode === 'catalog') {
    buttons.push([action(status && status !== 'withdrawn' ? '✓ В моих заявках' : '✅ Хочу податься', `support:add:${nav.token}:${id}`)]);
  } else if (status === 'preparing') {
    buttons.push([action('Отметить поданной', `support:status:${nav.token}:${id}:submitted`)]);
  } else if (status === 'submitted') {
    buttons.push([
      action('Одобрена', `support:status:${nav.token}:${id}:approved`),
      action('Отказ', `support:status:${nav.token}:${id}:rejected`),
    ]);
  }
  if (nav.mode === 'applications') {
    buttons.push([action('Убрать из моих заявок', `support:status:${nav.token}:${id}:withdrawn`)]);
  }
  const arrows: Button[] = [];
  if (nav.position > 0) arrows.push(action('⬅️ Назад', `support:move:${nav.token}:${id}:-1`));
  if (nav.position < nav.ids.length - 1) arrows.push(action('Вперёд ➡️', `support:move:${nav.token}:${id}:1`));
  if (arrows.length) buttons.push(arrows);
  buttons.push([action('🏠 Меню', 'support:menu')]);
  return { text: lines.join('\n'), buttons };
}

export function menuView(): CatalogView {
  return { text: 'Что хочешь сделать?', buttons: MENU_BUTTONS };
}

export async function openRecommendations(database: Database, userId: string): Promise<CatalogView> {
  const profile = await getProfile(database, userId);
  if (!profile) return { text: 'Сначала пришли ИНН или ОГРН хозяйства.', buttons: MENU_BUTTONS };
  if (!profile.activityLabels?.length) {
    return { text: 'Направления хозяйства пока не определены. Опиши работу через /activity <описание> или повтори классификацию: /classify.', buttons: MENU_BUTTONS };
  }
  const recommendations = recommendMeasures(await listMeasures(database), profile.activityLabels, profile.operatingRegionName ?? profile.regionName);
  if (!recommendations.length) {
    return { text: 'Пока не нашёл мер с совпадающими направлениями для вашего региона. Разметка каталога ещё идёт. Можно посмотреть общий каталог региона и проверить условия вручную.', buttons: MENU_BUTTONS };
  }
  const nav = await setNavigation(database, userId, 'recommendations', recommendations.map((item) => item.measure.id));
  return card(database, userId, nav);
}

export async function openCatalog(database: Database, userId: string): Promise<CatalogView> {
  const profile = await getProfile(database, userId);
  if (!profile) return { text: 'Сначала пришли ИНН или ОГРН хозяйства.', buttons: MENU_BUTTONS };
  const measures = await listCatalogMeasures(database, profile.operatingRegionName ?? profile.regionName);
  if (!measures.length) return { text: 'В каталоге пока нет мер для этого региона с подтверждённым будущим дедлайном.', buttons: MENU_BUTTONS };
  const nav = await setNavigation(database, userId, 'catalog', measures.map((item) => item.id));
  return card(database, userId, nav);
}

export async function openApplications(database: Database, userId: string): Promise<CatalogView> {
  const ids = await listApplicationIds(database, userId);
  if (!ids.length) return { text: 'В «Моих заявках» пока пусто. Открой подбор и нажми «Хочу податься» на подходящей мере.', buttons: MENU_BUTTONS };
  const nav = await setNavigation(database, userId, 'applications', ids);
  return card(database, userId, nav);
}

export async function handleCatalogAction(database: Database, userId: string, payload: string): Promise<CatalogView> {
  if (payload === 'support:menu') return menuView();
  if (payload === 'support:open') return openRecommendations(database, userId);
  if (payload === 'support:catalog') return openCatalog(database, userId);
  if (payload === 'support:applications') return openApplications(database, userId);
  if (payload === 'support:help') return {
    text: 'Пришли ИНН или ОГРН для регистрации. Затем проверь направления через /profile или /activity <описание> и открой подбор. «Хочу податься» сохраняет меру в «Мои заявки»; заявление в ведомство отправляется по ссылке из карточки.',
    buttons: MENU_BUTTONS,
  };
  if (payload === 'support:profile') {
    const profile = await getProfile(database, userId);
    return {
      text: profile
        ? `${profile.name}\nРегион регистрации: ${profile.regionName ?? 'не указан'}\nРегион работы: ${profile.operatingRegionName ?? profile.regionName ?? 'не указан'}\nНаправления: ${profile.activityLabels?.join(', ') || 'не определены'}\n\nУточнить деятельность: /activity <описание>\nИзменить регион работы: /region <название>\nДругое хозяйство: /change`
        : 'Профиль пока не заполнен. Пришли ИНН или ОГРН хозяйства.',
      buttons: MENU_BUTTONS,
    };
  }
  const parts = payload.split(':');
  if (parts[0] !== 'support' || !['move', 'add', 'status'].includes(parts[1])) return menuView();
  const nav = await getNavigation(database, userId);
  const [, operation, token, id, value] = parts;
  if (!nav || token !== nav.token || id !== nav.ids[nav.position]) {
    return { text: 'Карточка устарела. Открой подбор или «Мои заявки» заново.', buttons: MENU_BUTTONS };
  }
  if (operation === 'move') {
    const delta = Number(value);
    if (![-1, 1].includes(delta) || nav.position + delta < 0 || nav.position + delta >= nav.ids.length) return card(database, userId, nav);
    nav.position += delta;
    await moveNavigation(database, userId, nav.token, nav.position);
    return card(database, userId, nav);
  }
  if (operation === 'add' && (nav.mode === 'recommendations' || nav.mode === 'catalog')) {
    await saveApplication(database, userId, id);
    const view = await card(database, userId, nav);
    view.text += '\n\nДобавлено в «Мои заявки». Заявление в ведомство ещё не отправлено.';
    return view;
  }
  if (operation === 'status' && nav.mode === 'applications' && ['submitted', 'approved', 'rejected', 'withdrawn'].includes(value)) {
    const current = await getApplicationStatus(database, userId, id);
    if ((current === 'preparing' && value === 'submitted') ||
        (current === 'submitted' && ['approved', 'rejected'].includes(value)) ||
        (current && current !== 'withdrawn' && value === 'withdrawn')) {
      await updateApplicationStatus(database, userId, id, value as ApplicationStatus);
    }
    if (value === 'withdrawn') return openApplications(database, userId);
    return card(database, userId, nav);
  }
  return card(database, userId, nav);
}

export function catalogAttachment(view: CatalogView) {
  return Keyboard.inlineKeyboard(view.buttons);
}
