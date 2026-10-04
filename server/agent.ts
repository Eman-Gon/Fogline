import { deliverPendingPush, notificationStatus, publishNotification, NotificationError } from './notifications.ts';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaults, history, learn, plan, time, type Profile } from '../src/planner.ts';
import { accountStore, type AccountStore } from './store.ts';
import { integrationStatus, interpretCorrection, researchRoute, IntegrationError } from './integrations.ts';
import type { AccountState, AgentSettings, Briefing, Ride, ServerPlan } from '../src/agent-types.ts';
// @ts-expect-error Existing JavaScript transit adapter.
import { getTransitSnapshot } from './transit.mjs';

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(body));
};
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function localClock(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: parts.weekday };
}
export function freshAccount(): AccountState {
  return { version: 1, revision: 0, learningAppliedThrough: null, profile: { ...defaults }, settings: { enabled: false, timezone: 'America/Los_Angeles', wakeStart: 420, wakeEnd: 600, line: 'T', headsign: '' }, briefing: null, rides: [], events: [] };
}
function currentRide(state: AccountState, now: Date): Ride {
  const date = localClock(now, state.settings.timezone).date;
  let ride = state.rides.find(r => r.date === date);
  if (!ride) {
    const learned = state.rides.find(r => r.nextReady !== null && r.date > (state.learningAppliedThrough ?? '') && r.date < date);
    if (learned) { state.profile.ready = learned.nextReady!; state.learningAppliedThrough = learned.date; }
    if (state.readyOverride && state.readyOverride.date <= date) {
      state.profile.ready = state.readyOverride.minutes;
      state.learningAppliedThrough = state.rides.find(r => r.nextReady !== null)?.date ?? state.learningAppliedThrough;
      delete state.readyOverride;
    }
    ride = { date, started: null, left: null, arrived: null, measured: null, nextReady: null, acknowledged: false };
    state.rides.unshift(ride);
    state.rides = state.rides.slice(0, 365);
  }
  return ride;
}
function event(state: AccountState, now: Date, kind: 'decision' | 'push' | 'call', text: string, id: string = randomUUID()) {
  if (state.events.some(e => e.id === id)) return;
  state.events.unshift({ id, at: now.toISOString(), kind, text, dryRun: kind !== 'decision' });
  state.events = state.events.slice(0, 500);
}

