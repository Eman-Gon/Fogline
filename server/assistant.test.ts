import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgentService, freshAccount } from './agent.ts';
import { morningStage, userTimes, effectiveProfile } from './morning.ts';
import { fixture, chosen } from './journey-fixture.ts';

const secret = 'a-private-test-account-token-that-is-long-enough';
const trips = 'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n' + ['t1', 't2', 't3', 't4'].map(t => `15,work,${t},Downtown,1,s`).join('\n') + '\n';
const stopTimes = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n' + [['t1', '08:00', '08:30'], ['t2', '08:15', '08:45'], ['t3', '08:45', '09:15'], ['t4', '09:15', '09:45']]
  .map(([t, a, b]) => `${t},${a}:00,${a}:00,10001,1,0,0\n${t},${a}:10,${a}:10,10002,2,0,0\n${t},${b}:00,${b}:00,10003,3,0,0`).join('\n') + '\n';
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const scripted = (steps: ((messages: any[]) => any)[]) => { let i = 0; const seen: any[][] = []; const chat = async (messages: any[]) => { seen.push(structuredClone(messages)); return steps[Math.min(i++, steps.length - 1)](messages); }; return { chat, seen, get calls() { return i; } }; };
const lastTool = (messages: any[]) => JSON.parse(messages.filter(m => m.role === 'tool').at(-1).content);

async function harness({ now = new Date('2026-10-05T14:20:00Z'), pushEnabled = false, chat }: { now?: Date; pushEnabled?: boolean; chat: any }) {
  let state: any = freshAccount(); const published: string[] = [];
  const store = { read: async () => structuredClone(state), save: async (s: any) => { state = structuredClone(s); } };
  const c = fixture({ 'trips.txt': trips, 'stop_times.txt': stopTimes });
  let clock = now;
  const options = { file: 'unused', store, token: () => secret, now: () => clock, pushEnabled: () => pushEnabled, publish: async (t: string) => { published.push(t); return 'id'; }, chat,
    snapshot: async () => ({ alerts: { items: [], stale: false }, arrivals: { items: [], fetchedAt: clock.getTime() } }), catalog: async () => c };
  let service = createAgentService(options);
  const server = createServer((req, res) => { if (!service.handler(req, res)) res.writeHead(404).end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const send = async (path: string, data?: any) => { const r = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: r.status, body: await r.json() as any }; };
  const saveCommute = async (deadlineFirm = true) => {
    const first = await send('/api/agent/state');
    return send('/api/agent/commute', { revision: first.body.revision, profile: { ...first.body.profile, destination: 'Work', arriveBy: 540, ready: 35, walk: 6, destinationWalk: 5, ride: 30 }, commute: { ...chosen(c), deadlineFirm } });
  };
  return { send, saveCommute, published, get state() { return state; }, setNow: (d: Date) => { clock = d; }, restart: () => { service = createAgentService(options); }, tick: () => service.tick(), close: () => new Promise<void>(r => server.close(() => r())) };
}

test('morning stage comes from check-ins and the clock; silence is unconfirmed, not asleep', () => {
  const ride = (o: any = {}) => ({ date: '2026-10-05', started: null, left: null, arrived: null, measured: null, nextReady: null, acknowledged: false, ...o });
  const t0 = Date.parse('2026-10-05T14:00:00Z');
  assert.equal(morningStage(ride(), 35, t0 + 60000, t0), 'planned');
  assert.equal(morningStage(ride(), 35, t0 - 60000, t0), 'unconfirmed');
  assert.equal(morningStage(ride({ acknowledged: true }), 35, t0 - 60000, t0), 'unconfirmed');
  assert.equal(morningStage(ride({ started: new Date(t0 - 10 * 60000).toISOString() }), 35, t0, t0), 'preparing');
  assert.equal(morningStage(ride({ started: new Date(t0 - 36 * 60000).toISOString() }), 35, t0, t0), 'ready');
  assert.equal(morningStage(ride({ started: new Date(t0 - 36 * 60000).toISOString(), left: 'x' }), 35, t0, t0), 'walking');
  assert.equal(morningStage(ride({ started: 'x', left: 'x', boarded: 'x' }), 35, t0, t0), 'riding');
  assert.equal(morningStage(ride({ started: 'x', left: 'x', arrived: 'x' }), 35, t0, t0), 'arrived');
  assert.equal(morningStage(ride({ skipped: true }), 35, t0, t0), 'skipped');
  assert.deepEqual(effectiveProfile(freshAccount().profile, { extraPrep: 10, deadlineOverride: 555 }).ready, 45);
});

test('user-stated times are parsed conservatively', () => {
  assert.deepEqual(userTimes('Today 9:15 is fine').sort((a, b) => a - b), [555, 1275]);
  assert.deepEqual(userTimes('9:15 pm'), [1275]);
  assert.deepEqual(userTimes('by 9am'), [540]);
  assert.deepEqual(userTimes('I need 45 minutes, ten more, 20'), []);
  assert.deepEqual(userTimes('arrive 14:30'), [870]);
});

test('"I\'m 20 minutes behind": the agent records it, compares verified trips, and answers only with times tools returned', async () => {
  const model = scripted([
    () => ({ role: 'assistant', content: null, tool_calls: [call('1', 'read_morning_state'), call('2', 'report_running_late', { minutes: 20 })] }),
    () => ({ role: 'assistant', content: null, tool_calls: [call('3', 'compare_departures')] }),
    m => { const t = lastTool(m); const late = t.optionsMissingDeadline[0]; return { role: 'assistant', content: `Your original trip no longer fits. The next verified option arrives ${late.arrives}, ${late.minutesPastDeadline} minutes past your firm deadline. Want it?` }; },
  ]);
  const h = await harness({ chat: model.chat });
  try {
    assert.equal((await h.saveCommute()).status, 200);
    const before = h.state.briefing;
    assert.equal(before.journey.plan.tripId.includes('t2') || Boolean(before.journey.plan), true);
    const out = await h.send('/api/agent/assist', { text: "I'm 20 minutes behind" });
    assert.equal(out.status, 200);
    assert.equal(out.body.replySource, 'model');
    assert.match(out.body.reply, /verified option arrives \d{1,2}:\d{2}/);
    assert.deepEqual(out.body.toolsUsed, ['read_morning_state', 'report_running_late', 'compare_departures']);
    const ride = h.state.rides.find((r: any) => r.date === '2026-10-05');
    assert.equal(ride.extraPrep, 20);
    assert.equal(h.state.profile.ready, 35, 'learned/base preparation time is untouched');
    assert.ok(h.state.events.some((e: any) => e.actor === 'agent' && /20 more minutes/.test(e.text)));
    // Persisted: a restarted server still plans with the extra minutes.
    h.restart();
    assert.equal(h.state.briefing.stage, 'planned', 'the original 7:31 start time has not arrived at 7:20');
    h.setNow(new Date('2026-10-05T14:40:00Z'));
    const again = await h.send('/api/agent/check', {});
    assert.equal(again.body.briefing.stage, 'unconfirmed', 'start time passed with no check-in: unconfirmed, not asleep');
    assert.equal(again.body.rides.find((r: any) => r.date === '2026-10-05').extraPrep, 20);
  } finally { await h.close(); }
});

test('a model reply with an unsupported time or percentage is replaced by Fogline\'s own briefing', async () => {
  for (const content of ['Leave at 6:15 and you will be fine.', 'You have an 85% chance of arriving on time.']) {
    const model = scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('1', 'compare_departures')] }), () => ({ role: 'assistant', content })]);
    const h = await harness({ chat: model.chat });
    try {
      await h.saveCommute();
      const out = await h.send('/api/agent/assist', { text: 'What should I do?' });
      assert.equal(out.body.replySource, 'fallback');
      assert.equal(out.body.reply, h.state.briefing.speech);
      assert.doesNotMatch(out.body.reply, /85%|6:15/);
    } finally { await h.close(); }
  }
});

