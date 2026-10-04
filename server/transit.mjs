import { getRealtimeSnapshot } from './realtime.mjs';
import { journeyHandler } from './journey.mjs';
import { createTransitCache, TRANSIT_TTL } from './transit-cache.mjs';

import { fetch511 } from './transit-source.mjs';
const cached = createTransitCache();
const TTL = TRANSIT_TTL;
const get511 = (path, params) => fetch511(path, params);

function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function text(value) { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }

function serviceDelivery(payload) {
  const root = payload?.Siri ?? payload?.siri ?? payload;
  return root?.ServiceDelivery ?? root?.serviceDelivery ?? root;
}

export function readArrivals(payload) {
  const delivery = serviceDelivery(payload)?.StopMonitoringDelivery ?? payload?.StopMonitoringDelivery;
  const visits = asArray(delivery?.MonitoredStopVisit);
  return visits.map((visit) => {
    const journey = visit?.MonitoredVehicleJourney ?? {};
    const call = journey?.MonitoredCall ?? {};
    return {
      line: text(journey.LineRef || journey.PublishedLineName || journey.LineName) || 'Muni',
      destination: text(journey.DestinationName),
      tripId: text(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || journey.DatedVehicleJourneyRef),
      direction: text(journey.DirectionRef),
      recordedAt: text(visit?.RecordedAtTime),
      aimed: text(call.AimedArrivalTime || call.AimedDepartureTime),
      expected: text(call.ExpectedArrivalTime || call.ExpectedDepartureTime),
      stop: text(call.StopPointName),
      vehicle: text(journey.VehicleRef),
      status: text(call.ArrivalStatus || call.DepartureStatus),
    };
  }).filter((item) => item.aimed || item.expected || item.destination);
}

export function readAlerts(payload) {
  const entities = asArray(payload?.Entities ?? payload?.entity);
  return entities.flatMap((entity) => {
    const alert = entity?.Alert ?? entity?.alert;
    if (!alert) return [];
    const translated = (value) => asArray(value?.Translations ?? value?.translation ?? value).map((x) => text(x?.Text ?? x?.text ?? x)).filter(Boolean).join(' ');
    const effect = text(alert.effect ?? alert.Effect);
    const header = translated(alert.header_text ?? alert.HeaderText);
    const description = translated(alert.description_text ?? alert.DescriptionText);
    const routeRefs = asArray(alert.InformedEntities ?? alert.informed_entity ?? alert.InformedEntity).map((x) => text(x.RouteId ?? x.route_id ?? x.LineRef)).filter(Boolean);
    return [{ header: header || 'Muni service alert', description, effect, routes: routeRefs, cause: text(alert.cause ?? alert.Cause) }];
  });
}

export function readLines(payload) {
  const list = Array.isArray(payload) ? payload : asArray(payload?.Route ?? payload?.lines);
  return list.map((line) => ({
    id: text(line.PublicCode || line.Id),
    name: text(line.Name),
    mode: text(line.TransportMode) || 'bus',
  })).filter((line) => line.id);
}

export function readStops(payload) {
  const points = asArray(payload?.Contents?.dataObjects?.ScheduledStopPoint ?? payload?.ScheduledStopPoint);
  return points.map((stop) => ({
    id: text(stop.id),
    name: text(stop.Name),
    lat: Number(stop.Location?.Latitude),
    lon: Number(stop.Location?.Longitude),
  })).filter((stop) => stop.id && Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
}

export function readVehicles(payload) {
  const activities = asArray(serviceDelivery(payload)?.VehicleMonitoringDelivery?.VehicleActivity);
  return activities.map((activity) => {
    const journey = activity?.MonitoredVehicleJourney ?? {};
    const location = journey.VehicleLocation ?? {};
    const bearing = Number(journey.Bearing);
    return {
      line: text(journey.LineRef || journey.PublishedLineName),
      destination: text(journey.DestinationName),
      tripId: text(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || journey.DatedVehicleJourneyRef),
      direction: text(journey.DirectionRef),
      recordedAt: text(activity.RecordedAtTime),
      lat: Number(location.Latitude),
      lon: Number(location.Longitude),
      bearing: Number.isFinite(bearing) ? bearing : null,
      vehicle: text(journey.VehicleRef),
    };
  }).filter((vehicle) => vehicle.line && Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon));
}

export function readSchedule(payload) {
  const delivery = serviceDelivery(payload)?.StopTimetableDelivery ?? payload?.StopTimetableDelivery ?? payload;
  const journeys = asArray(delivery?.TimetabledStopVisit ?? payload?.TimetabledStopVisit);
  return journeys.map((entry) => {
    const journey = entry?.TargetedVehicleJourney ?? entry?.Journey ?? entry?.TimetabledVehicleJourney ?? {};
    const call = journey?.TargetedCall ?? entry?.MonitoredCall ?? journey?.MonitoredCall ?? {};
    return {
      line: text(journey.LineRef || journey.PublishedLineName) || 'Muni',
      destination: text(journey.DestinationName),
      aimed: text(call.AimedDepartureTime || call.AimedArrivalTime || entry?.AimedDepartureTime),
    };
  }).filter((item) => item.aimed);
}