// Numeric trip selection and wording share the same result; no model-generated numbers.
export function computeBriefing(state: AccountState, snapshot: any, now: Date): Briefing {
  const { profile, settings } = state;
  const clock = localClock(now, settings.timezone);
  const ride = state.rides.find(r => r.date === clock.date);
  const remaining = ride?.started ? Math.max(0, profile.ready - (now.getTime() - Date.parse(ride.started)) / 60000) : profile.ready;
  const buffer = [...history].sort((a, b) => a - b)[Math.ceil(history.length * .8) - 1];
  const feed = snapshot?.arrivals;
  const fresh = feed?.fetchedAt && !feed.stale && !feed.error && now.getTime() - feed.fetchedAt >= 0 && now.getTime() - feed.fetchedAt <= 10 * 60000;
  const matching = (feed?.items ?? []).filter((a: any) => a.line === settings.line && settings.headsign && a.destination === settings.headsign);
  const candidates: ServerPlan[] = fresh ? matching.flatMap((a: any) => {
    const aimed = new Date(a.aimed), expected = new Date(a.expected);
    if (!Number.isFinite(aimed.getTime()) || !Number.isFinite(expected.getTime()) || expected <= now) return [];
    const scheduled = localClock(aimed, settings.timezone), predicted = localClock(expected, settings.timezone);
    if (scheduled.date !== clock.date || predicted.date !== clock.date) return [];
    const trip = Math.min(scheduled.minute, predicted.minute);
    const leave = trip - profile.walk;
    const arrive = predicted.minute + profile.ride + profile.destinationWalk;
    if (leave - remaining < clock.minute || arrive + buffer > profile.arriveBy) return [];
    return [{ trip, leave, start: leave - profile.ready, arrive, buffer, odds: Math.round(history.filter(d => arrive + d <= profile.arriveBy).length / history.length * 100) }];
  }) : [];
  // A matched, fresh feed with no feasible trip must not turn into a fictional fallback trip.
  const live = Boolean(fresh && matching.some((a: any) => Number.isFinite(Date.parse(a.aimed)) && Number.isFinite(Date.parse(a.expected)) && localClock(new Date(a.expected), settings.timezone).date === clock.date));
  const chosen = live ? candidates.sort((a, b) => b.trip - a.trip)[0] ?? null : plan({ ...profile, ready: Math.ceil(remaining) }, 0, clock.minute);
  const result = chosen ? { ...chosen, start: chosen.leave - profile.ready } : null;
  const reason = live ? 'Matched 511 line and destination. Ride duration is your estimate; risk uses 14 seeded delays.' : !settings.headsign ? 'Set an exact 511 destination to match your direction. Sample timetable in use.' : 'Fresh matching 511 predictions unavailable. Sample timetable in use.';
  const alertsFeed = snapshot?.alerts;
  const alerts = !alertsFeed?.error && !alertsFeed?.stale ? (alertsFeed?.items ?? []).filter((a: any) => !a.routes?.length || a.routes.includes(settings.line)).map((a: any) => String(a.header)).slice(0, 5) : ['Service alerts could not be confirmed.'];
  let speech = result ? `To reach ${profile.destination} by ${time(profile.arriveBy)}, ${ride?.started ? 'you have started getting ready' : `start getting ready at ${time(result.start)}`}. Leave at ${time(result.leave)} for the ${time(result.trip)} ${settings.line}. Estimated arrival ${time(result.arrive)}. This fits ${result.odds}% of 14 seeded rides, with low confidence.` : 'No feasible trip was found within the available departures. Check another route or change your deadline.';
  if (!live) speech = `Sample plan, not a live travel recommendation. ${speech}`;
  else speech += ' Ride duration is your estimate.';
  if (ride?.left) speech = ride.arrived ? 'Arrival saved. Your morning is complete.' : 'You are on your way. Check in when you arrive.';
  if (!ride?.arrived) speech += alerts.length ? ` ${alerts.join(' ')}` : ' No relevant alerts were returned.';
  return { speech, plan: ride?.left ? null : result, source: live ? 'live' : 'sample', checkedAt: now.toISOString(), sourceAt: fresh ? new Date(feed.fetchedAt).toISOString() : null, reason, alerts };
}

export function escalation(state: AccountState, now: Date, pushEnabled = notificationStatus().configured) {
  const clock = localClock(now, state.settings.timezone);
  const ride = currentRide(state, now);
  if (!state.settings.enabled || ['Sat', 'Sun'].includes(clock.weekday) || clock.minute < state.settings.wakeStart || clock.minute >= state.settings.wakeEnd || ride.acknowledged || ride.started || !state.briefing) return;
  const due = Math.max(state.settings.wakeStart, ride.alertDue ?? state.briefing.plan?.start ?? state.settings.wakeStart);
  if (clock.minute < due) return;
  const pushId = `${clock.date}:push`;
  let push = state.events.find(e => e.id === pushId);
  if (!push) { event(state, now, 'push', state.briefing.speech, pushId); push = state.events.find(e => e.id === pushId)!; if (pushEnabled) push.delivery = { status: 'pending' }; }
  const elapsed = (now.getTime() - Date.parse(push.at)) / 60000;
  // At most two calls per local day, timed from the actual queued push.
  if (elapsed >= 5) event(state, now, 'call', `Escalation 1: no acknowledgement. ${state.briefing.speech}`, `${clock.date}:call:1`);
  const firstCall = state.events.find(e => e.id === `${clock.date}:call:1`);
  if (firstCall && (now.getTime() - Date.parse(firstCall.at)) / 60000 >= 5) event(state, now, 'call', `Escalation 2: no acknowledgement. ${state.briefing.speech}`, `${clock.date}:call:2`);
}

