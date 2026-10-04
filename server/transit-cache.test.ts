import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error JavaScript transit cache.
import { createTransitCache } from './transit-cache.mjs';

test('coalesces concurrent loads and caps pending feeds without evicting them', async () => {
  const cached = createTransitCache({ maxPending: 1 });
  let finish!: (data: unknown) => void;
  let calls = 0;
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = cached('T', load), duplicate = cached('T', load);
  assert.match((await cached('N', load)).error, /limit/);
  assert.equal(calls, 1);
  finish({ items: ['T'] });
  assert.deepEqual(await first, await duplicate);
  assert.deepEqual((await cached('T', load)).items, ['T']);
  assert.equal(calls, 1);
});

test('rolling request budget survives cache eviction and includes failed requests', async () => {
  let clock = 0, calls = 0;
  const cached = createTransitCache({ maxEntries: 2, maxLoads: 3, ttl: 100, now: () => clock });
  const load = () => { calls++; throw new Error('offline'); };
  for (let i = 0; i < 100; i++) await cached(String(i), load);
  assert.equal(calls, 3);
  clock = 99;
  assert.match((await cached('next', load)).error, /limit/);
  clock = 100;
  assert.equal((await cached('next', load)).error, 'offline');
  assert.equal(calls, 4);
});

test('bounded LRU evicts successful and failed entries and preserves recently used feeds', async () => {
  const cached = createTransitCache({ maxEntries: 2 });
  let aCalls = 0, bCalls = 0;
  const a = () => { aCalls++; return { items: ['A'] }; };
  const b = () => { bCalls++; throw new Error('B unavailable'); };
  await cached('A', a); await cached('B', b); await cached('A', a);
  await cached('C', () => ({ items: ['C'] }));
  await cached('A', a);
  assert.equal(aCalls, 1);
  await cached('B', b);
  assert.equal(bCalls, 2); // B's failure/backoff entry was evicted too.
});

test('expired feeds stay labeled stale during failure backoff and recover after retry', async () => {
  let clock = 0, calls = 0;
  const cached = createTransitCache({ ttl: 100, now: () => clock });
  const good = () => ({ items: ['arrival'] });
  const bad = () => { calls++; throw new Error('offline'); };
  await cached('T', good);
  clock = 100;
  const stale = await cached('T', bad);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, 0);
  assert.deepEqual(stale.items, ['arrival']);
  clock = 199;
  assert.equal((await cached('T', bad)).error, 'offline');
  assert.equal(calls, 1);
  clock = 200;
  assert.equal((await cached('T', good)).stale, false);
});
