import { useEffect, useRef } from 'react';

export type MapStop = { id: string; line: string; name: string; lat: number; lon: number };
export type MapVehicle = { line: string; destination: string; lat: number; lon: number; bearing: number | null; vehicle: string };

declare global {
  interface Window { L?: any }
}

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatMiles(miles: number) {
  if (miles < 0.1) return 'under 0.1 mi from this stop';
  return `${miles.toFixed(1)} mi from this stop`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function focusPoints(stops: MapStop[], here: { lat: number; lon: number } | null) {
  if (!here) return stops.map((stop) => [stop.lat, stop.lon]);
  const nearby = [...stops].sort((a, b) => milesBetween(here, a) - milesBetween(here, b)).slice(0, 6);
  return [[here.lat, here.lon], ...nearby.map((stop) => [stop.lat, stop.lon])];
}

export function RouteMap({ stops, vehicles, selectedId, fitKey, onSelect, shape = [], here = null }: { stops: MapStop[]; vehicles: MapVehicle[]; shape?: number[][]; selectedId?: string; fitKey: string; onSelect?: (stop: MapStop) => void; here?: { lat: number; lon: number } | null }) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const latestStops = useRef(stops); latestStops.current = stops;
  const latestHere = useRef(here); latestHere.current = here;
  const fitted = useRef('');
  const lastSelected = useRef('');

  useEffect(() => {
    const L = window.L;
    if (!node.current || !L || mapRef.current) return;
    const map = L.map(node.current, { zoomControl: true }).setView([37.76, -122.44], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => {
      if (!node.current?.clientHeight || !node.current?.clientWidth) return;
      map.invalidateSize();
      const points = focusPoints(latestStops.current, latestHere.current);
      if (points.length > 1) map.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
    });
    observer.observe(node.current);
    const frame = window.requestAnimationFrame(() => map.invalidateSize());
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); map.remove(); mapRef.current = null; groupRef.current = null; };
  }, []);

  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    groupRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    if (shape.length) L.polyline(shape, { color: '#c54a24', weight: 4, opacity: .8 }).addTo(group);
    for (const stop of stops) {
      const selected = stop.id === selectedId;
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: selected ? 9 : 5,
        color: '#142b34',
        weight: 2,
        fillColor: selected ? '#ff9168' : '#142b34',
        fillOpacity: 1,
      });
      marker.bindTooltip(`${stop.line} · ${stop.name}`, { direction: 'top' });
      if (onSelect) marker.on('click', () => onSelect(stop));
      marker.addTo(group);
    }
    if (here) {
      const icon = L.divIcon({
        className: 'you-marker',
        html: '<span>You</span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      L.circle([here.lat, here.lon], { radius: 28, color: '#1d4e89', weight: 1, fillColor: '#1d4e89', fillOpacity: 0.15 }).addTo(group);
      L.marker([here.lat, here.lon], { icon, zIndexOffset: 800 }).bindTooltip('You are here', { direction: 'top' }).addTo(group);
    }
    for (const vehicle of vehicles) {
      const arrow = vehicle.bearing == null ? '' : `<i style="transform:rotate(${vehicle.bearing}deg)">▲</i>`;
      const icon = L.divIcon({
        className: 'bus-marker',
        html: `${arrow}<b>${escapeHtml(vehicle.line)}</b>`,
        iconSize: [46, 22],
        iconAnchor: [23, 11],
      });
      L.marker([vehicle.lat, vehicle.lon], { icon, zIndexOffset: 500 })
        .bindTooltip(`${vehicle.line} to ${vehicle.destination || 'its destination'}`, { direction: 'top' })
        .addTo(group);
    }
    map.invalidateSize();
    if (fitted.current !== fitKey && (stops.length || here)) {
      const bounds = focusPoints(stops, here);
      if (bounds.length === 1) map.setView(bounds[0], 16);
      else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
      fitted.current = fitKey;
    }
    const selected = stops.find((stop) => stop.id === selectedId);
    if (selected && lastSelected.current !== selectedId) { map.panTo([selected.lat, selected.lon]); lastSelected.current = selectedId || ''; }
  }, [stops, vehicles, selectedId, fitKey, onSelect, shape, here]);

  if (!window.L) return <p role="alert">The map couldn't load. You can still pick a stop from the list.</p>;
  return <div ref={node} className="route-map" role="application" aria-label="Map of your Muni stops and buses" />;
}
