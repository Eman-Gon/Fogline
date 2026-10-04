import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgentService, freshAccount } from './agent';
import { fixture, chosen } from './journey-fixture';
import { checkTrackedRide, observeTracking, queueTrackingReport, trackingDue, trackingInterval } from './tracking';
import { deliverPendingPush } from './notifications';
import type { AccountState } from '../src/agent-types';
import type { TrackedRide } from '../src/tracking-types';
// @ts-expect-error JavaScript journey planner.
import { planJourney } from './journey.mjs';

const minute = 60000;
const start = Date.parse('2026-10-05T14:00:00Z');
function tracked(): TrackedRide {
  const c = fixture(), commute = chosen(c), profile = freshAccount().profile;
  const journey = planJourney(c, commute, profile, null, new Date(start));
  return { id: 'test', active: true, origin: 'quick', createdAt: start, expiresAt: start + 4 * 60 * minute, commute, profile, trip: journey.plan, journey, lastCheckedAt: start, nextCheckAt: start + 10 * minute, researchAttemptAt: start, samples: [], reports: [], delayStreak: 0, lastObservation: null, lastDelay: null, reportedDelay: null };
}
function observation(ride: TrackedRide, at: number, delay: number) {
  return { ...ride.journey, plan: { ...ride.trip, source: 'live' as const, observedAt: at, expected: (ride.trip.scheduledDeparture ?? ride.trip.departure) + delay * minute } };
}

test('tracking uses 4-minute and 3-minute boundaries and accelerates when crossing thresholds', () => {
  const leave = start + 30 * minute;
  assert.equal(trackingInterval(leave, leave - 21 * minute), 10 * minute);
  assert.equal(trackingInterval(leave, leave - 20 * minute), 4 * minute);
  assert.equal(trackingInterval(leave, leave - 10 * minute - 1), 4 * minute);
  assert.equal(trackingInterval(leave, leave - 10 * minute), 3 * minute);
  assert.equal(trackingInterval(leave, leave + 5 * minute), 3 * minute);
  const ride = tracked(); ride.trip.leave = leave;
  ride.lastCheckedAt = leave - 22 * minute; ride.nextCheckAt = leave - 12 * minute;
  assert.equal(trackingDue(ride, leave - 19 * minute), false);
  assert.equal(trackingDue(ride, leave - 18 * minute), true);
  ride.active = false; assert.equal(trackingDue(ride, leave), false);
});

test('only distinct fresh observations confirm delays; changed and recovered reports deduplicate', () => {
  const ride = tracked();
  observeTracking(ride, observation(ride, start, 5), start);
  assert.equal(ride.reports.length, 0);
  observeTracking(ride, observation(ride, start, 5), start + minute);
  assert.equal(ride.samples.length, 1); assert.equal(ride.delayStreak, 1);
  observeTracking(ride, observation(ride, start + 3 * minute, 5), start + 3 * minute);
  assert.equal(ride.reports.length, 1); assert.equal(ride.reports[0].kind, 'delay');
  observeTracking(ride, observation(ride, start + 6 * minute, 5.2), start + 6 * minute);
  assert.equal(ride.reports.length, 1);
  observeTracking(ride, observation(ride, start + 9 * minute, 7), start + 9 * minute);
  assert.equal(ride.reports.length, 2);
  observeTracking(ride, observation(ride, start + 12 * minute, 0), start + 12 * minute);
  assert.equal(ride.reports[0].kind, 'recovered');
  observeTracking(ride, observation(ride, start + 15 * minute, 0), start + 15 * minute);
  assert.equal(ride.reports.length, 3);
});

test('stale and out-of-order evidence cannot create a persistent delay or a recovery', () => {
  const ride = tracked();
  observeTracking(ride, observation(ride, start, 5), start);
  observeTracking(ride, observation(ride, start, 5), start + 5 * minute);
  assert.equal(ride.delayStreak, 0); assert.equal(ride.samples.at(-1)?.source, 'schedule');
  observeTracking(ride, observation(ride, start + 6 * minute, 5), start + 6 * minute);
  assert.equal(ride.delayStreak, 1);
  observeTracking(ride, observation(ride, start + 5 * minute, 0), start + 7 * minute);
  assert.equal(ride.delayStreak, 1); assert.equal(ride.reportedDelay, null);
  observeTracking(ride, observation(ride, start + 25 * minute, 5), start + 25 * minute);
  assert.equal(ride.delayStreak, 1, 'long gaps do not establish continuous delay');
  assert.equal(ride.reports.filter(r => r.kind === 'delay').length, 0);
});

