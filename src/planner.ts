export type Profile = { destination: string; arriveBy: number; ready: number; walk: number; ride: number; destinationWalk: number; stopCode: string };
export const defaults: Profile = { destination: 'Design studio', arriveBy: 540, ready: 35, walk: 6, ride: 30, destinationWalk: 5, stopCode: '' };
// Demo-only schedule and residual delays, not real Muni predictions.
export const history = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 9, 13];
export const schedule = Array.from({ length: 19 }, (_, i) => 390 + i * 8);
export function plan(profile: Profile, delay = 0, now = 0) {
  const buffer = [...history].sort((a,b) => a-b)[Math.ceil(history.length * .8) - 1];
  const trip = [...schedule].reverse().find(t => t - profile.walk - profile.ready >= now && t + delay + profile.ride + profile.destinationWalk + buffer <= profile.arriveBy);
  if (trip === undefined) return null;
  const leave = trip - profile.walk;
  const arrive = trip + delay + profile.ride + profile.destinationWalk;
  const odds = Math.round(history.filter(d => arrive + d <= profile.arriveBy).length / history.length * 100);
  return { trip, leave, start: leave - profile.ready, arrive, odds, buffer };
}
export function learn(old: number, measured: number) {
  if (!Number.isFinite(measured) || measured < 5 || measured > 180) throw new Error('Getting-ready time must be between 5 and 180 minutes.');
  return Math.round((old * 3 + measured) / 4);
}
export function time(minutes: number) {
  const m = Math.round(minutes); const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`;
}
export function clockInput(minutes: number) { return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`; }
export function formatTypedClock(minutes: number) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(m / 60);
  return `${hour % 12 || 12}:${String(m % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
export function parseTypedClock(text: string) {
  const match = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, ':').match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = match[3] === 'am' ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}