export async function listLines() {
  return cached('lines', async () => ({ items: readLines(await get511('lines', { operator_id: 'SF', format: 'json' })) }));
}

export async function listStops(lines) {
  const batches = await Promise.all(lines.map(async (line) => {
    const data = await cached(`stops:${line}`, async () => ({ items: readStops(await get511('stops', { operator_id: 'SF', line_id: line, format: 'json' })) }));
    return { ...data, items: data.items.map((stop) => ({ ...stop, line })) };
  }));
  const error = batches.map((batch) => batch.error).filter(Boolean).join(' ');
  return { items: batches.flatMap((batch) => batch.items), fetchedAt: batches.find((batch) => batch.fetchedAt)?.fetchedAt ?? null, stale: batches.some((batch) => batch.stale), ...(error ? { error } : {}) };
}

export async function listVehicles(lines) {
  const all = await cached('vehicles', async () => ({ items: readVehicles(await get511('VehicleMonitoring', { agency: 'SF', format: 'json' })) }));
  const want = new Set(lines);
  return { ...all, items: want.size ? all.items.filter((vehicle) => want.has(vehicle.line)) : [] };
}

export async function getTransitSnapshot(stopCode = '', options = {}) {
  if(options.commute) return {realtime:await getRealtimeSnapshot()};
  const stop = String(stopCode).trim();
  if (stop && !/^\d{1,10}$/.test(stop)) throw new Error('Use a numeric 511 stop code of up to 10 digits.');
  const jobs = [
    cached('alerts', async () => ({ items: readAlerts(await get511('servicealerts', { agency: 'SF', format: 'json' })) })),
    stop ? cached(`arrivals:${stop}`, async () => ({ items: readArrivals(await get511('StopMonitoring', { agency: 'SF', stopcode: stop, format: 'json' })) })) : Promise.resolve({ items: [], fetchedAt: null, stale: false, error: 'Add the numeric 511 stop code in Setup to load arrivals.' }),
    stop ? cached(`schedule:${stop}`, async () => ({ items: readSchedule(await get511('stoptimetable', { operatorref: 'SF', monitoringref: stop, format: 'json' })) })) : Promise.resolve({ items: [], fetchedAt: null, stale: false, error: 'Add the numeric 511 stop code in Setup to load scheduled departures.' }),
  ];
  const [alerts, arrivals, schedule] = await Promise.all(jobs);
  if (!schedule.items.length && arrivals.items.some((item) => item.aimed)) {
    schedule.items = arrivals.items.filter((item) => item.aimed).map(({ line, destination, aimed }) => ({ line, destination, aimed }));
    schedule.note = 'Scheduled times shown from the stop-monitoring response.';
    schedule.stale = arrivals.stale;
  }
  return { source: '511 SF Bay', fetchedAt: new Date().toISOString(), alerts, arrivals, schedule, cacheTtlSeconds: TTL / 1000 };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function lineQuery(url) {
  const lines = [...new Set((url.searchParams.get('lines') || '').split(',').map((line) => line.trim()).filter(Boolean))];
  return lines.length <= 4 && lines.every(line => /^[A-Za-z0-9_-]{1,16}$/.test(line)) ? lines : null;
}

export function transitHandler(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { sendJson(res, 400, { error: 'Invalid URL' }); return true; }
  if (!url.pathname.startsWith('/api/transit')) return false;
  if (!['/api/transit', '/api/transit/lines', '/api/transit/stops', '/api/transit/vehicles', '/api/transit/catalog', '/api/transit/patterns'].includes(url.pathname)) { sendJson(res, 404, { error: 'Not found' }); return true; }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }
  if (['/api/transit/catalog', '/api/transit/patterns'].includes(url.pathname)) { journeyHandler(url).then(data => sendJson(res, 200, data)).catch(e => sendJson(res, 503, { error: e.message })); return true; }
  const fail = () => sendJson(res, 502, { error: 'Transit feed unavailable.' });
  if (url.pathname === '/api/transit/lines') { listLines().then((data) => sendJson(res, 200, data)).catch(fail); return true; }
  if (url.pathname === '/api/transit/stops') {
    const lines = lineQuery(url);
    if (!lines?.length) { sendJson(res, 400, { error: 'Pick one to four valid lines.' }); return true; }
    listStops(lines).then((data) => sendJson(res, 200, data)).catch(fail);
    return true;
  }
  if (url.pathname === '/api/transit/vehicles') {
    const lines = lineQuery(url);
    if (!lines?.length) { sendJson(res, 400, { error: 'Pick one to four valid lines.' }); return true; }
    listVehicles(lines).then((data) => sendJson(res, 200, data)).catch(fail); return true;
  }
  const stop = (url.searchParams.get('stopCode') || '').trim();
  if (stop && !/^\d{1,10}$/.test(stop)) { sendJson(res, 400, { error: 'Use a numeric 511 stop code of up to 10 digits.' }); return true; }
  getTransitSnapshot(stop).then((data) => sendJson(res, 200, data)).catch(fail);
  return true;
}
