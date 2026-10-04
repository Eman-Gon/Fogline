import { useEffect, useMemo, useState } from 'react';
import { formatMiles, milesBetween, RouteMap, type MapStop, type MapVehicle } from './route-map';

export type RouteChoice = { lines: string[]; line: string; stopId: string; stopName: string; lat: number; lon: number };
type Line = { id: string; name: string; mode: string };
type Feed<T> = { items: T[]; error?: string; fetchedAt?: number | null };

const modes = [['metro', 'Metro'], ['bus', 'Bus'], ['cableway', 'Cable car']] as const;

export function readRoute(): RouteChoice | null {
  try {
    const value = JSON.parse(localStorage.getItem('fogline-route-v1') || 'null');
    if (!value || !Array.isArray(value.lines) || typeof value.line !== 'string' || typeof value.stopId !== 'string' || typeof value.stopName !== 'string' || !Number.isFinite(value.lat) || !Number.isFinite(value.lon)) return null;
    return value;
  } catch { return null; }
}

function pretty(name: string) {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : name;
}

async function loadFeed<T>(path: string): Promise<Feed<T>> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export function GetStarted({ onDone, onClose }: { onDone: (choice: RouteChoice) => void; onClose?: () => void }) {
  const [step, setStep] = useState<'start' | 'lines' | 'stop'>('start');
  const [lines, setLines] = useState<Line[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [stops, setStops] = useState<MapStop[]>([]);
  const [vehicles, setVehicles] = useState<MapVehicle[]>([]);
  const [stopQuery, setStopQuery] = useState('');
  const [selected, setSelected] = useState<MapStop | null>(null);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [locNote, setLocNote] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    if (step !== 'lines' || lines.length) return;
    setLoading('Loading Muni lines…'); setError('');
    loadFeed<Line>('/api/transit/lines').then((data) => { setLines(data.items); setError(data.error || ''); }).catch((e) => setError((e as Error).message)).finally(() => setLoading(''));
  }, [step, lines.length]);

  useEffect(() => {
    if (step !== 'stop' || !chosen.length) return;
    const linesQuery = chosen.map(encodeURIComponent).join(',');
    setLoading('Finding stops and buses…'); setError('');
    Promise.all([loadFeed<MapStop>(`/api/transit/stops?lines=${linesQuery}`), loadFeed<MapVehicle>(`/api/transit/vehicles?lines=${linesQuery}`)])
      .then(([stopFeed, vehicleFeed]) => { setStops(stopFeed.items); setVehicles(vehicleFeed.items); setCheckedAt(vehicleFeed.fetchedAt ?? Date.now()); setError(stopFeed.error || vehicleFeed.error || ''); })
      .catch((e) => setError((e as Error).message)).finally(() => setLoading(''));
  }, [step, chosen]);

  const visibleLines = lines.filter((line) => `${line.id} ${line.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const ranked = useMemo(() => stops.map((stop) => ({ stop, miles: here ? milesBetween(here, stop) : null })).sort((a, b) => (a.miles ?? 99) - (b.miles ?? 99) || a.stop.name.localeCompare(b.stop.name)), [stops, here]);
  const shownStops = stopQuery.trim() ? ranked.filter((item) => `${item.stop.name} ${item.stop.line}`.toLowerCase().includes(stopQuery.trim().toLowerCase())) : ranked.slice(0, here ? 8 : 12);
  const nearbyBuses = selected ? vehicles.map((vehicle) => ({ vehicle, miles: milesBetween(selected, vehicle) })).sort((a, b) => a.miles - b.miles).slice(0, 4) : [];
  const toggle = (id: string) => setChosen((current) => current.includes(id) ? current.filter((line) => line !== id) : current.length >= 4 ? current : [...current, id]);

  if (step === 'start') return <section className="start-screen"><p className="eyebrow">START HERE</p><h1>Let's get started.</h1><p>Pick the Muni lines you actually ride. Then choose the stop you walk to, and Fogline will show you where that bus is.</p><button className="primary" onClick={() => setStep('lines')}>Let's get started <span>→</span></button>{onClose && <button className="text-button" onClick={onClose}>Back to today</button>}</section>;

  if (step === 'lines') return <section className="start-screen"><p className="eyebrow">STEP 1 OF 2</p><h1>Which Muni do you take?</h1><p>Pick up to four lines. Search by number or name.</p><label className="search">Search lines<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="T, 14, Judah" /></label>{!!chosen.length && <div className="chips">{chosen.map((id) => <button key={id} className="chip" onClick={() => toggle(id)}>{id} <span>×</span></button>)}</div>}{error && <p role="alert">{error}</p>}{loading && <p className="muted">{loading}</p>}<div className="choice-list">{modes.map(([mode, label]) => {
    const group = visibleLines.filter((line) => line.mode === mode);
    if (!group.length) return null;
    return <div key={mode}><h2>{label}</h2>{group.map((line) => <button key={line.id} className={chosen.includes(line.id) ? 'choice selected' : 'choice'} aria-pressed={chosen.includes(line.id)} onClick={() => toggle(line.id)}><strong>{line.id}</strong><span>{pretty(line.name)}</span></button>)}</div>;
  })}</div><button className="primary" disabled={!chosen.length} onClick={() => setStep('stop')}>Show stops on {chosen.length === 1 ? 'this line' : 'these lines'} <span>→</span></button></section>;

  return <section className="start-screen"><p className="eyebrow">STEP 2 OF 2</p><h1>Choose your stop.</h1><p>{here ? 'Closest stops on your lines are first. Tap one, or tap it on the map.' : 'Share your location and the closest stops come first. Or search and tap a stop on the map.'}</p><div className="stop-tools"><button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((pos) => { setHere({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setLocNote(''); }, () => setLocNote('Location is off, so the full stop list is here instead.'))}>Use my location</button><label className="search">Search stops<input value={stopQuery} onChange={(e) => setStopQuery(e.target.value)} placeholder="Brannan, King, Church" /></label></div>{locNote && <p className="muted">{locNote}</p>}{error && <p role="alert">{error}</p>}{loading && <p className="muted">{loading}</p>}<RouteMap stops={stops} vehicles={vehicles} selectedId={selected?.id} fitKey={chosen.join(',')} onSelect={setSelected} /><p className="feed-meta">{stops.length ? `${stops.length} stops on ${chosen.join(', ')}.` : 'Stops will show here.'}{checkedAt ? ` Buses checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''} Positions are the latest 511 check, not a moving animation.</p><div className="choice-list">{shownStops.map(({ stop, miles }) => <button key={`${stop.line}-${stop.id}`} className={selected?.id === stop.id && selected.line === stop.line ? 'choice selected' : 'choice'} onClick={() => setSelected(stop)}><strong>{stop.line}</strong><span>{stop.name}{miles != null ? ` · ${miles.toFixed(1)} mi` : ''}</span></button>)}</div>{selected && <div className="nearby-buses"><h2>Where the {selected.line} is</h2>{nearbyBuses.length ? nearbyBuses.map(({ vehicle, miles }) => <p key={vehicle.vehicle || `${vehicle.lat}${vehicle.lon}`}>The {vehicle.line} to {vehicle.destination || 'its destination'} is {formatMiles(miles)}.</p>) : <p>No live bus on {chosen.join(', ')} was reported in the latest check.</p>}</div>}<button className="primary" disabled={!selected} onClick={() => selected && onDone({ lines: chosen, line: selected.line, stopId: selected.id, stopName: selected.name, lat: selected.lat, lon: selected.lon })}>Use {selected ? selected.name : 'this stop'} <span>✓</span></button><button className="text-button" onClick={() => setStep('lines')}>Back to lines</button></section>;
}

