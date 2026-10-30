import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const prefetchAll = async () => {');
const end = source.indexOf('\n  const saveKey = ', start);
assert.ok(start >= 0 && end > start);
const operation = source.slice(start, end).replace('const prefetchAll =', 'prefetchAll =');

function fixture(apiKey, bulk = null) {
  const calls = [];
  const context = {
    apiKey, bulk, bulkStop: { current: false }, items: [{ id: 'fictional-title' }], meta: {},
    setPosterErr: (value) => calls.push(['error', value]),
    setShowKeyPanel: (value) => calls.push(['panel', value]),
    setBulk: (value) => calls.push(['bulk', value]),
    setMeta: () => calls.push(['metadata']),
    fetchMeta: async () => { calls.push(['fetch']); return { fictional: true }; },
    setTimeout: (callback) => callback(),
  };
  vm.runInNewContext(operation, context, { timeout: 1000 });
  return { context, calls };
}

test('an empty key prompts for configuration without a network attempt', async () => {
  const { context, calls } = fixture('   ');
  await context.prefetchAll();
  assert.equal(calls.some(([kind]) => kind === 'fetch'), false);
  assert.equal(calls.some(([kind]) => kind === 'bulk'), false);
  assert.ok(calls.some(([kind, value]) => kind === 'panel' && value === true));
});

test('an active bulk operation can still be cancelled with an empty key', async () => {
  const { context, calls } = fixture('', { done: 0, total: 1 });
  await context.prefetchAll();
  assert.equal(context.bulkStop.current, true);
  assert.equal(calls.length, 0);
});

test('a configured key keeps the existing bulk lookup behavior', async () => {
  const { context, calls } = fixture('fictional-test-value');
  await context.prefetchAll();
  assert.equal(calls.filter(([kind]) => kind === 'fetch').length, 1);
  assert.ok(calls.some(([kind, value]) => kind === 'bulk' && value === null));
});
