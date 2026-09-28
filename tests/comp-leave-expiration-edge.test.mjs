// node --experimental-strip-types tests/comp-leave-expiration-edge.test.mjs
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/expire-comp-leave-records/handler.ts';
let calls = 0;
const handler = createHandler({
  secret: () => 'test-only-secret',
  expire: async () => { calls++; return [{ newly_expired_days: '0.5' }, { newly_expired_days: 1 }]; },
});
const request = (secret, method = 'POST') => new Request('https://example.invalid', {
  method, headers: secret ? { 'x-cron-secret': secret } : {},
});
assert.equal((await handler(request(undefined))).status, 401);
assert.equal((await handler(request('wrong'))).status, 401);
assert.equal((await handler(request('test-only-secret','GET'))).status, 405);
assert.equal(calls, 0);
assert.equal((await createHandler({ secret: () => undefined, expire: async () => { throw Error(); } })(request('x'))).status, 503);
const response = await handler(request('test-only-secret'));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { success: true, processed_records: 2, newly_expired_days: 1.5 });
assert.equal(calls, 1);
assert.equal((await createHandler({ secret: () => 'x', expire: async () => { throw Error('private detail'); } })(request('x'))).status, 500);
console.log('PASS: Edge authorization, fail-closed configuration, RPC failure and summary');
