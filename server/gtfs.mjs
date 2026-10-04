import { fetch511 } from './transit-source.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';

// A quoted-field CSV reader; the large stop_times table is consumed row by row.
export function* csv(text) {
  let row = [], field = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(field.replace(/\r$/, '')); field = ''; if (c === '\n') { yield row; row = []; } }
    else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); yield row; }
}
const seconds = value => { const p = value.split(':').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p[0] * 3600 + p[1] * 60 + p[2] : NaN; };
export function parseGtfs(bytes) {
  const files = unzipSync(bytes, { filter: f => /(^|\/)(routes|stops|trips|stop_times|calendar|calendar_dates|directions|shapes|feed_info)\.txt$/.test(f.name) });
  function* records(name) {
    const key = Object.keys(files).find(k => k === name || k.endsWith('/' + name));
    if (!key) return;
    const rows = csv(strFromU8(files[key])); delete files[key];
    const headers = rows.next().value;
    for (const values of rows) if (values.length > 1) yield Object.fromEntries(headers.map((h, i) => [h, values[i] || '']));
  }
  const info = [...records('feed_info.txt')][0] || {};
  const stops = Object.fromEntries([...records('stops.txt')].map(s => [s.stop_id, { id: s.stop_id, code: s.stop_code || s.stop_id, name: s.stop_name,
    lat: s.stop_lat && Math.abs(Number(s.stop_lat)) <= 90 ? Number(s.stop_lat) : null,
    lon: s.stop_lon && Math.abs(Number(s.stop_lon)) <= 180 ? Number(s.stop_lon) : null, accessibility: s.wheelchair_boarding || '0' }]));
  const routes = Object.fromEntries([...records('routes.txt')].map(r => [r.route_id, { id: r.route_id, code: r.route_short_name || r.route_id, name: r.route_long_name,
    mode: r.route_type === '3' ? 'Bus' : r.route_type === '5' ? 'Cable car' : 'Rail', description: r.route_desc, patterns: [], trips: [] }]));
  const directions = Object.fromEntries([...records('directions.txt')].map(d => [`${d.route_id}:${d.direction_id}`, d.direction]));
  const trips = Object.fromEntries([...records('trips.txt')].map(t => [t.trip_id, { id: t.trip_id, route: t.route_id, service: t.service_id, direction: t.direction_id, headsign: t.trip_headsign, shape: t.shape_id, calls: [] }]));
  for (const c of records('stop_times.txt')) {
    const t = trips[c.trip_id]; if (!t || !stops[c.stop_id]) continue;
    const a = seconds(c.arrival_time), d = seconds(c.departure_time);
    t.calls.push([Number(c.stop_sequence), c.stop_id, a, d, c.pickup_type || '0', c.drop_off_type || '0']);
  }
  const shapes = {};
  for (const s of records('shapes.txt')) (shapes[s.shape_id] ||= []).push([Number(s.shape_pt_sequence), Number(s.shape_pt_lat), Number(s.shape_pt_lon)]);
  for (const key of Object.keys(shapes)) shapes[key] = shapes[key].sort((a,b)=>a[0]-b[0]).map(p=>p.slice(1));
  const patterns = {};
  for (const t of Object.values(trips)) {
    if (!routes[t.route] || t.calls.length < 2) continue;
    t.calls.sort((a,b)=>a[0]-b[0]);
    const stopIds = t.calls.map(c=>c[1]);
    const signature = JSON.stringify([t.route,t.direction,t.headsign,t.shape,t.calls.map(c=>[c[1],c[4],c[5]])]);
    const id = createHash('sha1').update(signature).digest('hex').slice(0,20);
    if (!patterns[id]) {
      patterns[id] = { id, line: t.route, direction: t.direction, label: directions[`${t.route}:${t.direction}`] || 'Direction', headsign: t.headsign, stopIds,
        pickup: t.calls.map(c=>c[4]), dropoff: t.calls.map(c=>c[5]), shape: shapes[t.shape] || [] };
      routes[t.route].patterns.push(id);
    }
    routes[t.route].trips.push({ id: t.id, service: t.service, pattern: id, sequences: t.calls.map(c=>c[0]), arrivals: t.calls.map(c=>Number.isFinite(c[2])?c[2]:null), departures: t.calls.map(c=>Number.isFinite(c[3])?c[3]:null) });
  }
  const calendar = [...records('calendar.txt')];
  const exceptions = [...records('calendar_dates.txt')];
  if (!Object.keys(routes).length || !Object.keys(patterns).length || !calendar.length && !exceptions.length) throw Error('Schedule feed is incomplete.');
  return { version: info.feed_version || 'unknown', start: info.feed_start_date, end: info.feed_end_date, routes, stops, patterns, calendar, exceptions };
}

if (!isMainThread && workerData?.gtfs) {
  try { parentPort.postMessage({ data: parseGtfs(new Uint8Array(await readFile(workerData.gtfs))) }); }
  catch { parentPort.postMessage({ error: 'The schedule feed could not be read.' }); }
}
let loaded, job, checked = 0, error = '';
const path = resolve('data/transit/sf.zip');
function readWorker(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { gtfs: file }, execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')) });
    worker.once('message', m => m.error ? reject(Error(m.error)) : resolve(m.data));
    worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(Error('Schedule import stopped.')); });
  });
}
export async function getCatalog() {
  if (loaded && Date.now() - checked < 24*3600000) return { ...loaded, error };
  if (job) return job;
  job = (async () => {
    try {
      let age = Infinity; try { age = Date.now() - (await stat(path)).mtimeMs; } catch {}
      if (age >= 24*3600000) {
        if (!process.env.SF511_API_KEY) throw Error('511 is not configured.');
        const bytes = await fetch511('datafeeds',{operator_id:'SF'},'binary');
        if (bytes.length > 40_000_000) throw Error('Schedule download exceeds the supported size.');
        await mkdir(resolve('data/transit'), { recursive: true });
        const temp = `${path}.next`; await writeFile(temp, bytes);
        const next = await readWorker(temp); // validate before replacing the last usable archive
        await rename(temp, path); loaded = next;
      } else if (!loaded) loaded = await readWorker(path);
      error = ''; checked = Date.now();
    } catch (e) {
      error = e.message || 'Schedule unavailable.';
      if (!loaded) { try { loaded = await readWorker(path); } catch { throw Error(error); } }
      checked = Date.now() - 23*3600000; // retry after one hour, retaining the validated archive
    }
    return { ...loaded, error };
  })().finally(()=>{ job = null; });
  return job;
}