test('the loop is bounded: a model that never stops calling tools cannot spin', async () => {
  const model = scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('x', 'read_morning_state'), call('y', 'read_morning_state'), call('z', 'read_morning_state'), call('w', 'read_morning_state')] })]);
  const h = await harness({ chat: model.chat });
  try {
    await h.saveCommute();
    const out = await h.send('/api/agent/assist', { text: 'hello' });
    assert.equal(out.status, 200);
    assert.equal(model.calls, 4);
    assert.equal(out.body.toolsUsed.length, 12, 'at most three calls per round');
    assert.equal(out.body.replySource, 'fallback');
  } finally { await h.close(); }
});

test('today\'s deadline can change only to a time the user wrote, and never edits the weekly deadline', async () => {
  const invent = scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('1', 'apply_today_exception', { kind: 'deadline', arrive_by: '10:00' })] }), m => ({ role: 'assistant', content: lastTool(m).ok ? 'Done.' : 'I need you to tell me the new time.' })]);
  let h = await harness({ chat: invent.chat });
  try {
    await h.saveCommute();
    const out = await h.send('/api/agent/assist', { text: 'Today 9:15 is fine' });
    assert.equal(out.body.reply, 'I need you to tell me the new time.');
    assert.equal(h.state.rides.find((r: any) => r.date === '2026-10-05')?.deadlineOverride, undefined);
  } finally { await h.close(); }
  const honest = scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('1', 'apply_today_exception', { kind: 'deadline', arrive_by: '09:15' })] }), m => ({ role: 'assistant', content: `Today's arrive-by time is now ${lastTool(m).todayArriveBy}.` })]);
  h = await harness({ chat: honest.chat });
  try {
    await h.saveCommute();
    const out = await h.send('/api/agent/assist', { text: 'Today 9:15 is fine' });
    assert.equal(out.body.replySource, 'model');
    assert.equal(h.state.rides.find((r: any) => r.date === '2026-10-05').deadlineOverride, 555);
    assert.equal(h.state.profile.arriveBy, 540, 'weekly deadline unchanged');
    // Tomorrow's ride starts without the exception.
    h.setNow(new Date('2026-10-06T14:00:00Z'));
    await h.send('/api/agent/check', {});
    assert.equal(h.state.rides.find((r: any) => r.date === '2026-10-06').deadlineOverride, undefined);
  } finally { await h.close(); }
});

