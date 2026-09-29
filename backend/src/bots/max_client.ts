import { Bot } from '@maxhub/max-bot-api';
import type { Context } from '@maxhub/max-bot-api';
import { getBotToken } from '../config.js';
import type { Database } from '../db/client.js';
import { handleMessage, handleStart } from './support_scenario.js';
import { catalogAttachment, handleCatalogAction, MENU_BUTTONS, menuView, openApplications, openCatalog, openRecommendations } from './support_catalog.js';
import { saveMaxUser } from '../db/profiles.js';
import type { CatalogView } from './support_catalog.js';

function logHandlerError(label: string, error: unknown): void {
  const details = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  const secrets = [process.env.BOT_TOKEN_MAX, process.env.CHECKO_API, process.env.DATABASE_URL, process.env.GIGA_API_KEY]
    .filter((value): value is string => Boolean(value));
  const safeDetails = secrets.reduce((message, secret) => message.replaceAll(secret, '[redacted]'), details);
  console.error(`${label}: ${safeDetails}`);
}

async function sendReply(ctx: Context, userId: number, text: string, view?: CatalogView): Promise<void> {
  const extra = view ? { attachments: [catalogAttachment(view)] } : undefined;
  if (ctx.chatId != null) {
    await ctx.reply(text, extra);
  } else {
    // MAX may omit chat_id for a direct message; ctx.reply then throws a TypeError.
    await ctx.api.sendMessageToUser(userId, text, extra);
  }
}

export function createMaxBot(database: Database): Bot {
  const bot = new Bot(getBotToken());

  bot.on('bot_started', async (ctx) => {
    try {
      const greeting = await handleStart(database, ctx.user);
      await sendReply(ctx, ctx.user.user_id, greeting, { text: greeting, buttons: MENU_BUTTONS });
    } catch (error) {
      logHandlerError('Bot start handler failed', error);
      try {
        await sendReply(ctx, ctx.user.user_id, 'Не удалось открыть профиль. Попробуй ещё раз позже.');
      } catch (replyError) {
        logHandlerError('Could not send an error reply to MAX', replyError);
      }
    }
  });

  bot.on('message_created', async (ctx) => {
    const user = ctx.message.sender;
    if (!user || user.is_bot) return;
    try {
      const message = ctx.message.body.text?.trim() ?? '';
      const userId = await saveMaxUser(database, user);
      if (/^\/(?:support|find)(?:\s|$)/i.test(message)) {
        const view = await openRecommendations(database, userId);
        await sendReply(ctx, user.user_id, view.text, view);
      } else if (/^\/applications(?:\s|$)/i.test(message)) {
        const view = await openApplications(database, userId);
        await sendReply(ctx, user.user_id, view.text, view);
      } else if (/^\/catalog(?:\s|$)/i.test(message)) {
        const view = await openCatalog(database, userId);
        await sendReply(ctx, user.user_id, view.text, view);
      } else if (/^\/menu(?:\s|$)/i.test(message)) {
        const view = menuView();
        await sendReply(ctx, user.user_id, view.text, view);
      } else {
        const reply = await handleMessage(database, user, ctx.message.body.text);
        await sendReply(ctx, user.user_id, reply, { text: reply, buttons: MENU_BUTTONS });
      }
    } catch (error) {
      logHandlerError('Message handler failed', error);
      try {
        await sendReply(ctx, user.user_id, 'Не удалось обработать сообщение. Попробуй ещё раз позже.');
      } catch (replyError) {
        logHandlerError('Could not send an error reply to MAX', replyError);
      }
    }
  });

  bot.on('message_callback', async (ctx) => {
    const user = ctx.callback.user;
    if (!user || user.is_bot) return;
    try {
      const userId = await saveMaxUser(database, user);
      const view = await handleCatalogAction(database, userId, ctx.callback.payload ?? '');
      await ctx.answerOnCallback({ message: { text: view.text, attachments: [catalogAttachment(view)] } });
    } catch (error) {
      logHandlerError('Callback handler failed', error);
      try {
        await ctx.answerOnCallback({ message: {
          text: 'Не удалось открыть карточку. Напиши /menu и попробуй ещё раз.',
          attachments: [catalogAttachment(menuView())],
        } });
      } catch (replyError) {
        logHandlerError('Could not answer MAX callback', replyError);
      }
    }
  });

  return bot;
}
