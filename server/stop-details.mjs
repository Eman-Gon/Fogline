import { readFileSync } from 'node:fs';

// DataSF i28k-bkz6, downloaded 2026-10-04. Keep unknown shelter values null.
const details = JSON.parse(readFileSync(new URL('./stop-data/muni-stops.json', import.meta.url), 'utf8'));
export function stopDetails(stop, source = details) {
  // The snapshot uses four-digit scheduling IDs; GTFS uses public IDs.
  // Treat the offset only as a candidate, and require coordinate agreement.
  if (!/^1\d{4}$/.test(stop.id) || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return null;
  const candidate = source[String(Number(stop.id) - 10000)];
  if (!candidate) return null;
  const metres = Math.hypot((stop.lat-candidate.lat)*111320, (stop.lon-candidate.lon)*111320*Math.cos(stop.lat*Math.PI/180));
  return metres <= 25 ? candidate : null;
}
