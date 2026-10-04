import type { AccountState } from '../src/agent-types';
import type { TrackedRide, TrackingReport } from '../src/tracking-types';
import type { JourneyResult } from '../src/commute-types';
import type { checkCommuteResearch } from './commute-research';
// @ts-expect-error JavaScript journey planner.
import { assessTrip, scheduledJourneys } from './journey.mjs';

const MINUTE = 60000;
export function tracksSavedCommute(state: AccountState, now: number) {
  const ride = state.tracking;
  return Boolean(ride?.active && ride.expiresAt > now && ride.origin === 'saved' &&
    ride.commute.patternId === state.commute?.patternId && ride.commute.stopId === state.commute?.stopId && ride.commute.alightId === state.commute?.alightId);
}
export function trackingInterval(leave: number, now: number) {
  const remaining = leave - now;
  return (remaining <= 10 * MINUTE ? 3 : remaining <= 20 * MINUTE ? 4 : 10) * MINUTE;
}
export function trackingDue(ride: TrackedRide | undefined, now: number) {
  if (!ride?.active) return false;
  // Recompute the interval so crossing a threshold can bring the next check forward.
  return now >= ride.expiresAt || now >= Math.min(ride.nextCheckAt, ride.lastCheckedAt + trackingInterval(ride.trip.leave, now));
}
function report(ride: TrackedRide, at: number, kind: TrackingReport['kind'], text: string) {
  ride.reports.unshift({ at, kind, text });
  ride.reports = ride.reports.slice(0, 40);
}
export function queueTrackingReport(state: AccountState, now: number, pushEnabled: boolean) {
  const ride = state.tracking, latest = ride?.reports[0];
  if (!ride?.active || !latest || latest.at > now || now - latest.at > 6 * MINUTE || latest.kind === 'unavailable' || !state.settings.enabled || !pushEnabled) return;
  const id = `${ride.id}:tracking:${latest.at}:${latest.kind}`;
  if (state.events.some(event => event.id === id)) return;
  const research = ride.journey.research;
  const context = research?.status === 'ready' ? ` Route report (${research.checkedAt}): ${research.assessment?.explanation || research.message}` : ' Exa route conditions are unconfirmed.';
  const plan = ride.journey.plan;
  const clock = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
  const late = plan ? Math.max(0, Math.ceil((plan.arrive - ride.trip.deadline) / MINUTE)) : 0;
  const arrival = plan ? ` Estimated arrival at ${ride.profile.destination}: ${clock(plan.arrive)}. Need to arrive by ${clock(ride.trip.deadline)}.${late ? ` Estimated ${late} minutes late.` : ''}` : ' Destination arrival estimate is unavailable.';
  state.events.unshift({ id, trackingId: ride.id, at: new Date(latest.at).toISOString(), kind: 'push', text: `Tracked ${ride.commute.code}: ${latest.text}${arrival}${context}`, dryRun: false, delivery: { status: 'pending' } });
  state.events = state.events.slice(0, 500);
}

export function validTrackingNotice(state: AccountState, trackingId: string, eventAt: string, now: number) {
  const ride = state.tracking;
  const at = Date.parse(eventAt);
  return Boolean(state.settings.enabled && ride?.active && ride.id === trackingId && now < ride.expiresAt && now >= at && now - at <= 6 * MINUTE && ride.reports[0]?.at === at);
}
export function observeTracking(ride: TrackedRide, journey: JourneyResult, now: number, problem = '') {
  const plan = journey.plan;
  const fresh = Boolean(plan?.source === 'live' && plan.observedAt != null && now - plan.observedAt >= 0 && now - plan.observedAt <= 4 * MINUTE);
  const observedAt = fresh ? plan!.observedAt : null;
  const delay = fresh ? (plan!.expected - (plan!.scheduledDeparture ?? ride.trip.scheduledDeparture ?? ride.trip.departure)) / MINUTE : null;
  ride.journey = journey;
  ride.lastCheckedAt = now;
  ride.nextCheckAt = now + trackingInterval(ride.trip.leave, now);
  const newObservation = observedAt !== null && (ride.lastObservation === null || observedAt > ride.lastObservation);
  // Cache hits are not independent observations. Still expose the latest check time.
  if (newObservation || !fresh) {
    ride.samples.push({ checkedAt: now, observedAt, source: fresh ? 'live' : plan ? 'schedule' : 'unavailable', expected: plan?.expected ?? null, arrival: plan?.arrive ?? null, delay });
    ride.samples = ride.samples.slice(-120);
  }
  const issue = problem || (!fresh ? 'Live prediction unavailable. Scheduled times are estimates; a delay cannot be confirmed.' : '');
  if (issue && issue !== ride.lastProblem) report(ride, now, problem ? 'disruption' : 'unavailable', issue);
  ride.lastProblem = issue;
  if (!fresh || problem) { ride.delayStreak = 0; return false; }
  if (!newObservation) return false;
  const contiguous = ride.lastObservation !== null && observedAt! - ride.lastObservation <= 15 * MINUTE;
  ride.lastObservation = observedAt;
  ride.lastDelay = delay;
  if (delay! >= 2) {
    ride.delayStreak = contiguous ? ride.delayStreak + 1 : 1;
    if (ride.delayStreak >= 2 && (ride.reportedDelay === null || Math.abs(delay! - ride.reportedDelay) >= 1)) {
      report(ride, now, 'delay', `The bus is predicted ${Math.round(delay!)} minutes behind schedule. The delay persisted across fresh observations.${ride.reportedDelay !== null ? ` Previously ${Math.round(ride.reportedDelay)} minutes.` : ''}`);
      ride.reportedDelay = delay;
      return true;
    }
  } else {
    ride.delayStreak = 0;
    if (ride.reportedDelay !== null) {
      report(ride, now, 'recovered', 'The latest prediction is less than two minutes behind schedule. The previously reported delay has eased.');
      ride.reportedDelay = null;
      return true;
    }
  }
  return false;
}

