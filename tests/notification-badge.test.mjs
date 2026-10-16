// FAKE_INDEXEDDB_MODULE=/path/to/fake-indexeddb/build/esm/index.js node tests/notification-badge.test.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const { IDBFactory } = await import(process.env.FAKE_INDEXEDDB_MODULE
  ? pathToFileURL(process.env.FAKE_INDEXEDDB_MODULE).href : 'fake-indexeddb');
const read = p => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const workerSource = await read('service-worker.js');
const pageSource = await read('notification-badge.js');
const scope = 'https://portal.example/staff/';
function worker({ database = new IDBFactory(), api, windows = [] } = {}) {
  const handlers = {}, badges = [], shown = [], opened = [];
  const self = {
    indexedDB: database,
    navigator: api ?? { setAppBadge: async n => { badges.push(n); }, clearAppBadge: async () => { badges.push(0); } },
    registration: { scope, showNotification: async (title, options) => { shown.push({ title, options }); } },
    addEventListener: (name, handler) => { handlers[name] = handler; }
  };
  const clients = { matchAll: async () => windows, openWindow: async url => { opened.push(url); } };
  vm.runInNewContext(workerSource, { self, clients, URL, setTimeout, clearTimeout });
  const emit = async (name, event = {}) => {
    const promises = [];
    handlers[name]({ ...event, waitUntil: promise => promises.push(promise) });
    await Promise.all(promises);
  };
  const push = (data = { title: '申請通知', body: '承認されました', url: './applications.html?application=7' }) =>
    emit('push', { data: { json: () => data } });
  const click = (url = './applications.html?application=7') => emit('notificationclick', {
    notification: { close() {}, data: { url } }
  });
  const home = (url = scope + 'home.html') => emit('message', { data: { type: 'CLEAR_NOTIFICATION_BADGE' }, source: { url } });
  return { push, click, home, emit, badges, shown, opened, database };
}
const w = worker();
await w.push(); assert.deepEqual(w.badges, [1]);
await Promise.all([w.push(), w.push()]); assert.deepEqual(w.badges, [1, 2, 3]);
assert.equal(w.shown.length, 3);
assert.equal(w.shown[0].options.data.url, './applications.html?application=7');
assert.equal(w.shown[0].options.body, '承認されました');
assert.equal(w.shown[0].options.icon, './icons/se-icon-192.png');
const restarted = worker({ database: w.database });
await restarted.push(); assert.deepEqual(restarted.badges, [4]);
await restarted.click(); assert.deepEqual(restarted.badges, [4, 0]);
assert.deepEqual(restarted.opened, ['./applications.html?application=7']);
await restarted.push(); assert.equal(restarted.badges.at(-1), 1);
await restarted.home('https://other.example/home.html'); assert.equal(restarted.badges.at(-1), 1);
await restarted.home(); assert.equal(restarted.badges.at(-1), 0);
await Promise.all([restarted.push(), restarted.home(), restarted.push()]);
assert.deepEqual(restarted.badges.slice(-3), [1, 0, 1]);
console.log('PASS: 1/2/3, concurrent increments, worker restart, click/home clear, push-clear ordering, source validation');

for (const api of [{}, { setAppBadge: async () => { throw Error('denied'); }, clearAppBadge: async () => { throw Error('denied'); } }]) {
  const unsupported = worker({ api });
  await unsupported.push(); await unsupported.click(); await unsupported.home();
  assert.equal(unsupported.shown.length, 1); assert.equal(unsupported.opened.length, 1);
}
const noStorage = worker({ database: { open() { throw Error('storage unavailable'); } } });
await noStorage.push(); await noStorage.click(); assert.equal(noStorage.shown.length, 1);
assert.deepEqual(noStorage.badges, [0]);
const setOnly = [];
const fallback = worker({ api: { setAppBadge: async n => setOnly.push(n) } });
await fallback.push(); await fallback.home(); assert.deepEqual(setOnly, [1, 0]);
console.log('PASS: unsupported/rejected API and unavailable storage preserve notifications and navigation; setAppBadge(0) fallback');

let navigated, focused = 0;
const existing = worker({ windows: [{ url: scope + 'home.html', focus: async () => { focused++; },
  navigate: async url => { navigated = url; return { focus: async () => { focused++; } }; } }] });
await existing.click(); assert.equal(navigated, scope + 'applications.html?application=7');
assert.equal(focused, 1); assert.equal(existing.opened.length, 0);
const failedNavigation = worker({ windows: [{ url: scope + 'home.html', focus() {}, navigate: async () => { throw Error('closed'); } }] });
await failedNavigation.click('./my-page.html'); assert.deepEqual(failedNavigation.opened, ['./my-page.html']);
const samePage = worker({ windows: [{ url: scope + 'home.html', focus: async () => { focused++; } }] });
await samePage.click('./home.html'); assert.equal(focused, 2); assert.equal(samePage.opened.length, 0);
await w.emit('push', { data: { json() { throw Error('plain text'); }, text: () => 'plain notification' } });
assert.equal(w.shown.at(-1).options.body, 'plain notification');
await w.emit('push'); assert.equal(w.shown.at(-1).options.data.url, './home.html');
console.log('PASS: notification URLs, existing/new windows, navigate failure fallback, text/empty payload');

const windowEvents = {}, documentEvents = {}, swEvents = {}, messages = [];
const document = { visibilityState: 'visible', addEventListener: (name, cb) => { documentEvents[name] = cb; } };
const active = { postMessage: data => { messages.push(data.type); } };
vm.runInNewContext(pageSource, {
  document, window: { addEventListener: (name, cb) => { windowEvents[name] = cb; } },
  navigator: { serviceWorker: { ready: Promise.resolve({ active }), controller: null,
    addEventListener: (name, cb) => { swEvents[name] = cb; } } }
});
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(messages, ['CLEAR_NOTIFICATION_BADGE']);
await windowEvents.pageshow();
document.visibilityState = 'hidden'; await documentEvents.visibilitychange(); assert.equal(messages.length, 2);
document.visibilityState = 'visible'; await documentEvents.visibilitychange(); await swEvents.controllerchange();
assert.equal(messages.length, 4);
vm.runInNewContext(pageSource, { document, navigator: {}, window: { addEventListener() {} } });
assert.match(await read('home.html'), /notification-badge\.js\?v=1/);
assert.match(await read('home.html'), /id="adminPendingBadge"/);
assert.match(workerSource, /staff-portal-v95/);
assert.match(workerSource, /"\.\/notification-badge\.js\?v=1"/);
console.log('PASS: home startup/return clears, hidden page does not clear, unsupported page API, cache registration');
