export const TRANSIT_TTL = 10 * 60 * 1000;

// All callers share a bounded cache and upstream budget, including the scheduler.
export function createTransitCache({ ttl = TRANSIT_TTL, maxEntries = 128, maxPending = 8, maxLoads = 55, budgetWindow = 3600000, now = Date.now } = {}) {
  const entries = new Map();
  let starts = [];
  let active = 0;
  const unavailable = (entry, message) => entry?.value
    ? { ...entry.value, fetchedAt: entry.fetchedAt, stale: true, error: message }
    : { items: [], fetchedAt: null, stale: false, error: message };

  return async function cached(name, load, options = {}) {
    const time = now();
    const lifetime = options.ttl ?? ttl;
    const old = entries.get(name);
    if (old) { entries.delete(name); entries.set(name, old); }
    if (old?.pending) return old.pending;
    if (old?.value && time - old.fetchedAt < lifetime) return { ...old.value, fetchedAt: old.fetchedAt, stale: false };
    if (old?.retryAt > time) return unavailable(old, old.error);
    starts = starts.filter(start => time - start < budgetWindow);
    if (active >= maxPending || starts.length >= maxLoads) return unavailable(old, 'Transit request limit reached. Try again later.');
    if (!old && entries.size >= maxEntries) {
      const evict = [...entries].find(([, entry]) => !entry.pending);
      if (!evict) return unavailable(old, 'Transit cache is busy. Try again later.');
      entries.delete(evict[0]);
    }
    const entry = old || {};
    entries.set(name, entry);
    starts.push(time);
    active++;
    // Defer load until pending is assigned, including for synchronous failures.
    entry.pending = Promise.resolve().then(load).then(value => {
      entry.value = value;
      entry.fetchedAt = now();
      delete entry.retryAt;
      delete entry.error;
      return { ...value, fetchedAt: entry.fetchedAt, stale: false };
    }).catch(error => {
      entry.retryAt = now() + (options.retryAfter ?? lifetime);
      entry.error = error instanceof Error ? error.message : 'Transit feed unavailable.';
      return unavailable(entry, entry.error);
    }).finally(() => { delete entry.pending; active--; });
    return entry.pending;
  };
}