export async function checkTrackedRide(state: AccountState, now: Date, deps: {
  catalog: () => Promise<any>; snapshot: (stop: string, options?: any) => Promise<any>; research: typeof checkCommuteResearch;
}) {
  const ride = state.tracking;
  if (!ride?.active) return;
  const at = +now;
  if (at >= ride.expiresAt) { ride.active = false; ride.endedReason = 'Tracking window ended. Actual arrival was not confirmed.'; return; }
  let journey: JourneyResult;
  let problem = '';
  try {
    const catalog = await deps.catalog();
    const scheduled = scheduledJourneys(catalog, ride.commute, ride.journey.day).find((trip: any) => trip.tripId === ride.trip.tripId && trip.serviceDay === ride.trip.serviceDay);
    if (!scheduled) throw Error('Tracked trip is no longer in the schedule.');
    let snapshot = null;
    try { snapshot = await deps.snapshot(ride.commute.stopId, { commute: ride.commute }); } catch { /* Labeled schedule fallback. */ }
    const assessed = assessTrip(scheduled, ride.commute, snapshot, at);
    // Passing the boarding stop is expected after the user has confirmed boarding.
    problem = assessed.blocked && !(ride.boarded && assessed.blocked === 'Bus has already passed your boarding stop') ? assessed.blocked : '';
    const leave = Math.min(ride.trip.leave, assessed.departure - (ride.profile.walk + (ride.commute.boardingMargin ?? 3)) * MINUTE);
    const plan = { ...ride.trip, ...assessed, leave, start: leave - ride.profile.ready * MINUTE, beAtStop: leave + ride.profile.walk * MINUTE, arrive: assessed.arrival + ride.profile.destinationWalk * MINUTE };
    ride.expiresAt = Math.min(ride.createdAt + 4 * 60 * MINUTE, Math.max(ride.expiresAt, plan.arrive + 30 * MINUTE));
    // Keep the original trip identity and conservative leave time; never hop to another bus silently.
    ride.trip = { ...ride.trip, leave, start: plan.start, beAtStop: plan.beAtStop };
    journey = { ...ride.journey, plan: problem ? null : plan, departures: problem ? [] : [plan], status: problem ? 'disrupted' : 'ready', reason: problem || (plan.source === 'live' ? 'Fresh provider prediction for your tracked trip.' : 'Schedule only. No fresh prediction for your tracked trip.'), notices: assessed.disruptions || [] };
  } catch {
    journey = { ...ride.journey, plan: null, departures: [], status: 'unavailable', reason: 'The tracked trip could not be checked. Try again when transit data is available.' };
  }
  const disruptionChanged = Boolean(problem && problem !== ride.lastProblem);
  const delayChanged = observeTracking(ride, journey, at, problem);
  const nearDeparture = at >= ride.trip.leave - 10 * MINUTE && !ride.departureResearchDone;
  const researchAge = at - ride.researchAttemptAt;
  // Explicitly refresh before departure, on a changed persistent delay, or every 30 minutes.
  // Never search repeatedly on every cached transit observation or retry an outage each minute.
  if (researchAge >= 10 * MINUTE && (nearDeparture || delayChanged || disruptionChanged || researchAge >= 30 * MINUTE)) {
    ride.researchAttemptAt = at;
    if (nearDeparture) ride.departureResearchDone = true;
    const researchState = { ...state, commute: ride.commute, profile: ride.profile, rides: [], settings: { ...state.settings, line: ride.commute.line, headsign: ride.commute.headsign } };
    try { ride.journey.research = await deps.research(researchState, journey.day, { start: ride.trip.leave, end: journey.plan?.arrive ?? ride.trip.arrive }, { force: true }); }
    catch { ride.journey.research = { status: 'unavailable', day: journey.day, checkedAt: null, sources: [], message: 'Exa research is temporarily unavailable. Transit tracking continues.' }; }
  }
}
