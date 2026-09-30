import { Bot } from '@maxhub/max-bot-api';
import type { Context } from '@maxhub/max-bot-api';
import { getBotToken } from '../config.js';
import type { Database } from '../db/client.js';
import { handleMessage, handleStart } from './support_scenario.js';
import { catalogAttachment, handleCatalogAction, MENU_BUTTONS, menuView, openApplications, openCatalog, openRecommendations } from './support_catalog.js';
import { saveMaxUser } from '../db/profiles.js';
import type { CatalogView } from './support_catalog.js';
import { setTimeout as delay } from 'node:timers/promises';

function logHandlerError(label: string, error: unknown): void {
  const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;
  const details = error instanceof Error
    ? `${error.name}: ${error.message}${causeCode ? `; cause code: ${causeCode}` : ''}${causeMessage ? `; cause: ${causeMessage}` : ''}`
    : 'unknown error';
  const secrets = [process.env.BOT_TOKEN_MAX, process.env.CHECKO_API, process.env.DATABASE_URL, process.env.GIGA_API_KEY]
    .filter((value): value is string => Boolean(value));
  const safeDetails = secrets.reduce((message, secret) => message.replaceAll(secret, '[redacted]'), details);
  console.error(`${label}: ${safeDetails}`);
}

export async function retryMaxDelivery<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof TypeError && error.message === 'fetch failed') || attempt === 2) throw error;
      await delay(300 * (attempt + 1));
    }
  }
}

async function sendReply(ctx: Context, userId: number, text: string, view?: CatalogView): Promise<void> {
  const extra = view ? { attachments: [catalogAttachment(view)] } : undefined;
  await retryMaxDelivery(async () => {
    if (ctx.chatId != null) {
      await ctx.reply(text, extra);
    } else {
      // MAX may omit chat_id for a direct message; ctx.reply then throws a TypeError.
      await ctx.api.sendMessageToUser(userId, text, extra);
    }
  });
}

export function createMaxBot(database: Database): Bot {
  const bot = new Bot(getBotToken());

  bot.on('bot_started', async (ctx) => {
    let greeting: string;
    try {
      greeting = await handleStart(database, ctx.user);
    } catch (error) {
      logHandlerError('Bot start processing failed', error);
      greeting = 'Не удалось открыть профиль. Попробуй ещё раз позже.';
    }
    try {
      await sendReply(ctx, ctx.user.user_id, greeting, { text: greeting, buttons: MENU_BUTTONS });
    } catch (error) {
      logHandlerError('MAX start reply failed', error);
    }
  });

  bot.on('message_created', async (ctx) => {
    const user = ctx.message.sender;
    if (!user || user.is_bot) return;
    let reply: string;
    let view: CatalogView;
    try {
      const message = ctx.message.body.text?.trim() ?? '';
      const userId = await saveMaxUser(database, user);
      if (/^\/(?:support|find)(?:\s|$)/i.test(message)) {
        view = await openRecommendations(database, userId);
      } else if (/^\/applications(?:\s|$)/i.test(message)) {
        view = await openApplications(database, userId);
      } else if (/^\/catalog(?:\s|$)/i.test(message)) {
        view = await openCatalog(database, userId);
      } else if (/^\/menu(?:\s|$)/i.test(message)) {
        view = menuView();
      } else {
        reply = await handleMessage(database, user, ctx.message.body.text);
        view = { text: reply, buttons: MENU_BUTTONS };
      }
    } catch (error) {
      logHandlerError('Message processing failed', error);
      view = { text: 'Не удалось обработать сообщение. Попробуй ещё раз позже.', buttons: MENU_BUTTONS };
    }
    try {
      await sendReply(ctx, user.user_id, view.text, view);
    } catch (error) {
      logHandlerError('MAX message reply failed', error);
    }
  });

  bot.on('message_callback', async (ctx) => {
    const user = ctx.callback.user;
    if (!user || user.is_bot) return;
    let view: CatalogView;
    try {
      const userId = await saveMaxUser(database, user);
      view = await handleCatalogAction(database, userId, ctx.callback.payload ?? '');
    } catch (error) {
      logHandlerError('Callback processing failed', error);
      view = { text: 'Не удалось открыть карточку. Напиши /menu и попробуй ещё раз.', buttons: MENU_BUTTONS };
    }
    try {
      await retryMaxDelivery(() => ctx.answerOnCallback({
        message: { text: view.text, attachments: [catalogAttachment(view)] },
      }));
    } catch (error) {
      logHandlerError('MAX callback reply failed', error);
    }
  });

  return bot;
}
