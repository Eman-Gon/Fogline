import { checkTrackedRide, observeTracking, queueTrackingReport, trackingDue, trackingInterval, tracksSavedCommute } from './tracking';
import { checkCommuteResearch } from './commute-research';
// @ts-expect-error JavaScript reminder policy.
import { queueCommuteReminders } from './commute-reminders.mjs';
// @ts-expect-error JavaScript morning schedule.
import { schedulerDue } from './agent-schedule.mjs';
// @ts-expect-error Observation archive is a JavaScript module.
import { recordEvidence } from './observations.mjs';
import { deliverPendingPush, notificationStatus, publishNotification, NotificationError } from './notifications.ts';
import { randomUUID, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaults, history, learn, plan, time, type Profile } from '../src/planner.ts';
import { accountStore, type AccountStore } from './store.ts';
import { integrationStatus, interpretCorrection, chatWithTools, IntegrationError } from './integrations.ts';
import { effectiveProfile, morningStage, runAssistant, clockText, type Chat, type ToolEnv } from './morning.ts';
import type { AccountState, AgentSettings, Briefing, Ride, ServerPlan } from '../src/agent-types.ts';
// @ts-expect-error Existing JavaScript transit adapter.
import { getTransitSnapshot } from './transit.mjs';
// @ts-expect-error JavaScript schedule adapter.
import { getCatalog } from './gtfs.mjs';
// @ts-expect-error JavaScript journey planner.
import { planJourney, validateJourney, quickStart } from './journey.mjs';

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(body, (key, value) => key === 'sessions' || key === 'pairCode' ? undefined : value));
};
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
function scanOrigin(hostHeader: string | undefined) {
  const host = hostHeader || 'localhost';
  const [name, port] = host.split(':');
  const local = name === 'localhost' || name === '127.0.0.1';
  let lan: string | undefined;
  if (local) { try { lan = Object.values(networkInterfaces()).flat().find(net => net?.family === 'IPv4' && !net.internal)?.address; } catch { lan = undefined; } }
  return `http://${lan || name}${port ? `:${port}` : ''}`;
}
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
  if (state.commute) {
    const journey = snapshot?.journey || { status: 'unavailable', day: localClock(now, settings.timezone).date, plan: null, departures: [], reason: 'Schedule unavailable. Please try again.' };
    const p = journey.plan;
    const format = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(at));
    const clock = localClock(now, settings.timezone);
    const ride = state.rides.find(r => r.date === clock.date);
    const alerts = [...(journey.warnings||[]),...(journey.notices||[]).map((a:any)=>a.header)];
    // Say how old the evidence is and what could not be confirmed; silence must never read as "all clear".
    const age = p?.source === 'live' && p.observedAt ? Math.max(0, Math.round((now.getTime() - p.observedAt) / 60000)) : null;
    const evidence = p ? (age !== null ? ` The live prediction is ${age === 0 ? 'less than a minute' : `${age} minute${age === 1 ? '' : 's'}`} old.` : ' This is the schedule; no live prediction is confirmed for this trip.') : '';
    const caution = (journey.warnings || []).length ? ` ${journey.warnings.join(' ')} Disruption status is unknown.` : (journey.notices || []).length ? ` Service notices apply: ${journey.notices.map((a: any) => a.header).join(' ')}` : ' No relevant service notices were returned.';
    let speech = p ? `For ${journey.day}, start getting ready at ${format(p.start)}. Leave at ${format(p.leave)} for the ${format(p.expected)} ${state.commute.code} toward ${state.commute.headsign}. Estimated arrival at ${profile.destination}: ${format(p.arrive)}. ${journey.reason}${evidence} Times are estimates, not guarantees.${caution}` : `${journey.reason}${caution}`;
    if (ride?.skipped) speech = 'Today is marked as a day off. Fogline will not remind you.';
    if (ride?.left) speech = ride.arrived ? 'Arrival saved. Your morning is complete.' : 'You are on your way. Check in when you arrive.';
    return { speech, plan: p ? { start: localClock(new Date(p.start),settings.timezone).minute, leave: localClock(new Date(p.leave),settings.timezone).minute, trip: localClock(new Date(p.departure),settings.timezone).minute, arrive: localClock(new Date(p.arrive),settings.timezone).minute, buffer:state.commute.buffer,odds:0 } : null,
      source: p?.source || 'unavailable', stage: morningStage(ride, profile.ready + (ride?.extraPrep ?? 0), p?.start ?? (ride?.alertDue != null ? now.getTime() - (clock.minute - ride.alertDue) * 60000 : null), now.getTime()), checkedAt: now.toISOString(),sourceAt:p?.observedAt?new Date(p.observedAt).toISOString():null,reason:journey.reason,alerts,journey };
  }
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
  const chosen = live ? candidates.sort((a, b) => b.trip - a.trip)[0] ?? null : null;
  const result = chosen ? { ...chosen, start: chosen.leave - profile.ready } : null;
  const reason = live ? 'Matched 511 line and destination. Ride duration is your estimate; risk is not calibrated.' : !settings.headsign ? 'Complete My commute to select your direction and destination stop.' : 'Fresh matching predictions unavailable. Complete My commute to enable scheduled planning.';
  const alertsFeed = snapshot?.alerts;
  const alerts = !alertsFeed?.error && !alertsFeed?.stale ? (alertsFeed?.items ?? []).filter((a: any) => !a.routes?.length || a.routes.includes(settings.line)).map((a: any) => String(a.header)).slice(0, 5) : ['Service alerts could not be confirmed.'];
  let speech = result ? `To reach ${profile.destination} by ${time(profile.arriveBy)}, ${ride?.started ? 'you have started getting ready' : `start getting ready at ${time(result.start)}`}. Leave at ${time(result.leave)} for the ${time(result.trip)} ${settings.line}. Estimated arrival ${time(result.arrive)}. Risk is not calibrated.` : 'No feasible trip was found within the available departures. Check another route or change your deadline.';
  if (!live) speech = reason;
  else speech += ' Ride duration is your estimate.';
  if (ride?.left) speech = ride.arrived ? 'Arrival saved. Your morning is complete.' : 'You are on your way. Check in when you arrive.';
  if (!ride?.arrived) speech += alerts.length ? ` ${alerts.join(' ')}` : ' No relevant alerts were returned.';
  return { speech, plan: ride?.left ? null : result, source: live ? 'live' : 'unavailable', checkedAt: now.toISOString(), sourceAt: fresh ? new Date(feed.fetchedAt).toISOString() : null, reason, alerts };
}

