import { useEffect, useState } from 'react';
import type { AccountState } from './agent-types';
import type { PatternFeed, Commute } from './commute-types';
import { clockInput } from './planner';
import { milesBetween, RouteMap } from './route-map';

type Line = {id:string;code:string;name:string;mode:string;description:string;available:boolean};
const nice=(text:string)=>text===text.toUpperCase()?text.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()):text;
const walkMinutes=(miles:number)=>Math.min(90,Math.max(1,Math.ceil(miles*20)));
export function CommuteSetup({account,onSave,onCancel,busy}:{account:AccountState;onSave:(input:any)=>Promise<void>;onCancel:()=>void;busy:boolean}) {
  const saved=account.commute;
  const [stage,setStage]=useState(saved?1:0);
  const [lines,setLines]=useState<Line[]>([]);
  const [query,setQuery]=useState('');
  const [line,setLine]=useState(saved?.line||'');
  const [feed,setFeed]=useState<PatternFeed|null>(null);
  const [patternId,setPatternId]=useState(saved?.patternId||'');
  const [board,setBoard]=useState(saved?.boardIndex??-1);
  const [alight,setAlight]=useState(saved?.alightIndex??-1);
  const [stopQuery,setStopQuery]=useState('');
  const [here,setHere]=useState<{lat:number;lon:number}|null>(null);
  const [locNote,setLocNote]=useState('');
  const [locating,setLocating]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [days,setDays]=useState(saved?.days||[1,2,3,4,5]);
  const [profile,setProfile]=useState(account.profile);
  const [legacyProfile]=useState(()=>{try{const p=JSON.parse(localStorage.getItem('fogline-v1')||'null')?.profile;return p&&typeof p.destination==='string'&&['arriveBy','ready','walk','destinationWalk'].every(k=>Number.isFinite(p[k]))?p:null;}catch{return null;}});
  const [boardingMargin,setBoardingMargin]=useState(saved?.boardingMargin??3);
  const [buffer,setBuffer]=useState(saved?.buffer??7);
  useEffect(()=>{let active=true;setLoading(true);fetch('/api/transit/catalog').then(r=>r.json()).then(d=>{if(active){setLines(d.items||[]);setError(d.error||'');}}).catch(()=>active&&setError('Routes could not load. Try again.')).finally(()=>active&&setLoading(false));return()=>{active=false;};},[]);
  useEffect(()=>{
    if(!line)return;let active=true;setFeed(null);setLoading(true);setError('');
    fetch(`/api/transit/patterns?line=${encodeURIComponent(line)}`).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then((d:PatternFeed)=>{if(active){setFeed(d);if(!d.patterns.some(p=>p.id===patternId)){setPatternId('');setBoard(-1);setAlight(-1);}setError(d.error||'');}}).catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[line]);
  const pattern=feed?.patterns.find(p=>p.id===patternId);
  const selected=lines.find(l=>l.id===line);
  const chooseLine=(id:string)=>{setLine(id);setPatternId('');setBoard(-1);setAlight(-1);setStopQuery('');setStage(1);};
  const stops=pattern?.stops||[];
  const displayed=stops.filter(s=>`${s.name} ${s.code}`.toLowerCase().includes(stopQuery.toLowerCase()));
  const mapStops=stops.filter(s=>s.lat!==null&&s.lon!==null).map(s=>({...s,lat:s.lat!,lon:s.lon!,line:feed!.code}));
  const milesFor=(stop:{lat:number|null;lon:number|null})=>here&&stop.lat!==null&&stop.lon!==null?milesBetween(here,{lat:stop.lat,lon:stop.lon}):null;
  const chooseBoard=(sequence:number)=>{setBoard(sequence);if(alight<=sequence)setAlight(-1);const stop=stops[sequence];const miles=stop?milesFor(stop):null;if(miles!==null)setProfile(current=>({...current,walk:walkMinutes(miles)}));};
  const pickOnMap=(stop:{id:string})=>{const match=stops.find(s=>s.id===stop.id);if(!match)return;if(board>=0&&match.sequence>board&&match.dropoff!=='1')setAlight(match.sequence);else if(match.pickup!=='1'&&match.sequence!==stops.length-1)chooseBoard(match.sequence);};
  const closest=here?[...stops].filter(s=>milesFor(s)!==null).map(s=>({stop:s,miles:milesFor(s)!})).sort((a,b)=>a.miles-b.miles).slice(0,5):[];
  const locate=()=>{if(!navigator.geolocation){setLocNote('This browser cannot share location. Search stops by name instead.');return;}setLocating(true);setLocNote('');navigator.geolocation.getCurrentPosition((pos)=>{setHere({lat:pos.coords.latitude,lon:pos.coords.longitude});setLocNote(pos.coords.accuracy>250?'Location is approximate, so distances may be off by a few blocks.':'');setLocating(false);},(err)=>{setLocating(false);setLocNote(err.code===1?'Location is blocked for this browser. Allow location, or search stops by name.':'Your location could not be found. Search stops by name instead.');},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});};
  const update=(key:string,value:string|number)=>setProfile(p=>({...p,[key]:value}));
  return <section className="commute-setup setup">
    <div className="section-title"><div><p className="eyebrow">MY COMMUTE · STEP {stage+1} OF 3</p><h1>{stage===0?'Choose your line.':stage===1?'Choose your direction and stops.':'Make it your morning.'}</h1></div></div>
    {error&&<p role="alert" className="notice">{error}</p>}{loading&&<p role="status">Loading verified Muni schedules…</p>}
    {stage===0&&<><label>Search lines<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="15, Judah, California"/></label><p className="muted">Numbers first, then letter lines. Special services show their availability.</p><div className="line-list">{lines.filter(l=>`${l.code} ${l.name}`.toLowerCase().includes(query.toLowerCase())).map(l=><button className="choice" key={l.id} disabled={!l.available} onClick={()=>chooseLine(l.id)}><strong>{l.code}</strong><span>{nice(l.name)}<small>{l.mode}{!l.available?` · ${l.description}`:''}</small></span></button>)}</div>{!loading&&lines.length>0&&!lines.some(l=>`${l.code} ${l.name}`.toLowerCase().includes(query.toLowerCase()))&&<p>No matching lines.</p>}</>}
    {stage===1&&<><p><b>{selected?.code||saved?.code}</b> · {nice(selected?.name||'Muni')} <button className="text-button" onClick={()=>setStage(0)}>Change line</button></p><label>Direction<select value={patternId} disabled={!feed||loading} onChange={e=>{setPatternId(e.target.value);setBoard(-1);setAlight(-1);setStopQuery('');}}><option value="">Choose a direction</option>{feed?.patterns.map(p=><option key={p.id} value={p.id}>{p.label} → {p.headsign} · {p.stops.length} stops · {p.stops[0]?.name}</option>)}</select></label>
    {pattern&&<><p className="muted">{here?'Closest stops are listed from where you are. The full list below stays in travel order.':'Share your location to see the closest stops, or search the full list in travel order.'}</p>
    <div className="stop-tools"><button type="button" onClick={locate} disabled={locating}>{locating?'Finding you…':here?'Update my location':'Use my location'}</button><label>Search stops by name or ID<input value={stopQuery} onChange={e=>setStopQuery(e.target.value)} placeholder="Palou or 15864"/></label></div>
    {locNote&&<p className="muted" role="status">{locNote}</p>}
    {here&&<><h2 className="nearby-heading">Closest to you</h2><ol className="closest-stops">{closest.map(({stop,miles})=>{const suggested=walkMinutes(miles);return <li key={`${pattern.id}-near-${stop.sequence}`}><div><strong>{stop.name}</strong><small>{miles<0.1?'Under 0.1 mi':`${miles.toFixed(1)} mi`} · about {suggested} min walk · stop {stop.code}</small></div><div className="stop-actions"><button type="button" disabled={stop.pickup==='1'||stop.sequence===stops.length-1} aria-pressed={board===stop.sequence} onClick={()=>chooseBoard(stop.sequence)}>Board here</button><button type="button" disabled={board<0||stop.sequence<=board||stop.dropoff==='1'} aria-pressed={alight===stop.sequence} onClick={()=>setAlight(stop.sequence)}>Get off here</button></div></li>;})}</ol>
    <RouteMap stops={mapStops} vehicles={[]} shape={pattern.shape} selectedId={stops[board]?.id} fitKey={`${pattern.id}:${here.lat.toFixed(3)},${here.lon.toFixed(3)}`} here={here} onSelect={pickOnMap}/><p className="muted">The blue marker is you. The map is zoomed to nearby stops. Tap a stop to board there, or to get off if you already chose a boarding stop.</p></>}
    <div className="stop-summary"><p><b>Board:</b> {board>=0?`${stops[board]?.name} · ${stops[board]?.code}`:'Choose below'}{board>=0&&milesFor(stops[board])!==null?` · about ${walkMinutes(milesFor(stops[board])!)} min walk`:''}</p><p><b>Get off:</b> {alight>=0?`${stops[alight]?.name} · ${stops[alight]?.code}`:'Choose below'}</p></div>
    <ol className="ordered-stops" aria-label="All stops in travel order">{displayed.map(s=>{const miles=milesFor(s);return <li key={`${pattern.id}-${s.sequence}`} value={s.sequence+1} className={s.sequence===board||s.sequence===alight?'selected-stop':''}><div><strong>{s.name}</strong><small>Stop {s.code}{miles===null?'':miles<0.1?' · under 0.1 mi away':` · ${miles.toFixed(1)} mi away`}{s.lat===null||s.lon===null?' · Map location unavailable':''}{s.accessibility==='1'?' · Accessible boarding':s.accessibility==='2'?' · Boarding not wheelchair accessible':''}</small></div><div className="stop-actions"><button type="button" disabled={s.pickup==='1'||s.sequence===stops.length-1} aria-pressed={board===s.sequence} onClick={()=>chooseBoard(s.sequence)}>Board here</button><button type="button" disabled={board<0||s.sequence<=board||s.dropoff==='1'} aria-pressed={alight===s.sequence} onClick={()=>setAlight(s.sequence)}>Get off here</button></div></li>;})}</ol>{!displayed.length&&<p>No matching stops. Clear your search to see all stops.</p>}
    {!here&&<details><summary>View this route on the map</summary><RouteMap stops={mapStops} vehicles={[]} shape={pattern.shape} selectedId={stops[board]?.id} fitKey={pattern.id} onSelect={pickOnMap}/></details>}
    <button className="primary" disabled={board<0||alight<=board||loading} onClick={()=>setStage(2)}>Continue to my morning →</button></> }</>}
    {stage===2&&pattern&&<form onSubmit={async e=>{e.preventDefault();setError('');try{await onSave({revision:account.revision,configRevision:account.configRevision??0,profile,commute:{line,patternId,boardIndex:board,alightIndex:alight,days,buffer,boardingMargin}});}catch(e){setError((e as Error).message);}}}>
      <div className="stop-summary"><b>{selected?.code} · {pattern.label} → {pattern.headsign}</b><p>{stops[board].name} → {stops[alight].name}</p><button type="button" className="text-button" onClick={()=>setStage(1)}>Edit stops</button></div>
      {!saved&&legacyProfile&&<details><summary>Use earlier preferences from this device</summary><p>{legacyProfile.destination} by {clockInput(legacyProfile.arriveBy)} · {legacyProfile.ready} minutes to get ready. Review these values before saving. Demo check-ins stay separate.</p><button type="button" onClick={()=>setProfile(p=>({...p,destination:legacyProfile.destination,arriveBy:legacyProfile.arriveBy,ready:legacyProfile.ready,walk:legacyProfile.walk,destinationWalk:legacyProfile.destinationWalk}))}>Use these morning preferences</button></details>}
      <label>Destination name<input required maxLength={60} value={profile.destination} onChange={e=>update('destination',e.target.value)} placeholder="Work, school, home"/></label>
      <label>Arrive by<input required type="time" value={clockInput(profile.arriveBy)} onChange={e=>{const [h,m]=e.target.value.split(':').map(Number);update('arriveBy',h*60+m);}}/></label>
      <fieldset><legend>Travel days</legend><div className="days">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><button type="button" key={d} aria-pressed={days.includes(i)} onClick={()=>setDays(old=>old.includes(i)?old.filter(x=>x!==i):[...old,i])}>{d}</button>)}</div></fieldset>
      <div className="fields">{([['ready','Getting ready',5,180],['walk','Walk to boarding stop',0,90],['destinationWalk','Walk after getting off',0,90]] as const).map(([key,label,min,max])=><label key={key}>{label} (minutes)<input required type="number" min={min} max={max} value={profile[key]} onChange={e=>update(key,Number(e.target.value))}/></label>)}<label>Early boarding margin (minutes)<input required type="number" min={0} max={20} value={boardingMargin} onChange={e=>setBoardingMargin(Number(e.target.value))}/></label><label>Arrival buffer (minutes)<input required type="number" min={0} max={60} value={buffer} onChange={e=>setBuffer(Number(e.target.value))}/></label></div>
      <p className="muted">Times use San Francisco time. Ride duration comes from the selected trip’s schedule. Walking times are your estimates. The boarding margin is a precaution, not a guaranteed prediction of early arrivals.</p><button className="primary" disabled={busy||!days.length}>{busy?'Saving…':'Save commute & see my plan'}</button>
    </form>}
    <button className="text-button cancel" disabled={busy} onClick={onCancel}>Cancel</button>
  </section>;
}