test('tracking preserves trip identity, handles cancellation, and throttles Exa research', async () => {
  const ride = tracked();
  const state = { ...freshAccount(), tracking: ride };
  let searches = 0, canceled = false;
  let at = start + 30 * minute;
  const deps = {
    catalog: async () => fixture(),
    snapshot: async () => ({ realtime: {
      trips: { fetchedAt: at, sourceAt: at, items: [{ tripId: ride.trip.tripId, line: '15', direction: '1', serviceDate: '20261005', recordedAt: at, relationship: canceled ? 'CANCELED' : 'SCHEDULED', calls: [{ stopId: '10001', sequence: 1, arrival: ride.trip.departure + 5 * minute }] }] },
      positions: { fetchedAt: at, sourceAt: at, items: [] }, alerts: { fetchedAt: at, sourceAt: at, items: [] },
    } }),
    research: async (_state: AccountState, day: string) => { searches++; return { status: 'ready' as const, day, checkedAt: new Date(at).toISOString(), sources: [], message: 'Mock research' }; },
  };
  const originalTrip = ride.trip.tripId, originalLeave = ride.trip.leave;
  await checkTrackedRide(state, new Date(at), deps);
  assert.equal(searches, 1);
  assert.equal(ride.journey.plan?.source, 'live');
  at += 3 * minute; await checkTrackedRide(state, new Date(at), deps);
  assert.equal(searches, 1, 'a persistent delay cannot cause unbounded research');
  assert.equal(ride.reports[0].kind, 'delay');
  assert.equal(ride.trip.tripId, originalTrip); assert.equal(ride.trip.leave, originalLeave);
  canceled = true; at += 3 * minute; await checkTrackedRide(state, new Date(at), deps);
  assert.equal(ride.journey.plan, null); assert.match(ride.reports[0].text, /canceled/i);
  at = ride.expiresAt; await checkTrackedRide(state, new Date(at), deps);
  assert.equal(ride.active, false); assert.equal(searches, 1);
});

test('phone delay reports require enabled notifications, survive research latency, and reject stopped rides', async () => {
  const ride = tracked(), state = { ...freshAccount(), tracking: ride };
  observeTracking(ride, observation(ride, start, 5), start);
  observeTracking(ride, observation(ride, start + 3 * minute, 5), start + 3 * minute);
  const at = start + 3 * minute + 15000; // Exa completed after the transit check.
  queueTrackingReport(state, at, true); assert.equal(state.events.length, 0);
  state.settings.enabled = true;
  queueTrackingReport(state, at, false); assert.equal(state.events.length, 0);
  queueTrackingReport(state, at, true); queueTrackingReport(state, at, true);
  assert.equal(state.events.length, 1);
  assert.match(state.events[0].text, /Estimated arrival at .*Need to arrive by/);
  let sends = 0;
  await deliverPendingPush(state, new Date(at), async () => {}, async () => {
    assert.equal(state.events[0].delivery?.status, 'sending'); sends++; return 'mock-provider-id';
  });
  assert.equal(sends, 1); assert.equal(state.events[0].delivery?.status, 'sent');
  await deliverPendingPush(state, new Date(at), async () => {}, async () => { sends++; return 'duplicate'; });
  assert.equal(sends, 1);
  observeTracking(ride, observation(ride, start + 6 * minute, 8), start + 6 * minute);
  queueTrackingReport(state, start + 6 * minute, true);
  ride.active = false;
  await deliverPendingPush(state, new Date(start + 6 * minute), async () => {}, async () => { sends++; return 'unexpected'; });
  assert.equal(sends, 1); assert.equal(state.events[0].delivery?.status, 'cancelled');
});

