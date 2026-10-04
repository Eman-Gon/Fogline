const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const LIVE_LEAD_MS = 10 * 60 * 1000;
export const LIVE_AFTER_MS = 20 * 60 * 1000;
export const LIVE_GAP_MS = 3 * 60 * 1000;
export const COLLECT_GAP_MS = 10 * 60 * 1000;

export function weekdayIndex(clock) {
  return WEEKDAYS.indexOf(clock.weekday);
}
function rideFor(state, clock) {
  return state.rides?.find(ride => ride.date === clock.date);
}
// Saved Muni route only: one plan at wake, then live 511 checks near departure.
export function agentMoment(state, now, clock) {
  if (!state.settings?.enabled || !state.commute) return null;
  if (!state.commute.days?.includes(weekdayIndex(clock))) return null;
  if (clock.minute < state.settings.wakeStart || clock.minute >= state.settings.wakeEnd) return null;
  const ride = rideFor(state, clock);
  if (ride?.skipped || ride?.arrived || ride?.boarded) return null;
  const leave = state.briefing?.journey?.plan?.leave;
  const at = +now;
  if (Number.isFinite(leave) && at >= leave - LIVE_LEAD_MS && at < leave + LIVE_AFTER_MS) {
    if (!ride?.liveRanAt || at - ride.liveRanAt >= LIVE_GAP_MS) return 'live';
    return null;
  }
  if (ride?.wakeRan === clock.date) return null;
  return 'wake';
}
export function sampleDue(state, clock) {
  if (state.commute || !state.settings?.enabled) return false;
  if (![1, 2, 3, 4, 5].includes(weekdayIndex(clock))) return false;
  if (clock.minute < state.settings.wakeStart || clock.minute >= state.settings.wakeEnd) return false;
  const ride = rideFor(state, clock);
  return ride?.wakeRan !== clock.date && !ride?.acknowledged && !ride?.started;
}
export function collectDue(state, now, clock) {
  if (state.settings?.enabled || !state.commute || !state.profile) return false;
  if (!state.commute.days?.includes(weekdayIndex(clock))) return false;
  const start = Math.max(0, state.profile.arriveBy - state.profile.ready - 180);
  if (clock.minute < start || clock.minute >= state.profile.arriveBy) return false;
  const ride = rideFor(state, clock);
  return !ride?.collectRanAt || +now - ride.collectRanAt >= COLLECT_GAP_MS;
}
export function schedulerDue(state, now, clock) {
  return agentMoment(state, now, clock) || (sampleDue(state, clock) ? 'wake' : null) || (collectDue(state, now, clock) ? 'collect' : null);
}