test('skipping today needs an explicit request, silences reminders, and leaves the schedule alone', async () => {
  const skipModel = () => scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('1', 'apply_today_exception', { kind: 'skip' })] }), m => ({ role: 'assistant', content: lastTool(m).ok ? 'Okay, no reminders today.' : 'I need you to confirm that.' })]);
  let h = await harness({ chat: skipModel().chat });
  try {
    await h.saveCommute();
    assert.equal((await h.send('/api/agent/assist', { text: 'Is my bus on time?' })).body.reply, 'I need you to confirm that.');
    assert.equal(h.state.rides.find((r: any) => r.date === '2026-10-05').skipped, undefined);
  } finally { await h.close(); }
  h = await harness({ chat: skipModel().chat });
  try {
    await h.saveCommute();
    const out = await h.send('/api/agent/assist', { text: "I'm working from home today" });
    assert.equal(out.body.reply, 'Okay, no reminders today.');
    assert.equal(out.body.account.briefing.stage, 'skipped');
    assert.match(out.body.account.briefing.speech, /day off/);
    Object.assign(h.state.settings, { enabled: true, wakeStart: 0, wakeEnd: 1439 }); // enable reminders all day
    for (const minutes of [0, 30, 60, 120]) { h.setNow(new Date(Date.parse('2026-10-05T14:20:00Z') + minutes * 60000)); await h.tick(); }
    assert.equal(h.state.events.filter((e: any) => e.kind === 'push').length, 0);
    assert.deepEqual(h.state.commute.days, [1, 2, 3, 4, 5]);
  } finally { await h.close(); }
});

test('notify_plan queues one deterministic update per plan, previewed when push is off, and never twice', async () => {
  const model = scripted([() => ({ role: 'assistant', content: null, tool_calls: [call('1', 'notify_plan'), call('2', 'notify_plan')] }), () => ({ role: 'assistant', content: 'Sent.' })]);
  const h = await harness({ chat: model.chat });
  try {
    await h.saveCommute();
    const out = await h.send('/api/agent/assist', { text: 'tell me what changed' });
    const pushes = h.state.events.filter((e: any) => e.kind === 'push' && e.actor === 'agent');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].dryRun, true);
    assert.equal(pushes[0].text, h.state.briefing.speech, 'wording is generated by Fogline, not the model');
    assert.equal(out.body.actions.length, 1);
    assert.deepEqual(h.published, []);
  } finally { await h.close(); }
});

test('the briefing states data age, caveats and unconfirmed alerts instead of implying all-clear', async () => {
  const h = await harness({ now: new Date('2026-10-05T13:00:00Z'), chat: scripted([() => ({ role: 'assistant', content: 'ok' })]).chat });
  try {
    const saved = await h.saveCommute();
    const speech: string = saved.body.briefing.speech;
    assert.match(speech, /schedule; no live prediction is confirmed/);
    assert.match(speech, /not guarantees/);
    assert.match(speech, /could not be confirmed\. Disruption status is unknown/);
    assert.doesNotMatch(speech, /No relevant service notices/);
    assert.doesNotMatch(speech, /\d+%/);
  } finally { await h.close(); }
});

test('assist requires a saved commute and valid input', async () => {
  const h = await harness({ chat: scripted([() => ({ role: 'assistant', content: 'hi' })]).chat });
  try {
    assert.equal((await h.send('/api/agent/assist', { text: 'hello' })).status, 409);
    await h.saveCommute();
    assert.equal((await h.send('/api/agent/assist', { text: '' })).status, 400);
    assert.equal((await h.send('/api/agent/assist', { text: 'x'.repeat(1001) })).status, 400);
  } finally { await h.close(); }
});
