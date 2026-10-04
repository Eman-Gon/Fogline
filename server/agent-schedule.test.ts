import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService, freshAccount } from './agent';
import { fixture, chosen } from './journey-fixture';
// @ts-expect-error JavaScript morning schedule.
import { agentMoment, schedulerDue } from './agent-schedule.mjs';

const clock = { date: '2026-10-05', weekday: 'Mon', minute: 450 };
const leave = Date.parse('2026-10-05T15:06:00Z');
function state(extra: Record<string, unknown> = {}) {
  return { settings: { enabled: true, wakeStart: 450, wakeEnd: 600 }, commute: { days: [1] }, rides: [{ date: '2026-10-05' }], briefing: { journey: { plan: { leave } } }, profile: { arriveBy: 540, ready: 35 }, ...extra };
}

test('the saved route is planned once at wake, then live only near departure', () => {
  const before = { ...clock, minute: 449 };
  assert.equal(agentMoment(state(), new Date('2026-10-05T14:29:00Z'), before), null);
  assert.equal(agentMoment(state(), new Date('2026-10-05T14:30:00Z'), clock), 'wake');
  const planned = state();
  (planned.rides as { wakeRan?: string; liveRanAt?: number }[])[0].wakeRan = '2026-10-05';
  assert.equal(agentMoment(planned, new Date('2026-10-05T14:40:00Z'), { ...clock, minute: 460 }), null);
  const liveAt = leave - 10 * 60000;
  assert.equal(agentMoment(planned, new Date(liveAt), { ...clock, minute: 476 }), 'live');
  (planned.rides as { liveRanAt?: number }[])[0].liveRanAt = liveAt;
  assert.equal(agentMoment(planned, new Date(liveAt + 2 * 60000), { ...clock, minute: 478 }), null);
  assert.equal(agentMoment(planned, new Date(liveAt + 3 * 60000), { ...clock, minute: 479 }), 'live');
  (planned.rides as { boarded?: string }[])[0].boarded = new Date(liveAt).toISOString();
  assert.equal(agentMoment(planned, new Date(liveAt + 3 * 60000), { ...clock, minute: 479 }), null);
  const off = { settings: { enabled: false, wakeStart: 450, wakeEnd: 600 } };
  assert.equal(agentMoment(state(off), new Date('2026-10-05T14:30:00Z'), clock), null);
  assert.equal(schedulerDue(state(off), new Date('2026-10-05T14:30:00Z'), clock), 'collect');
  assert.equal(schedulerDue(state({ ...off, profile: { arriveBy: 400, ready: 35 } }), new Date('2026-10-05T14:30:00Z'), clock), null);
});

test('automatic checks run at wake and again ten minutes before departure', async () => {
  let now = new Date('2026-10-05T14:29:00Z');
  let snapshots = 0;
  const account = freshAccount();
  account.settings = { ...account.settings, enabled: true, wakeStart: 450, wakeEnd: 600 };
  account.commute = chosen(fixture());
  let saved: any = account;
  const service = createAgentService({
    file: 'unused',
    token: () => 'x'.repeat(32),
    now: () => now,
    store: { read: async () => structuredClone(saved), save: async (next: any) => { saved = structuredClone(next); } },
    snapshot: async () => { snapshots++; return { alerts: { items: [], stale: false }, arrivals: { items: [], fetchedAt: now.getTime() } }; },
    catalog: async () => fixture(),
    research: async (_s: any, day: string) => ({ status: 'ready' as const, day, checkedAt: now.toISOString(), sources: [], message: 'Exa checked' }),
    pushEnabled: () => false,
  });
  await service.tick();
  assert.equal(snapshots, 0);
  now = new Date('2026-10-05T14:30:00Z');
  await service.tick();
  await service.tick();
  assert.equal(snapshots, 1);
  assert.equal(saved.rides.find((ride: any) => ride.date === '2026-10-05').wakeRan, '2026-10-05');
  assert.equal(saved.events.filter((event: any) => event.noticeKind === 'wake').length, 1);
  assert.match(saved.events.find((event: any) => event.noticeKind === 'wake').text, /Route check: Exa checked/);
  const departure = saved.briefing.journey.plan.leave as number;
  now = new Date(departure - 11 * 60000);
  await service.tick();
  assert.equal(snapshots, 1);
  now = new Date(departure - 10 * 60000);
  await service.tick();
  await service.tick();
  assert.equal(snapshots, 2);
  assert.equal(saved.events.filter((event: any) => event.noticeKind === 'live').length, 1);
  now = new Date(now.getTime() + 3 * 60000);
  await service.tick();
  assert.equal(snapshots, 3);
});