export function YourBus({ route, onChange }: { route: RouteChoice; onChange: () => void }) {
  const [vehicles, setVehicles] = useState<MapVehicle[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const stop = { id: route.stopId, line: route.line, name: route.stopName, lat: route.lat, lon: route.lon };
  useEffect(() => {
    loadFeed<MapVehicle>(`/api/transit/vehicles?lines=${route.lines.map(encodeURIComponent).join(',')}`)
      .then((data) => { setVehicles(data.items); setCheckedAt(data.fetchedAt ?? null); setError(data.error || ''); })
      .catch((e) => setError((e as Error).message));
  }, [route.lines]);
  const nearest = vehicles.map((vehicle) => ({ vehicle, miles: milesBetween(stop, vehicle) })).sort((a, b) => a.miles - b.miles).slice(0, 3);
  return <section className="your-bus"><div className="section-title"><h2>Where your bus is</h2><button className="text-button" onClick={onChange}>Change line or stop</button></div><p className="muted">{route.lines.join(', ')} · boarding at {route.stopName}</p>{error && <p role="alert">{error}</p>}<RouteMap stops={[stop]} vehicles={vehicles} selectedId={stop.id} fitKey={route.lines.join(',')} /><div className="nearby-buses">{nearest.length ? nearest.map(({ vehicle, miles }) => <p key={vehicle.vehicle || `${vehicle.lat}${vehicle.lon}`}>The {vehicle.line} to {vehicle.destination || 'its destination'} is {formatMiles(miles)}.</p>) : <p>No live bus on your lines was in the latest check.</p>}</div><p className="feed-meta">{checkedAt ? `Checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ` : ''}The arrow points the way that bus is heading. This is the last 511 position, not a live animation.</p></section>;
}
