import GigaChat from 'gigachat';
import { ACTIVITY_LABELS } from '../activity_labels.js';
import type { ActivityLabel } from '../activity_labels.js';
import { getGigaKey } from '../config.js';
import { ACTIVITY_RESPONSE_FORMAT, activityClassificationMessages, activityClassificationRepairMessages } from '../prompts/activity_classification.js';

const allowedLabels = new Set<string>(ACTIVITY_LABELS);
const plantLabels = new Set<string>([
  'зерновые', 'зернобобовые', 'масличные', 'картофель', 'овощи', 'тепличное хозяйство',
  'ягоды', 'плодовые культуры', 'кормовые культуры', 'лён', 'техническая конопля',
  'семеноводство', 'рассада и питомники',
]);
const animalLabels = new Set<string>([
  'молочное скотоводство', 'мясное скотоводство', 'свиноводство', 'овцеводство',
  'козоводство', 'коневодство', 'кролиководство', 'птицеводство', 'пищевые яйца',
  'инкубация и молодняк птицы', 'пчеловодство', 'племенное животноводство',
]);
const processingLabels = new Set<string>([
  'переработка молока', 'переработка мяса', 'переработка зерна',
  'переработка овощей и фруктов', 'производство кормов',
]);

export class ActivityClassificationError extends Error {
  constructor(
    readonly reason: 'configuration' | 'api_error' | 'invalid_response',
    readonly status?: number,
    readonly code?: string,
  ) {
    super(`Activity classification failed: ${reason}`);
  }
}

let client: GigaChat | undefined;
function getClient(): GigaChat {
  client ??= new GigaChat({
    credentials: getGigaKey(),
    baseUrl: 'https://api.giga.chat/v1',
    model: process.env.GIGACHAT_MODEL?.trim() || 'GigaChat-2',
    timeout: 30,
  });
  return client;
}

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);
const RETRY_DELAYS_MS = [400, 1000];

async function chatContent(payload: Parameters<GigaChat['chat']>[0]): Promise<string | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await getClient().chat(payload);
      return response.choices[0]?.message.content;
    } catch (error) {
      if (error instanceof Error && error.message.includes('GIGA_API_KEY is missing')) {
        throw new ActivityClassificationError('configuration');
      }
      const details = error as { response?: { status?: unknown }; code?: unknown; cause?: { code?: unknown } };
      const status = typeof details?.response?.status === 'number' ? details.response.status : undefined;
      const code = typeof details?.code === 'string' ? details.code
        : typeof details?.cause?.code === 'string' ? details.cause.code : undefined;
      const retryable = (code !== undefined && RETRYABLE_CODES.has(code)) ||
        status === 429 || (status !== undefined && status >= 500 && status <= 599);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
        throw new ActivityClassificationError('api_error', status, code);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

export function parseActivityResponse(content: string): ActivityLabel[] {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new ActivityClassificationError('invalid_response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ActivityClassificationError('invalid_response');
  }
  if (!parsed || typeof parsed !== 'object' || !('activities' in parsed)) {
    throw new ActivityClassificationError('invalid_response');
  }
  const activities = parsed.activities;
  if (!Array.isArray(activities) || !activities.every((item) => typeof item === 'string' && allowedLabels.has(item))) {
    throw new ActivityClassificationError('invalid_response');
  }
  const labels = new Set<ActivityLabel>(activities as ActivityLabel[]);
  if (labels.has('пищевые яйца') || labels.has('инкубация и молодняк птицы')) {
    labels.add('птицеводство');
  }
  if ([...labels].some((label) => plantLabels.has(label))) labels.add('растениеводство');
  if ([...labels].some((label) => animalLabels.has(label))) labels.add('животноводство');
  if ([...labels].some((label) => processingLabels.has(label))) labels.add('переработка сельхозпродукции');
  return [...labels];
}

export async function classifyActivities(description: string): Promise<ActivityLabel[]> {
  const content = await chatContent({
    temperature: 0.1,
    max_tokens: 800,
    messages: activityClassificationMessages(description),
    response_format: ACTIVITY_RESPONSE_FORMAT,
  });
  if (typeof content !== 'string') throw new ActivityClassificationError('invalid_response');
  try {
    return parseActivityResponse(content);
  } catch (error) {
    if (!(error instanceof ActivityClassificationError) || error.reason !== 'invalid_response') throw error;
  }

  const repaired = await chatContent({
    temperature: 0,
    max_tokens: 500,
    messages: activityClassificationRepairMessages(content),
    response_format: ACTIVITY_RESPONSE_FORMAT,
  });
  if (typeof repaired !== 'string') throw new ActivityClassificationError('invalid_response');
  return parseActivityResponse(repaired);
}
