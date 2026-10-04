"""Build a standalone searchable map from the unchanged DataSF CSV."""
import csv
import html
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
rows = list(csv.DictReader((directory / "muni-stops.csv").open()))
stops = []
for row in rows:
    lat, lon = float(row["LATITUDE"]), float(row["LONGITUDE"])
    assert 37 < lat < 39 and -123 < lon < -121, row["STOPID"]
    stops.append([row["STOPID"], row["STOPNAME"], lat, lon, row["SHELTER"]])
assert len({stop[0] for stop in stops}) == len(rows)
page = '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Muni stop explorer</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
*{box-sizing:border-box}body{margin:0;font:16px system-ui;color:#183b39;background:#f4f7f5}header{padding:20px 24px}h1{margin:0 0 8px;font-size:26px}p{margin:8px 0;font-size:14px}input,select{padding:10px;border:1px solid #789591;border-radius:6px;background:white;font:inherit;max-width:100%}input{width:340px}#map{height:calc(100vh - 220px);min-height:420px}a{color:#126e65}.controls{display:flex;gap:10px;flex-wrap:wrap}#status{font-weight:600}
</style>
<header><h1>Muni stop explorer</h1>
<p>DataSF snapshot • Records as of April 8, 2026 • Downloaded October 4, 2026</p>
<div class="controls"><input id="search" aria-label="Search stops" placeholder="Search stop name or ID"><select id="shelter" aria-label="Shelter filter"><option value="all">All shelter values</option><option value="1">Shelter recorded (1)</option><option value="0">No shelter recorded (0)</option><option value="">Shelter unknown (blank)</option></select><button id="fit">Fit matching stops</button></div>
<p id="status" aria-live="polite"></p><p><a href="https://data.sf.gov/Transportation/Muni-Stops/i28k-bkz6">DataSF source</a> · <a href="muni-stops.csv" download>Download CSV</a> · Stop locations only; no route or live service information. Map tiles and library require internet.</p></header>
<div id="map" role="region" aria-label="Muni stop map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const stops=__STOPS__;
const map=L.map('map', {preferCanvas:true}).setView([37.76,-122.44],12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const layer=L.layerGroup().addTo(map);
let matches=stops;
const search=document.getElementById('search'), shelter=document.getElementById('shelter');
function render(){
 const query=search.value.trim().toLowerCase();
 matches=stops.filter(s=>(shelter.value==='all'||s[4]===shelter.value)&&(!query||(s[0]+' '+s[1]).toLowerCase().includes(query)));
 layer.clearLayers();
 for(const s of matches){
  const popup=document.createElement('div');
  popup.textContent=s[1]+' • Stop '+s[0]+' • Shelter: '+(s[4]==='1'?'recorded':s[4]==='0'?'no':'unknown');
  L.circleMarker([s[2],s[3]],{radius:4,color:s[4]==='1'?'#087f72':'#596b78',weight:1,fillOpacity:.75}).bindPopup(popup).addTo(layer);
 }
 document.getElementById('status').textContent=matches.length.toLocaleString()+' of '+stops.length.toLocaleString()+' stops · Teal: shelter recorded · Gray: no or unknown shelter';
}
function fit(){if(matches.length)map.fitBounds(matches.map(s=>[s[2],s[3]]),{padding:[20,20],maxZoom:17});}
search.addEventListener('input',render);shelter.addEventListener('change',render);document.getElementById('fit').addEventListener('click',fit);render();fit();
</script></html>'''
page = page.replace('__STOPS__', json.dumps(stops).replace('<', '\\u003c'))
(directory / 'muni-stops-map.html').write_text(page)
(directory / 'README.md').write_text('''# Muni stops snapshot

Downloaded October 4, 2026 from DataSF:
https://data.sf.gov/api/v3/views/i28k-bkz6/export.csv?accessType=DOWNLOAD

The CSV is the unchanged source export: 3,260 records with unique STOPID values.
All 3,260 latitude/longitude pairs pass a regional bounds check and are mapped.
The records report data_as_of April 8, 2026 (not the download date).
Shelter values: 991 are 1, one is 0, and 2,268 are blank (unknown).
The CSV contains no route assignments; use a verified GTFS join for route filtering.

Open muni-stops-map.html to search by name or ID and filter shelter values.
Leaflet and OpenStreetMap tiles require an internet connection.
Rebuild with python3 build-map.py. This snapshot does not change Fogline's planner.
''')
print(f'Validated and mapped {len(stops):,} stops.')
