import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from './store.ts';
import { createAgentService, computeBriefing, escalation, freshAccount, localClock } from './agent.ts';

const monday = new Date('2026-10-05T14:00:00Z'); // 07:00 Pacific
const fixture = (now = monday, delay = 0) => ({
  arrivals: { fetchedAt: now.getTime(), stale: false, items: [
    { line: 'T', destination: 'Chinatown', aimed: '2026-10-05T15:06:00Z', expected: '2026-10-05T15:06:00Z' },
    { line: 'T', destination: 'Chinatown', aimed: '2026-10-05T15:14:00Z', expected: new Date(Date.parse('2026-10-05T15:14:00Z') + delay * 60000).toISOString() },
    { line: 'T', destination: 'Sunnydale', aimed: '2026-10-05T15:18:00Z', expected: '2026-10-05T15:18:00Z' },
  ] }, alerts: { stale: false, items: [] },
});
test('agent matches direction, revises for delays, and refuses stale or infeasible predictions', () => {
  const state = freshAccount(); state.settings.headsign = 'Chinatown';
  const normal = computeBriefing(state, fixture(), monday);
  assert.equal(normal.source, 'live'); assert.equal(normal.plan?.trip, 494);
  const late = computeBriefing(state, fixture(monday, 12), monday);
  assert.equal(late.plan?.trip, 486); assert.ok(late.plan!.start < normal.plan!.start);
  const stale = fixture(); stale.arrivals.stale = true;
  assert.equal(computeBriefing(state, stale, monday).source, 'unavailable');
  state.profile.arriveBy = 450;
  assert.equal(computeBriefing(state, fixture(), monday).plan, null);
  state.settings.headsign = '';
  assert.match(computeBriefing(state, fixture(), monday).speech, /Complete My commute/);
});
test('preparation progress reduces remaining work without inventing an earlier trip', () => {
  const state = freshAccount(); state.settings.headsign = 'Chinatown';
  state.rides.push({ date: '2026-10-05', started: '2026-10-05T14:30:00Z', left: null, arrived: null, acknowledged: true, measured: null, nextReady: null });
  const date = new Date('2026-10-05T14:55:00Z');
  assert.ok(computeBriefing(state, fixture(date), date).plan);
  state.rides[0].started = null;
  assert.equal(computeBriefing(state, fixture(date), date).plan, null);
});
test('escalation respects weekdays, acknowledgement, spacing, and the two-call daily cap', () => {
  const state = freshAccount(); state.settings.enabled = true;
  state.briefing = { speech: 'Preview', plan: { start: 420, trip: 490, leave: 484, arrive: 530, odds: 90, buffer: 7 }, source: 'sample', sourceAt: null, checkedAt: monday.toISOString(), reason: '', alerts: [] };
  escalation(state, monday); escalation(state, monday);
  assert.equal(state.events.filter(e => e.kind === 'push').length, 1);
  state.briefing.plan = null; // missing the preparation window must not cancel escalation
  escalation(state, new Date(monday.getTime() + 20 * 60000)); // resume late: only first call
  assert.equal(state.events.filter(e => e.kind === 'call').length, 1);
  escalation(state, new Date(monday.getTime() + 25 * 60000));
  escalation(state, new Date(monday.getTime() + 26 * 60000));
  assert.equal(state.events.filter(e => e.kind === 'call').length, 2);
  assert.ok(state.events.every(e => e.dryRun));
  const count = state.events.length;
  escalation(state, new Date('2026-10-10T14:00:00Z'));
  assert.equal(state.events.length, count);
  const acknowledged = freshAccount(); acknowledged.settings.enabled = true; acknowledged.briefing = state.briefing;
  escalation(acknowledged, monday); acknowledged.rides[0].acknowledged = true;
  escalation(acknowledged, new Date(monday.getTime() + 10 * 60000));
  assert.equal(acknowledged.events.filter(e => e.kind === 'call').length, 0);
  assert.equal(localClock(new Date('2026-11-02T15:00:00Z'), 'America/Los_Angeles').minute, 420);
});
test('authenticated API persists real check-ins across restart and prevents stale profile writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fogline-agent-'));
  const file = join(dir, 'account.json'), secret = 'test-account-key-'.repeat(4);
  let date = monday;
  let service = createAgentService({ file, store: fileStore(file), token: () => secret, now: () => date, snapshot: async () => fixture(date) });
  const server = createServer((req, res) => { if (!service.handler(req, res)) res.writeHead(404).end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const request = async (path: string, data?: unknown, key = secret) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('/api/agent/state', undefined, 'wrong')).status, 401);
    const first = (await request('/api/agent/state')).body;
    assert.equal((await request('/api/agent/checkin', { action: 'arrive' })).status, 409);
    const settings = { ...first.settings, headsign: 'Chinatown' };
    assert.equal((await request('/api/agent/settings', { revision: first.revision, profile: { ...first.profile, ready: -1 }, settings })).status, 400);
    const saved = await request('/api/agent/settings', { revision: first.revision, profile: first.profile, settings });
    assert.equal(saved.status, 200);
    assert.equal((await request('/api/agent/settings', { revision: first.revision, profile: first.profile, settings })).status, 409);
    await request('/api/agent/checkin', { action: 'start' });
    assert.equal((await request('/api/agent/checkin', { action: 'leave' })).status, 400);
    date = new Date(monday.getTime() + 43 * 60000);
    const left = await request('/api/agent/checkin', { action: 'leave' });
    assert.equal(left.body.rides[0].measured, 43); assert.equal(left.body.rides[0].nextReady, 37);
    assert.equal(left.body.profile.ready, 35);
    await request('/api/agent/checkin', { action: 'leave' }); // retry is idempotent
    await request('/api/agent/checkin', { action: 'arrive' });
    service = createAgentService({ file, store: fileStore(file), token: () => secret, now: () => date, snapshot: async () => fixture(date) });
    const restored = (await request('/api/agent/state')).body;
    assert.ok(restored.rides[0].arrived); assert.equal(restored.rides.length, 1);
    assert.equal(restored.events.filter((e: any) => e.id.endsWith(':checkin:leave')).length, 1);
    date = new Date('2026-10-06T14:00:00Z');
    assert.equal((await request('/api/agent/check', {})).body.profile.ready, 37);
    assert.equal((await request('/briefing/now')).status, 200);
    assert.equal((await request('/api/agent/state')).body.rides.length, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