export function escalation(state: AccountState, now: Date, pushEnabled = notificationStatus().configured) {
  const clock = localClock(now, state.settings.timezone);
  const ride = currentRide(state, now);
  if (tracksSavedCommute(state, +now)) return;
  if(state.commute){queueCommuteReminders(state,now,clock,pushEnabled);return;}
  if (!state.settings.enabled || ![1,2,3,4,5].includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(clock.weekday)) || clock.minute < state.settings.wakeStart || clock.minute >= state.settings.wakeEnd || ride.acknowledged || ride.started || !state.briefing) return;
  if (state.briefing.journey && state.briefing.journey.day !== clock.date) return;
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

export function createAgentService({ file, token, snapshot = getTransitSnapshot, now = () => new Date(), store = accountStore(file), interpret = interpretCorrection, publish = publishNotification, pushEnabled = () => notificationStatus().configured, catalog = getCatalog, chat = chatWithTools as Chat, research = checkCommuteResearch }: { file: string; token: () => string | undefined; snapshot?: (stop: string, options?: any) => Promise<any>; now?: () => Date; store?: AccountStore; interpret?: typeof interpretCorrection; publish?: typeof publishNotification; pushEnabled?: () => boolean; catalog?: () => Promise<any>; chat?: Chat; research?: typeof checkCommuteResearch }) {
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
    // Once the planned start has passed, keep tracking that trip even if they have not tapped "I'm starting now".
    const plannedStart = previous?.journey?.plan?.start;
    const planningRide = !ride.started && typeof plannedStart === 'number' && Number.isFinite(plannedStart) && date.getTime() >= plannedStart ? { ...ride, started: new Date(plannedStart).toISOString() } : ride;
    let data;
    try { data = await snapshot(state.profile.stopCode,{commute:state.commute}); } catch { data = null; }
    if (state.commute) {
      try { const timetable = await catalog(); data = { ...data, journey: planJourney(timetable, state.commute, effectiveProfile(state.profile, planningRide), data, date, planningRide, previous?.journey) };
        if(snapshot===getTransitSnapshot){try{await recordEvidence(timetable,state.commute,data,data.journey,date);}catch{data.journey.warnings=[...(data.journey.warnings||[]),'Observation recording is unavailable; learning is paused.'];}} }
      catch { data = { ...data, journey: {status:'unavailable', day:localClock(date,state.settings.timezone).date, plan:null,departures:[],reason:'Schedule unavailable. Your saved commute is safe; try again later.'} }; }
    }
    if (state.commute && data?.journey) data.journey.research = await research(state, data.journey.day, data.journey.plan ? {start:data.journey.plan.leave,end:data.journey.plan.arrive} : undefined);
    state.briefing = computeBriefing(state, data, date);
    if (state.briefing.plan) ride.alertDue = Math.min(ride.alertDue ?? Infinity, state.briefing.plan.start);
    const before = previous?.plan, after = state.briefing.plan;
    if (!previous || previous.source !== state.briefing.source || before?.trip !== after?.trip || before?.start !== after?.start || before?.arrive !== after?.arrive || previous.reason !== state.briefing.reason || JSON.stringify(previous.alerts) !== JSON.stringify(state.briefing.alerts)) {
      event(state, date, 'decision', state.briefing.speech);
    }
    escalation(state, date, pushEnabled());
    return state;
  };
  const tick = async () => {
    const saved = await transact(s=>s,false);
    const clock=localClock(now(),saved.settings.timezone);
    if (trackingDue(saved.tracking, +now())) {
      await transact(async state => {
        if (trackingDue(state.tracking, +now())) {
          await checkTrackedRide(state, now(), { catalog, snapshot, research });
          if (tracksSavedCommute(state, +now())) state.briefing = computeBriefing(state, { journey: state.tracking!.journey }, now());
          queueTrackingReport(state, +now(), pushEnabled());
        }
      });
    }
    if (tracksSavedCommute(saved, +now())) return;
    if(!schedulerDue(saved,now(),clock))return;
    return transact(async state => {
    const clock = localClock(now(), state.settings.timezone);
    const due = schedulerDue(state, now(), clock);
    if (!due) return;
    await check(state);
    const ride = state.rides.find(r => r.date === clock.date);
    if (!ride) return;
    if (due === 'wake') ride.wakeRan = clock.date;
    if (due === 'live') ride.liveRanAt = now().getTime();
    ride.collectRanAt = now().getTime();
  });
  };
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, 'http://localhost');
    if (!url.pathname.startsWith('/api/agent/') && url.pathname !== '/briefing/now') return false;
    void (async () => {
      const secret = token();
      if (!secret || secret.length < 32) throw new ApiError(503, 'Run npm run account on the server to set up your personal account, then restart it.');
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const a = Buffer.from(secret), b = Buffer.from(supplied);
      const bearer = a.length === b.length && timingSafeEqual(a,b);
      const cookie = /(?:^|;\s*)fogline_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const hash = (value: string) => createHash('sha256').update(secret + value).digest('hex');
      const account = !bearer && cookie ? await transact(s=>s,false) : null;
      const session = Boolean(cookie && account?.sessions?.some(s=>s.hash===hash(cookie)&&s.expires>Date.now()));
      const pairing = req.method === 'POST' && url.pathname === '/api/agent/session';
      if (!bearer && !session && !pairing) throw new ApiError(401, 'Connect this device with your personal account key.');
      if (req.method !== 'GET' && req.headers.origin) {
        let origin: URL; try { origin = new URL(req.headers.origin); } catch { throw new ApiError(403,'Invalid request origin.'); }
        if (origin.host !== req.headers.host) throw new ApiError(403,'Open Fogline on the same server to save changes.');
      }
      if (req.method !== 'GET' && session && !req.headers.origin && req.headers['x-fogline-client'] !== '1') throw new ApiError(403,'Missing request origin.');
      const forwarded = req.headers['x-forwarded-proto'];
      const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim();
      const secure = proto === 'https' || Boolean((req.socket as { encrypted?: boolean }).encrypted) ? '; Secure' : '';
      const openSession = async (state: AccountState, sessionToken: string) => {
        state.sessions=(state.sessions||[]).filter(x=>x.expires>Date.now()).slice(-19);
        state.sessions.push({hash:hash(sessionToken),expires:Date.now()+30*86400000});
      };
      if (req.method === 'POST' && url.pathname === '/api/agent/pair-code') {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const raw = [...randomBytes(6)].map(b => alphabet[b % alphabet.length]).join('');
        const expires = Date.now() + 10 * 60 * 1000;
        await transact(s => { s.pairCode = { hash: hash(raw), expires }; });
        const shown = `${raw.slice(0, 3)}-${raw.slice(3)}`;
        json(res, 200, { code: shown, expires, scanUrl: `${scanOrigin(req.headers.host)}/?pair=${shown}` }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/session') {
        const sessionToken = randomBytes(32).toString('hex');
        if (bearer) {
          await transact(s => openSession(s, sessionToken));
        } else {
          const code = supplied.replace(/[\s-]/g, '').toUpperCase();
          if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError(401, 'That key or pairing code did not work.');
          const digest = hash(code);
          await transact(s => {
            const pair = s.pairCode;
            const match = Boolean(pair && pair.expires > Date.now() && pair.hash.length === digest.length && timingSafeEqual(Buffer.from(pair.hash), Buffer.from(digest)));
            if (!match) throw new ApiError(401, 'That key or pairing code did not work.');
            delete s.pairCode;
            return openSession(s, sessionToken);
          });
        }
        res.setHeader('Set-Cookie', `fogline_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`);
        json(res,200,{connected:true});return;
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/logout') {
        if(cookie)await transact(s=>{s.sessions=(s.sessions||[]).filter(x=>x.hash!==hash(cookie));});
        res.setHeader('Set-Cookie',`fogline_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);json(res,200,{connected:false});return;
      }
      if (req.method === 'GET' && url.pathname === '/api/agent/integrations') { json(res, 200, integrationStatus()); return; }
      if (req.method === 'GET' && url.pathname === '/api/agent/state') { json(res, 200, await transact(s => s, false)); return; }
      if (req.method === 'GET' && url.pathname === '/briefing/now') { json(res, 200, (await transact(check)).briefing); return; }
      if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      const input = await body(req);
      if (url.pathname === '/api/agent/notifications/test') {
        const id = await publish('Fogline test: notifications are connected. Open Fogline to manage your morning.');
        json(res, 200, { accepted: true, id }); return;
      }
      if (url.pathname === '/api/agent/assist') {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000) throw new ApiError(400, 'Enter a request of up to 1000 characters.');
        const first = await transact(s => s, false);
        if (!first.commute) throw new ApiError(409, 'Save your commute first, then ask Fogline to adjust your morning.');
        const env: ToolEnv = {
          now, userText: input.text, pushEnabled, read: () => transact(s => structuredClone(s), false), write: transact, check,
          ride: s => currentRide(s, now()),
          // Read-only: evaluates validated departures under an assumption without saving it.
          compare: async (s, extra) => {
            const date = now(), ride = s.rides.find(r => r.date === localClock(date, s.settings.timezone).date) ?? null;
            const data = await snapshot(s.profile.stopCode, { commute: s.commute });
            const base = effectiveProfile(s.profile, ride);
            return planJourney(await catalog(), s.commute, { ...base, ready: base.ready + extra }, data, date, ride, undefined);
          },
        };
        json(res, 200, { ...(await runAssistant({ text: input.text, chat, env })), account: await transact(s => s, false) }); return;
      }
      if (url.pathname === '/api/agent/research') {
        const state = await transact(s => s, false);
        const journey = state.briefing?.journey;
        json(res, 200, await research(state, journey?.day ?? localClock(now(), state.settings.timezone).date,
          journey?.plan ? { start: journey.plan.leave, end: journey.plan.arrive } : undefined, { force: true })); return;
      }
      if (url.pathname === '/api/agent/tracking') {
        const result = await transact(async state => {
          const date = now(), at = +date;
          if (input.action === 'start') {
            if (state.tracking?.active && state.tracking.expiresAt > at) throw new ApiError(409, 'Stop the tracked ride before tracking another one.');
            const quick = input.commute !== undefined;
            const raw = quick ? input.commute : state.commute;
            if (!raw) throw new ApiError(400, 'Choose your route and stops first.');
            let selected;
            const timetable = await catalog();
            try { selected = validateJourney(raw, timetable); } catch (e) { throw new ApiError(400, (e as Error).message); }
            const buffer = raw.buffer ?? 7, boardingMargin = raw.boardingMargin ?? 3;
            if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60 || !Number.isInteger(boardingMargin) || boardingMargin < 0 || boardingMargin > 20) throw new ApiError(400, 'Invalid arrival buffer or boarding margin.');
            let timing = {};
            try { timing = quick ? quickStart(input.quickTiming, date) : {}; } catch (e) { throw new ApiError(400, (e as Error).message); }
            const commute = { ...selected, ...timing, days: [0,1,2,3,4,5,6], buffer, boardingMargin, deadlineFirm: raw.deadlineFirm !== false };
            const existingRide = quick ? null : state.rides.find(r => r.date === localClock(date, state.settings.timezone).date) ?? null;
            if (existingRide?.arrived || existingRide?.skipped) throw new ApiError(409, 'This morning is already complete. Use Quick use for another ride.');
            const profile = validateProfile({ ...(quick ? input.profile : effectiveProfile(state.profile, existingRide)), stopCode: selected.stopId });
            let data = null;
            try { data = await snapshot(commute.stopId, { commute }); } catch { /* The plan labels schedule-only evidence. */ }
            const journey = planJourney(timetable, commute, profile, data, date, existingRide, quick ? null : state.briefing?.journey);
            if (!journey.plan || journey.day !== localClock(date, 'America/Los_Angeles').date) throw new ApiError(409, 'No feasible ride to track today. Review the departures or adjust your arrive-by time.');
            const researchState = { ...state, commute, profile, rides: [], settings: { ...state.settings, line: commute.line, headsign: commute.headsign } };
            journey.research = await research(researchState, journey.day, { start: journey.plan.leave, end: journey.plan.arrive });
            if (state.tracking) {
              state.tracking.active = false;
              state.trackingHistory = [state.tracking, ...(state.trackingHistory || [])].slice(0, 10);
            }
            state.tracking = {
              id: randomUUID(), active: true, origin: quick ? 'quick' : 'saved', createdAt: at,
              expiresAt: Math.min(at + 4 * 60 * 60000, journey.plan.arrive + 30 * 60000),
              commute, profile, trip: journey.plan, journey, lastCheckedAt: at,
              nextCheckAt: at + trackingInterval(journey.plan.leave, at), researchAttemptAt: at,
              departureResearchDone: journey.plan.leave - at <= 10 * 60000,
              samples: [], reports: [], delayStreak: 0, lastObservation: null, lastDelay: null, reportedDelay: null,
              ...(existingRide?.started ? { started: Date.parse(existingRide.started) } : {}),
              ...(existingRide?.left ? { left: Date.parse(existingRide.left) } : {}),
              ...(existingRide?.boarded ? { boarded: Date.parse(existingRide.boarded) } : {}),
            };
            observeTracking(state.tracking, journey, at);
            return state;
          }
          const tracked = state.tracking;
          if (!tracked || input.id !== tracked.id) throw new ApiError(409, 'The tracked ride changed. Reopen Track ride.');
          if (input.action === 'stop') { tracked.active = false; tracked.endedReason = 'Tracking stopped by you.'; return state; }
          if (!tracked.active || at >= tracked.expiresAt) throw new ApiError(409, 'Tracking has ended. Set up another ride.');
          if (input.action === 'prepare') tracked.started ??= at;
          else if (input.action === 'leave') {
            if (!tracked.started) throw new ApiError(409, 'Record starting preparation first.');
            tracked.left ??= at;
          } else if (input.action === 'board') {
            if (!tracked.left) throw new ApiError(409, 'Record leaving first.');
            tracked.boarded ??= at;
          } else if (input.action === 'arrive') {
            if (!tracked.left) throw new ApiError(409, 'Record leaving first.');
            tracked.arrived ??= at; tracked.active = false; tracked.endedReason = 'Arrival confirmed by you.';
          } else throw new ApiError(400, 'Unknown tracking action.');
          if (tracked.origin === 'saved' && state.commute?.patternId === tracked.commute.patternId && state.commute?.stopId === tracked.commute.stopId && state.commute?.alightId === tracked.commute.alightId) {
            const morning = currentRide(state, date);
            if (tracked.started) { morning.started ??= new Date(tracked.started).toISOString(); morning.acknowledged = true; }
            if (tracked.left) {
              morning.left ??= new Date(tracked.left).toISOString();
              const measured = (tracked.left - tracked.started!) / 60000;
              if (morning.measured === null && measured >= 5 && measured <= 180) {
                morning.measured = Math.round(measured); morning.nextReady = learn(state.profile.ready, measured);
              }
            }
            if (tracked.boarded) morning.boarded ??= new Date(tracked.boarded).toISOString();
            if (tracked.arrived) morning.arrived ??= new Date(tracked.arrived).toISOString();
          }
          return state;
        });
        json(res, 200, result); return;
      }
      if (url.pathname === '/api/agent/preview') {
        if (input.text !== undefined && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000)) throw new ApiError(400, 'Enter a request of up to 1000 characters.');
        if (input.forceResearch !== undefined && typeof input.forceResearch !== 'boolean') throw new ApiError(400, 'Research refresh must be true or false.');
        let selected;
        try { selected = validateJourney(input.commute, await catalog()); } catch (e) { throw new ApiError(400, (e as Error).message); }
        const buffer = input.commute?.buffer ?? 7;
        const boardingMargin = input.commute?.boardingMargin ?? 3;
        if (!Number.isInteger(buffer) || buffer < 0 || buffer > 60 || !Number.isInteger(boardingMargin) || boardingMargin < 0 || boardingMargin > 20) throw new ApiError(400, 'Choose a buffer between 0 and 60 minutes.');
        const profile = validateProfile({ ...input.profile, stopCode: selected.stopId });
        const date = now();
        let timing = {};
        try { timing = quickStart(input.quickTiming, date); } catch (e) { throw new ApiError(400, (e as Error).message); }
        const commute = { ...selected, ...timing, days: [0, 1, 2, 3, 4, 5, 6], buffer, boardingMargin, deadlineFirm: true };
        let data = null;
        try { data = await snapshot(profile.stopCode, { commute }); } catch { data = null; }
        let journey;
        try { journey = planJourney(await catalog(), commute, profile, data, date, null, null); }
        catch { journey = { status: 'unavailable', day: localClock(date, 'America/Los_Angeles').date, plan: null, departures: [], reason: 'Schedule unavailable. Nothing was saved.' }; }
        const researchState = freshAccount();
        researchState.profile = profile;
        researchState.commute = commute;
        researchState.settings = { ...researchState.settings, line: commute.line, headsign: commute.headsign };
        journey.research = await research(researchState, journey.day, journey.plan ? { start: journey.plan.leave, end: journey.plan.arrive } : undefined, { force: input.forceResearch === true });
        if (input.text !== undefined) {
          // A private, request-local state: never enter the account transaction or publish notifications.
          const temporary = researchState;
          temporary.briefing = computeBriefing(temporary, { journey }, date);
          currentRide(temporary, date);
          const compare = async (s: AccountState, extra: number) => {
            const p = effectiveProfile(s.profile, currentRide(s, date));
            return planJourney(await catalog(), s.commute, { ...p, ready: p.ready + extra }, data, date, null, null);
          };
          const refreshTemporary = async (s: AccountState) => {
            const nextJourney = await compare(s, 0);
            nextJourney.research = await research(s, nextJourney.day, nextJourney.plan ? { start: nextJourney.plan.leave, end: nextJourney.plan.arrive } : undefined);
            s.briefing = computeBriefing(s, { journey: nextJourney }, date);
            return s;
          };
          const env: ToolEnv = { quick: true, now: () => date, userText: input.text, pushEnabled: () => false,
            read: async () => temporary, write: async fn => fn(temporary), ride: s => currentRide(s, date), compare, check: refreshTemporary };
          const answer = await runAssistant({ text: input.text, chat, env });
          json(res, 200, { ...answer, saved: false, commute, profile: effectiveProfile(temporary.profile, currentRide(temporary, date)), journey: temporary.briefing!.journey }); return;
        }
        json(res, 200, { saved: false, commute, profile, journey }); return;
      }
      // Model latency stays outside the storage queue. Re-read current state before applying tools.
      const correction = url.pathname === '/api/agent/correct' ? await (async () => {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000) throw new ApiError(400, 'Enter a request of up to 1000 characters.');
        return interpret(input.text);
      })() : null;
      let selectedJourney: any;
      if (url.pathname === '/api/agent/commute') {
        try { selectedJourney = validateJourney(input.commute, await catalog()); } catch (e) { throw new ApiError(400,(e as Error).message); }
      }
      const result = await transact(async state => {
        if (correction) {
          if (correction.kind === 'clarify') throw new ApiError(422, 'Try an explicit total, such as “I need 45 minutes to get ready tomorrow,” or ask to read the current plan. Other changes belong in Setup.');
          currentRide(state, now());
          if (correction.kind === 'ready') {
            const today = localClock(now(), state.settings.timezone).date;
            const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            state.readyOverride = { date: tomorrow.toISOString().slice(0, 10), minutes: correction.minutes };
            event(state, now(), 'decision', `Neon AI interpreted your request. Tomorrow’s getting-ready estimate is ${correction.minutes} minutes. Today’s estimate is unchanged.`);
          }
          return check(state);
        }
        if (url.pathname === '/api/agent/check') return check(state);
        if (url.pathname === '/api/agent/commute') {
          if (input.configRevision!=null?input.configRevision!==(state.configRevision??0):input.revision!==state.revision) throw new ApiError(409,'Your commute changed on another device. Refresh and review before saving.');
          const profile = validateProfile({...input.profile,stopCode:selectedJourney.stopId});
          const days = input.commute.days;
          if (!Array.isArray(days)||!days.length||days.some((d:any)=>!Number.isInteger(d)||d<0||d>6)||!Number.isInteger(input.commute.buffer)||input.commute.buffer<0||input.commute.buffer>60) throw new ApiError(400,'Choose travel days and a buffer between 0 and 60 minutes.');
          const ride=currentRide(state,now());
          if(ride.started&&!ride.arrived)throw new ApiError(409,'Finish the current journey before changing your commute.');
          const boardingMargin=input.commute.boardingMargin??3;
          if(!Number.isInteger(boardingMargin)||boardingMargin<0||boardingMargin>20)throw new ApiError(400,'Boarding margin must be between 0 and 20 minutes.');
          state.configRevision=(state.configRevision??0)+1;
          state.commute={...selectedJourney,days:[...new Set(days)] as number[],buffer:input.commute.buffer,boardingMargin,deadlineFirm:input.commute.deadlineFirm!==false};
          state.profile=profile;state.settings={...state.settings,line:selectedJourney.line,headsign:selectedJourney.headsign,timezone:'America/Los_Angeles'};
          state.learningAppliedThrough=state.rides.find(r=>r.nextReady!==null)?.date??null;
          delete state.readyOverride;delete ride.alertDue;
          event(state,now(),'decision','Commute saved.');return check(state);
        }
        if (url.pathname === '/api/agent/settings') {
          if (input.configRevision!=null?input.configRevision!==(state.configRevision??0):input.revision!==state.revision) throw new ApiError(409, 'Another device changed your account. Refresh and try again.');
          const profile = validateProfile(input.profile), settings = validateSettings(input.settings);
          if(state.commute && (profile.stopCode!==state.commute.stopId || settings.line!==state.commute.line || settings.headsign!==state.commute.headsign)) throw new ApiError(409,'Change your route in My commute.');
          const ride = currentRide(state, now());
          if (ride.started && !ride.arrived) throw new ApiError(409, 'Finish today’s check-in before changing preferences.');
          if (settings.timezone !== state.settings.timezone && state.rides.some(r => r.started)) throw new ApiError(409, 'Timezone cannot change after your first check-in.');
          state.configRevision=(state.configRevision??0)+1;
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
          } else if(input.action==='board'){if(!ride.left)throw new ApiError(409,'Record leaving first.');if(!ride.boarded)ride.boarded=at;
          } else if (input.action === 'arrive') { if (!ride.left) throw new ApiError(409, 'Record leaving first.'); if (!ride.arrived) ride.arrived = at; }
          else throw new ApiError(400, 'Unknown check-in action.');
          const tracked = state.tracking;
          if (tracked?.active && tracked.origin === 'saved' && state.commute?.patternId === tracked.commute.patternId && state.commute?.stopId === tracked.commute.stopId && state.commute?.alightId === tracked.commute.alightId) {
            if (ride.started) tracked.started ??= Date.parse(ride.started);
            if (ride.left) tracked.left ??= Date.parse(ride.left);
            if (ride.boarded) tracked.boarded ??= Date.parse(ride.boarded);
            if (ride.arrived) { tracked.arrived ??= Date.parse(ride.arrived); tracked.active = false; tracked.endedReason = 'Arrival confirmed by you.'; }
          }
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
