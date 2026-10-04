// @ts-expect-error JavaScript reminder policy.
import { validCommuteNotice } from './commute-reminders.mjs';
import type { AccountState } from '../src/agent-types.ts';
import { tracksSavedCommute, validTrackingNotice } from './tracking';

export class NotificationError extends Error {}
export function notificationConfig() {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return null;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(topic)) throw new NotificationError('NTFY_TOPIC must contain only letters, numbers, underscores or hyphens.');
  let server: URL;
  try { server = new URL(process.env.NTFY_SERVER || 'https://ntfy.sh'); }
  catch { throw new NotificationError('NTFY_SERVER must be a valid HTTPS URL.'); }
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) throw new NotificationError('NTFY_SERVER must be an HTTPS URL without credentials, query or fragment.');
  return { url: `${server.href.replace(/\/$/, '')}/${topic}`, topic, server: server.href.replace(/\/$/, '') };
}
export function notificationStatus() {
  try { const config = notificationConfig(); return { configured: Boolean(config), ...config, error: null }; }
  catch (error) { return { configured: false, error: (error as Error).message }; }
}
export async function publishNotification(message: string, request = fetch) {
  const config = notificationConfig();
  if (!config) throw new NotificationError('Set NTFY_TOPIC on the server first.');
  const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8', Title: 'Fogline morning', Priority: 'default', Tags: 'sunrise' };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  try {
    const response = await request(config.url, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new NotificationError(`ntfy returned HTTP ${response.status}. Check the topic and server credentials.`);
    const result = await response.json();
    if (typeof result.id !== 'string' || result.event !== 'message') throw new NotificationError('ntfy returned an unexpected response. Delivery is uncertain.');
    return result.id as string;
  } catch (error) {
    if (error instanceof NotificationError) throw error;
    throw new NotificationError('ntfy could not confirm delivery. Check your phone before sending another notification.');
  }
}

// Claim and persist before sending. Never automatically replay an uncertain send after restart.
export async function deliverPendingPush(state: AccountState, now: Date, save: () => Promise<void>, publish = publishNotification) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`, minute = Number(parts.hour) * 60 + Number(parts.minute);
  const ride = state.rides.find(r => r.date === date);
  for (const event of state.events.filter(e => e.kind === 'push' && e.delivery?.status === 'pending')) {
    const invalid = event.trackingId
      ? !validTrackingNotice(state, event.trackingId, event.at, +now)
      : tracksSavedCommute(state, +now) || !state.settings.enabled || !(state.commute?.days ?? [1,2,3,4,5]).includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)) || (event.noticeKind?!validCommuteNotice(event,state,ride,date,now):event.id !== `${date}:push`) || minute < state.settings.wakeStart || minute >= state.settings.wakeEnd || (!event.noticeKind&&(ride?.acknowledged || ride?.started));
    if (invalid) {
      event.delivery = { status: 'cancelled' }; await save(); continue;
    }
    event.delivery = { status: 'sending' }; await save();
    try {
      const providerId = await publish(event.text);
      event.dryRun = false;
      event.delivery = { status: 'sent', at: now.toISOString(), providerId };
    } catch (error) {
      event.delivery = { status: 'failed', error: error instanceof NotificationError ? error.message : 'Notification delivery could not be confirmed.' };
    }
    await save();
  }
}
