import type { Pattern, PatternStop } from './commute-types';

export function directionChoices(patterns: Pattern[]) {
  return [...new Map(patterns.map(p => [p.direction, {id:p.direction, label:p.label}])).values()]
    .sort((a,b) => a.label.localeCompare(b.label));
}

function alongTheRoute(patterns: Pattern[], stops: PatternStop[]) {
  const byId = new Map(stops.map(s => [s.id, s]));
  const ordered: PatternStop[] = [];
  const seen = new Set<string>();
  const routes = [...patterns].sort((a,b) => b.stops.length - a.stops.length || a.id.localeCompare(b.id));
  for (const pattern of routes) pattern.stops.forEach((stop, i) => {
    if (seen.has(stop.id) || !byId.has(stop.id)) return;
    const later = pattern.stops.slice(i + 1).find(next => seen.has(next.id));
    ordered.splice(later ? ordered.findIndex(s => s.id === later.id) : ordered.length, 0, byId.get(stop.id)!);
    seen.add(stop.id);
  });
  return ordered;
}

export function boardingStops(patterns: Pattern[]) {
  const stops = new Map<string, PatternStop>();
  for (const p of patterns) p.stops.forEach((s,i) => {
    if (s.pickup !== '1' && p.stops.slice(i+1).some(next=>next.dropoff!=='1')) stops.set(s.id,s);
  });
  return alongTheRoute(patterns, [...stops.values()]);
}

export function getOffStops(patterns: Pattern[], boardingId: string) {
  const stops = new Map<string, PatternStop>();
  for (const p of patterns) p.stops.forEach((s,i) => {
    if (s.id===boardingId && s.pickup!=='1') {
      for (const next of p.stops.slice(i+1)) if(next.dropoff!=='1' && next.id!==boardingId) stops.set(next.id,next);
    }
  });
  return alongTheRoute(patterns, [...stops.values()]);
}

export function stopPair(patterns: Pattern[], boardingId: string, getOffId: string, preferredId = '') {
  const ordered=[...patterns].sort((a,b)=>Number(b.id===preferredId)-Number(a.id===preferredId));
  for (const pattern of ordered) {
    for (let board=0;board<pattern.stops.length;board++) {
      if(pattern.stops[board].id!==boardingId || pattern.stops[board].pickup==='1') continue;
      const alight=pattern.stops.findIndex((s,i)=>i>board&&s.id===getOffId&&s.dropoff!=='1');
      if(alight>board) return {pattern,board,alight};
    }
  }
  return null;
}

export function directionPatterns(patterns: Pattern[], direction: string) {
  return patterns.filter(p => p.direction === direction).sort((a,b) => b.stops.length-a.stops.length || a.id.localeCompare(b.id));
}