function validateProfile(value: any): Profile {
  if (!value || typeof value.destination !== 'string' || !value.destination.trim() || value.destination.length > 60 || typeof value.stopCode !== 'string' || !/^\d{0,10}$/.test(value.stopCode)) throw new ApiError(400, 'Invalid destination or stop code.');
  for (const [key, min, max] of [['arriveBy', 0, 1439], ['ready', 5, 180], ['walk', 0, 90], ['ride', 1, 180], ['destinationWalk', 0, 90]] as const) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new ApiError(400, `Invalid ${key}.`);
  }
  return Object.fromEntries(Object.keys(defaults).map(k => [k, value[k]])) as Profile;
}
function validateSettings(value: any): AgentSettings {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.timezone !== 'string' || typeof value.line !== 'string' || !value.line.trim() || value.line.length > 20 || typeof value.headsign !== 'string' || value.headsign.length > 150) throw new ApiError(400, 'Invalid agent settings.');
  try { localClock(new Date(), value.timezone); } catch { throw new ApiError(400, 'Unknown timezone.'); }
  if (!Number.isInteger(value.wakeStart) || !Number.isInteger(value.wakeEnd) || value.wakeStart < 0 || value.wakeEnd > 1439 || value.wakeStart >= value.wakeEnd) throw new ApiError(400, 'Wake window must start and end on the same day.');
  return { enabled: value.enabled, timezone: value.timezone, line: value.line.trim(), headsign: value.headsign.trim(), wakeStart: value.wakeStart, wakeEnd: value.wakeEnd };
}
async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 16384) throw new ApiError(413, 'Request too large.'); }
  try { return JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON.'); }
}