test('one-time tracking persists across restart, stays separate from commute, and stops after arrival', async () => {
  let saved: AccountState = { ...freshAccount(), commute: chosen(fixture()) };
  const originalProfile = structuredClone(saved.profile), originalCommute = structuredClone(saved.commute);
  let at = start, snapshots = 0, pushes = 0;
  const secret = 'tracking-test-token-with-at-least-32-characters';
  const options = { file: 'unused', token: () => secret, now: () => new Date(at),
    store: { read: async () => structuredClone(saved), save: async (s: AccountState) => { saved = structuredClone(s); } },
    catalog: async () => fixture(), snapshot: async () => { snapshots++; return null; },
    research: async (_s: AccountState, day: string) => ({ status: 'ready' as const, day, checkedAt: new Date(at).toISOString(), sources: [], message: 'Mock research' }),
    pushEnabled: () => false, publish: async () => { pushes++; return 'mock'; },
  };
  let service = createAgentService(options);
  const server = createServer((req, res) => { if (!service.handler(req, res)) res.writeHead(404).end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const send = async (body: unknown, auth = true) => {
    const response = await fetch(base + '/api/agent/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const payload = { action: 'start', commute: chosen(fixture()), profile: { ...saved.profile, destination: 'Temporary ride' } };
    assert.equal((await send(payload, false)).status, 401);
    assert.equal((await send({ ...payload, commute: { ...payload.commute, boardingMargin: -1 } })).status, 400);
    const started = await send(payload); assert.equal(started.status, 200);
    assert.equal(saved.tracking?.origin, 'quick'); assert.equal(saved.tracking?.journey.research?.message, 'Mock research');
    assert.deepEqual(saved.profile, originalProfile); assert.deepEqual(saved.commute, originalCommute);
    assert.equal((await send(payload)).status, 409);
    const id = saved.tracking!.id;
    assert.equal((await send({ action: 'stop', id: 'stale-id' })).status, 409);
    service = createAgentService(options);
    at += 10 * minute; const before = snapshots; await service.tick();
    assert.equal(saved.tracking!.lastCheckedAt, at); assert.equal(snapshots, before + 2, 'tracked ride plus existing saved-commute collector');
    assert.equal(saved.tracking!.id, id);
    assert.equal((await send({ action: 'board', id })).status, 409);
    assert.equal((await send({ action: 'prepare', id })).status, 200);
    at += 20 * minute; assert.equal((await send({ action: 'leave', id })).status, 200);
    at += 5 * minute; assert.equal((await send({ action: 'board', id })).status, 200);
    at += 30 * minute; assert.equal((await send({ action: 'arrive', id })).status, 200);
    assert.equal(saved.tracking!.active, false);
    assert.equal(saved.tracking!.arrived! - saved.tracking!.left!, 35 * minute);
    const checked = saved.tracking!.lastCheckedAt; at += 10 * minute; await service.tick();
    assert.equal(saved.tracking!.lastCheckedAt, checked); assert.equal(pushes, 0);
    assert.deepEqual(saved.profile, originalProfile); assert.deepEqual(saved.commute, originalCommute);
    // On another morning, explicit saved-commute tracking owns its cadence and check-ins.
    at = start + 24 * 60 * minute;
    assert.equal((await send({ action: 'start' })).status, 200);
    assert.equal(saved.tracking!.origin, 'saved'); assert.equal(saved.trackingHistory?.length, 1);
    const savedId = saved.tracking!.id;
    const beforeSavedCheck = snapshots;
    at = saved.tracking!.nextCheckAt; await service.tick();
    assert.equal(snapshots, beforeSavedCheck + 1, 'saved-commute collector is replaced by tracking cadence');
    assert.equal(saved.briefing?.journey?.plan?.tripId, saved.tracking!.trip.tripId);
    assert.equal((await send({ action: 'prepare', id: savedId })).status, 200);
    at += 20 * minute; assert.equal((await send({ action: 'leave', id: savedId })).status, 200);
    const morning = saved.rides.find(r => r.date === '2026-10-06')!;
    assert.equal(morning.measured, 20); assert.equal(Date.parse(morning.left!), saved.tracking!.left);
    at += 30 * minute; assert.equal((await send({ action: 'arrive', id: savedId })).status, 200);
    assert.equal(Date.parse(saved.rides.find(r => r.date === '2026-10-06')!.arrived!), saved.tracking!.arrived);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
