import { useEffect, useState } from 'react';
import type { AccountState } from './agent-types';
import type { PatternFeed } from './commute-types';
import { clockInput, formatTypedClock, parseTypedClock } from './planner';
import { RouteMap } from './route-map';
import { directionChoices, directionPatterns, boardingStops, getOffStops, stopPair } from './commute-directions';

type Line = {id:string;code:string;name:string;mode:string;description:string;available:boolean};
const nice=(text:string)=>text===text.toUpperCase()?text.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()):text;
function minuteText(value:number){const n=Number(value);return Number.isFinite(n)?String(n):'';}
function ClockField({name,value,onChange}:{name?:string;value:string;onChange:(value:string)=>void}) {
  return <input name={name} required autoComplete="off" placeholder="9:00 AM" value={value} onChange={e=>onChange(e.target.value)} onBlur={e=>{const parsed=parseTypedClock(e.currentTarget.value);if(parsed!==null)onChange(formatTypedClock(parsed));}}/>;
}
function MinutesInput({value,min,max,onChange}:{value:number;min:number;max:number;onChange:(value:number)=>void}) {
  const [text,setText]=useState(()=>minuteText(value));
  const [focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setText(minuteText(value));},[value,focused]);
  return <input required inputMode="numeric" autoComplete="off" value={text}
    onFocus={()=>setFocused(true)}
    onChange={e=>{
      const raw=e.target.value.replace(/\D/g,'').replace(/^0+(?=\d)/,'');
      setText(raw);
      const n=Number(raw);
      if(raw!==''&&Number.isInteger(n)&&n>=min&&n<=max)onChange(n);
    }}
    onBlur={()=>{
      setFocused(false);
      const n=Number(text);
      if(text===''||!Number.isInteger(n)||n<min||n>max)setText(minuteText(value));
      else{setText(String(n));onChange(n);}
    }}/>;
}
export function CommuteSetup({account,onSave,onQuick,onCancel,busy,quick=false}:{account:AccountState;onSave:(input:any)=>Promise<void>;onQuick?:(input:any)=>Promise<void>;onCancel:()=>void;busy:boolean;quick?:boolean}) {
  const saved=quick?undefined:account.commute;
  const [stage,setStage]=useState(saved?1:0);
  const [lines,setLines]=useState<Line[]>([]);
  const [query,setQuery]=useState('');
  const [line,setLine]=useState(saved?.line||'');
  const [feed,setFeed]=useState<PatternFeed|null>(null);
  const [direction,setDirection]=useState(saved?.direction||'');
  const [boardingId,setBoardingId]=useState(saved?.stopId||'');
  const [getOffId,setGetOffId]=useState(saved?.alightId||'');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [days,setDays]=useState(saved?.days||[1,2,3,4,5]);
  const [profile,setProfile]=useState(account.profile);
  const [quickMode,setQuickMode]=useState('now');
  const [arrivalText,setArrivalText]=useState(()=>quick?'':formatTypedClock(account.profile.arriveBy));
  const [startTime,setStartTime]=useState('');
  const [legacyProfile]=useState(()=>{try{const p=JSON.parse(localStorage.getItem('fogline-v1')||'null')?.profile;return p&&typeof p.destination==='string'&&['arriveBy','ready','walk','destinationWalk'].every(k=>Number.isFinite(p[k]))?p:null;}catch{return null;}});
  const [boardingMargin,setBoardingMargin]=useState(saved?.boardingMargin??3);
  const [buffer,setBuffer]=useState(saved?.buffer??7);
  const [deadlineFirm,setDeadlineFirm]=useState(saved?.deadlineFirm!==false);
  useEffect(()=>{let active=true;setLoading(true);fetch('/api/transit/catalog').then(r=>r.json()).then(d=>{if(active){setLines(d.items||[]);setError(d.error||'');}}).catch(()=>active&&setError('Routes could not load. Try again.')).finally(()=>active&&setLoading(false));return()=>{active=false;};},[]);
  useEffect(()=>{
    if(!line)return;let active=true;setFeed(null);setLoading(true);setError('');
    fetch(`/api/transit/patterns?line=${encodeURIComponent(line)}`).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then((d:PatternFeed)=>{if(active){setFeed(d);if(!d.patterns.some(p=>p.direction===direction)){setDirection('');setBoardingId('');setGetOffId('');}setError(d.error||'');}}).catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));
    return()=>{active=false;};
  },[line]);
  const directions=directionChoices(feed?.patterns||[]);
  const variants=directionPatterns(feed?.patterns||[],direction);
  const boardOptions=boardingStops(variants);
  const alightOptions=getOffStops(variants,boardingId);
  const journey=stopPair(variants,boardingId,getOffId,saved?.patternId);
  const pattern=journey?.pattern;
  const patternId=pattern?.id||'';
  const board=journey?.board??-1;
  const alight=journey?.alight??-1;
  const stops=pattern?.stops||[];
  const selected=lines.find(l=>l.id===line);
  const resetStops=()=>{setBoardingId('');setGetOffId('');};
  const chooseLine=(id:string)=>{setLine(id);setDirection('');resetStops();setStage(1);};
  const mapStops=(journey?stops.slice(board,alight+1):[]).filter(s=>s.lat!==null&&s.lon!==null).map(s=>({...s,lat:s.lat!,lon:s.lon!,line:feed!.code}));
  const update=(key:string,value:string|number)=>setProfile(p=>({...p,[key]:value}));
  return <section className="commute-setup setup">
    <div className="section-title"><div><p className="eyebrow">{quick?'QUICK USE · NOT SAVED':'MY COMMUTE'} · STEP {stage+1} OF 3</p><h1>{stage===0?'Choose your line.':stage===1?'Choose your direction and stops.':'Set your work start and preparation time.'}</h1></div></div>
    {quick&&<p className="muted">This ride stays on this screen. It is not saved, and your commute is left as it is.</p>}
    {error&&<p role="alert" className="notice">{error}</p>}{loading&&<p role="status">Loading verified Muni schedules…</p>}
    {stage===0&&<><label>Search lines<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="15, Judah, California"/></label><p className="muted">Numbers first, then letter lines. Special services show their availability.</p><div className="line-list">{lines.filter(l=>`${l.code} ${l.name}`.toLowerCase().includes(query.toLowerCase())).map(l=><button className="choice" key={l.id} disabled={!l.available} onClick={()=>chooseLine(l.id)}><strong>{l.code}</strong><span>{nice(l.name)}<small>{l.mode}{!l.available?` · ${l.description}`:''}</small></span></button>)}</div>{!loading&&lines.length>0&&!lines.some(l=>`${l.code} ${l.name}`.toLowerCase().includes(query.toLowerCase()))&&<p>No matching lines.</p>}</>}
    {stage===1&&<>
      <p><b>{selected?.code||saved?.code}</b> · {nice(selected?.name||'Muni')} <button className="text-button" onClick={()=>setStage(0)}>Change line</button></p>
      <label>Direction<select value={direction} disabled={!feed||loading} onChange={e=>{setDirection(e.target.value);resetStops();}}><option value="">Choose inbound or outbound</option>{directions.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label>Which stop are you boarding at?<select value={boardingId} disabled={!direction||loading} onChange={e=>{setBoardingId(e.target.value);setGetOffId('');}}><option value="">Choose boarding stop</option>{boardOptions.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
      <label>Which stop are you getting off at?<select value={getOffId} disabled={!boardingId||loading} onChange={e=>setGetOffId(e.target.value)}><option value="">Choose get-off stop</option>{alightOptions.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
      {boardingId&&<p className="muted">Get-off stops are places you can reach directly from your boarding stop.</p>}
      {journey&&<>
        <RouteMap stops={mapStops} vehicles={[]} selectedId={boardingId} destinationId={getOffId} fitKey={`${patternId}:${board}:${alight}`}/>
        <p className="muted">Orange: boarding · Green: getting off</p>
        {mapStops.length<alight-board+1&&<p className="muted">Some stops have no map coordinates. Your stop selections are still valid.</p>}
      </>}
      <button className="primary" disabled={!journey||loading} onClick={()=>setStage(2)}>Continue to my morning →</button>
    </>}
    {stage===2&&pattern&&<form onSubmit={async e=>{e.preventDefault();setError('');const arrivalMinutes=parseTypedClock(arrivalText);if(arrivalMinutes===null){setError('Type a work start time like 9:00 AM.');return;}let quickTiming:string|undefined;if(quick){if(quickMode==='now')quickTiming='now';else{const start=parseTypedClock(startTime);if(start===null){setError('Type a start time like 7:30 AM.');return;}quickTiming=clockInput(start);}}const submittedProfile={...profile,arriveBy:arrivalMinutes};const input={...(quick?{quickTiming}:{}),revision:account.revision,configRevision:account.configRevision??0,profile:submittedProfile,commute:{line,patternId,boardIndex:board,alightIndex:alight,days:quick?[0,1,2,3,4,5,6]:days,buffer,boardingMargin,deadlineFirm:quick?true:deadlineFirm}};try{if(quick)await onQuick?.(input);else await onSave(input);}catch(err){setError((err as Error).message);}}}>
      <div className="stop-summary"><b>{selected?.code} · {pattern.label} → {pattern.headsign}</b><p>{stops[board].name} → {stops[alight].name}</p><button type="button" className="text-button" onClick={()=>setStage(1)}>Edit stops</button></div>
      {!quick&&!saved&&legacyProfile&&<details><summary>Use earlier preferences from this device</summary><p>{legacyProfile.destination} by {clockInput(legacyProfile.arriveBy)} · {legacyProfile.ready} minutes to get ready. Review these values before saving. Demo check-ins stay separate.</p><button type="button" onClick={()=>{setArrivalText(formatTypedClock(legacyProfile.arriveBy));setProfile(p=>({...p,destination:legacyProfile.destination,arriveBy:legacyProfile.arriveBy,ready:legacyProfile.ready,walk:legacyProfile.walk,destinationWalk:legacyProfile.destinationWalk}));}}>Use these morning preferences</button></details>}
      <div className="arrival-input"><label>{quick?'Work start time today':'Work start time'}<ClockField name="arriveBy" value={arrivalText} onChange={next=>{setArrivalText(next);const parsed=parseTypedClock(next);if(parsed!==null)update('arriveBy',parsed);}}/></label><p className="muted">Type a time like 9:00 AM. We use this as your arrival deadline at work.</p></div>
      <label className="ready-input">Time to get ready (minutes)<MinutesInput value={profile.ready} min={5} max={180} onChange={n=>update('ready',n)}/></label>
      <details className="optional-journey-settings">
        <summary>Optional: walking times and more</summary>
        <p className="muted">Your current walking estimates and extra time are included in the plan. Adjust them here if needed.</p>
        <div className="fields">
          <label>Walk to the bus stop (minutes)<MinutesInput value={profile.walk} min={0} max={90} onChange={n=>update('walk',n)}/></label>
          <label>Walk from the bus to work (minutes)<MinutesInput value={profile.destinationWalk} min={0} max={90} onChange={n=>update('destinationWalk',n)}/></label>
          <label>Extra time at the bus stop (minutes)<MinutesInput value={boardingMargin} min={0} max={20} onChange={setBoardingMargin}/></label>
          <label>Extra time before work (minutes)<MinutesInput value={buffer} min={0} max={60} onChange={setBuffer}/></label>
        </div>
      <label>Destination name<input required maxLength={60} value={profile.destination} onChange={e=>update('destination',e.target.value)} placeholder="Work, school, home"/></label>
      {quick&&<fieldset><legend>When do you want to start getting ready?</legend><div className="days"><button type="button" aria-pressed={quickMode==='now'} onClick={()=>setQuickMode('now')}>Start now</button><button type="button" aria-pressed={quickMode==='later'} onClick={()=>setQuickMode('later')}>Choose a later time</button></div>{quickMode==='later'&&<label>Start time today<ClockField value={startTime} onChange={setStartTime}/></label>}<p className="muted">{quickMode==='now'?'Uses the current time when you check.':'Choose when you want to begin getting ready today.'} We find the first bus you can catch that reaches your destination by your deadline, with your arrival buffer. If none fits, we say so. Exa checks route conditions when departure is within two hours.</p></fieldset>}
      {!quick&&<fieldset><legend>Travel days</legend><div className="days">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><button type="button" key={d} aria-pressed={days.includes(i)} onClick={()=>setDays(old=>old.includes(i)?old.filter(x=>x!==i):[...old,i])}>{d}</button>)}</div></fieldset>}
      {!quick&&<label className="check-label"><input type="checkbox" checked={deadlineFirm} onChange={e=>setDeadlineFirm(e.target.checked)}/> My arrival time is firm. Fogline will only offer later arrivals as options and ask first.</label>}
      </details>
      <p className="muted">{quick?'Times use San Francisco time. Leaving this screen drops the ride.':'Times use San Francisco time. Your plan includes preparation, the bus ride, and your walking estimates.'}</p><button className="primary" disabled={busy||(!quick&&!days.length)}>{busy?quick?'Checking…':'Saving…':quick?'See this plan':'Save commute & see my plan'}</button>
    </form>}
    <button className="text-button cancel" disabled={busy} onClick={onCancel}>Cancel</button>
  </section>;
}