export function createAgentService({ file, token, snapshot = getTransitSnapshot, now = () => new Date(), store = accountStore(file), interpret = interpretCorrection, publish = publishNotification, pushEnabled = () => notificationStatus().configured }: { file: string; token: () => string | undefined; snapshot?: (stop: string) => Promise<any>; now?: () => Date; store?: AccountStore; interpret?: typeof interpretCorrection; publish?: typeof publishNotification; pushEnabled?: () => boolean }) {
  let queue: Promise<unknown> = Promise.resolve();
  const transact = <T,>(fn: (state: AccountState) => Promise<T> | T, write = true): Promise<T> => {
    const work = queue.then(async () => {
      const state = await store.read() ?? freshAccount();
      if (state.version !== 1) throw new Error('Unsupported account version.');
      const expectedRevision = state.revision;
      const result = await fn(state);
      if (write) {
        state.revision++;
        await store.save(state, expectedRevision);
        await deliverPendingPush(state, now(), async () => { const revision = state.revision; state.revision++; await store.save(state, revision); }, publish);
      }
      return result;
    });
    queue = work.catch(() => {});
    return work;
  };
  const check = async (state: AccountState) => {
    const date = now(); const ride = currentRide(state, date);
    const previous = state.briefing;
    let data;
    try { data = await snapshot(state.profile.stopCode); } catch { data = null; }
    state.briefing = computeBriefing(state, data, date);
    if (state.briefing.plan) ride.alertDue = Math.min(ride.alertDue ?? Infinity, state.briefing.plan.start);
    const before = previous?.plan, after = state.briefing.plan;
    if (!previous || previous.source !== state.briefing.source || before?.trip !== after?.trip || before?.start !== after?.start || before?.arrive !== after?.arrive || previous.reason !== state.briefing.reason || JSON.stringify(previous.alerts) !== JSON.stringify(state.briefing.alerts)) {
      event(state, date, 'decision', state.briefing.speech);
    }
    escalation(state, date, pushEnabled());
    return state;
  };
  const tick = () => transact(async state => {
    const clock = localClock(now(), state.settings.timezone);
    if (!state.settings.enabled || ['Sat', 'Sun'].includes(clock.weekday) || clock.minute < Math.max(0, state.settings.wakeStart - 10) || clock.minute >= state.settings.wakeEnd) return;
    await check(state);
  });
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, 'http://localhost');
    if (!url.pathname.startsWith('/api/agent/') && url.pathname !== '/briefing/now') return false;
    void (async () => {
      const secret = token();
      if (!secret || secret.length < 32) throw new ApiError(503, 'Run npm run account on the server to set up your personal account, then restart it.');
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const a = Buffer.from(secret), b = Buffer.from(supplied);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'Enter your server account key.');
      if (req.method === 'GET' && url.pathname === '/api/agent/integrations') { json(res, 200, integrationStatus()); return; }
      if (req.method === 'GET' && url.pathname === '/api/agent/state') { json(res, 200, await transact(s => s, false)); return; }
      if (req.method === 'GET' && url.pathname === '/briefing/now') { json(res, 200, (await transact(check)).briefing); return; }
      if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      const input = await body(req);
      if (url.pathname === '/api/agent/notifications/test') {
        const id = await publish('Fogline test: notifications are connected. Open Fogline to manage your morning.');
        json(res, 200, { accepted: true, id }); return;
      }
      if (url.pathname === '/api/agent/research') {
        const state = await transact(s => s, false);
        json(res, 200, await researchRoute(state)); return;
      }
      // Model latency stays outside the storage queue. Re-read current state before applying tools.
      const correction = url.pathname === '/api/agent/correct' ? await (async () => {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000) throw new ApiError(400, 'Enter a request of up to 1000 characters.');
        return interpret(input.text);
      })() : null;
      const result = await transact(async state => {
        if (correction) {
          if (correction.kind === 'clarify') throw new ApiError(422, 'Try an explicit total, such as “I need 45 minutes to get ready tomorrow,” or ask to read the current plan. Other changes belong in Setup.');
          currentRide(state, now());
          if (correction.kind === 'ready') {
            const today = localClock(now(), state.settings.timezone).date;
            const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            state.readyOverride = { date: tomorrow.toISOString().slice(0, 10), minutes: correction.minutes };
            event(state, now(), 'decision', `Mastra interpreted your request. Tomorrow’s getting-ready estimate is ${correction.minutes} minutes. Today’s estimate is unchanged.`);
          }
          return check(state);
        }
        if (url.pathname === '/api/agent/check') return check(state);
        if (url.pathname === '/api/agent/settings') {
          if (input.revision !== state.revision) throw new ApiError(409, 'Another device changed your account. Refresh and try again.');
          const profile = validateProfile(input.profile), settings = validateSettings(input.settings);
          const ride = currentRide(state, now());
          if (ride.started && !ride.arrived) throw new ApiError(409, 'Finish today’s check-in before changing preferences.');
          if (settings.timezone !== state.settings.timezone && state.rides.some(r => r.started)) throw new ApiError(409, 'Timezone cannot change after your first check-in.');
          state.profile = profile; state.settings = settings; delete state.readyOverride;
          // An explicit preparation preference supersedes earlier learning.
          state.learningAppliedThrough = state.rides.find(r => r.nextReady !== null)?.date ?? null;
          event(state, now(), 'decision', 'Server preferences updated.');
          return check(state);
        }
        if (url.pathname === '/api/agent/checkin') {
          const date = now(), ride = currentRide(state, date), at = date.toISOString();
          if (input.action === 'acknowledge') ride.acknowledged = true;
          else if (input.action === 'start') { if (!ride.started) ride.started = at; ride.acknowledged = true; }
          else if (input.action === 'leave') {
            if (!ride.started) throw new ApiError(409, 'Start getting ready first.');
            if (!ride.left) {
              const measured = (date.getTime() - Date.parse(ride.started)) / 60000;
              if (measured < 5 || measured > 180) throw new ApiError(400, 'Preparation must take between 5 and 180 minutes.');
              ride.measured = Math.round(measured); ride.nextReady = learn(state.profile.ready, measured); ride.left = at;
            }
          } else if (input.action === 'arrive') { if (!ride.left) throw new ApiError(409, 'Record leaving first.'); if (!ride.arrived) ride.arrived = at; }
          else throw new ApiError(400, 'Unknown check-in action.');
          event(state, date, 'decision', `Check-in: ${input.action}.`, `${ride.date}:checkin:${input.action}`);
          return check(state);
        }
        throw new ApiError(404, 'Unknown agent endpoint.');
      });
      json(res, 200, result);
    })().catch(e => { if (!(e instanceof ApiError) && !(e instanceof IntegrationError) && !(e instanceof NotificationError)) console.error('Agent request failed.'); json(res, e instanceof ApiError ? e.status : e instanceof IntegrationError || e instanceof NotificationError ? 502 : 500, { error: e instanceof ApiError || e instanceof IntegrationError || e instanceof NotificationError ? e.message : 'The server could not save or load your account.' }); });
    return true;
  };
  return { handler, tick, start() { const timer = setInterval(() => { if (token()) void tick().catch(e => console.error('Agent check failed; check storage and provider availability.')); }, 60000); timer.unref(); return () => clearInterval(timer); } };
}
