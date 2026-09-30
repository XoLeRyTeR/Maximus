import assert from 'node:assert/strict';
import { retryMaxDelivery } from '../dist/bots/max_client.js';

let attempts = 0;
const result = await retryMaxDelivery(async () => {
  attempts++;
  if (attempts < 3) throw new TypeError('fetch failed', { cause: { code: 'EAI_AGAIN' } });
  return 'sent';
});
assert.equal(result, 'sent');
assert.equal(attempts, 3);

attempts = 0;
await assert.rejects(retryMaxDelivery(async () => {
  attempts++;
  throw new Error('invalid message');
}), /invalid message/);
assert.equal(attempts, 1);
console.log('MAX_DELIVERY_TEST_OK');
