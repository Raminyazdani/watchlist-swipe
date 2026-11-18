import test from 'node:test';
import assert from 'node:assert/strict';

test('a browser choice is readable as soon as it is saved', async (t) => {
  const entries = new Map();
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('local writes must be immediate'));
  globalThis.window = {
    localStorage: {
      setItem: (key, value) => entries.set(key, value),
      getItem: (key) => entries.get(key) ?? null,
    },
  };
  t.after(() => { delete globalThis.window; });

  const { saveChange, storage } = await import('../src/storage.js?browser');
  const choice = { decisions: { 'example-game': 'want' } };
  saveChange('watchlist:v1', choice, assert.fail);
  assert.deepEqual(JSON.parse(entries.get('watchlist:v1')), choice);
  assert.deepEqual(JSON.parse((await storage.get('watchlist:v1')).value), choice);
});

test('embedded hosts can cancel a pending write', async (t) => {
  const writes = [];
  globalThis.window = { storage: { set: async (...args) => writes.push(args) } };
  t.after(() => { delete globalThis.window; });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const { saveChange } = await import('../src/storage.js?host');
  const cancel = saveChange('edits', { title: 'draft' }, assert.fail);
  cancel();
  saveChange('edits', { title: 'final' }, assert.fail);
  assert.deepEqual(writes, []);
  t.mock.timers.tick(350);
  assert.deepEqual(writes, [['edits', '{"title":"final"}']]);
});
