import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountState } from './agent-types';
import type { PatternFeed } from './commute-types';
import { CommuteSetup } from './CommuteSetup';
import { RouteMap, type MapVehicle } from './route-map';
import { clockInput } from './planner';
import './style.css';

async function request(path:string,data?:unknown,key?:string) {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Fogline-Client':'1',...(key?{Authorization:`Bearer ${key}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Request failed.'),{status:response.status});return result;
}
const time=(at:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(at));
const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function App() {
  const [account,setAccount]=useState<AccountState|null>(null);
  const [connecting,setConnecting]=useState(true),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [tab,setTab]=useState('Today'),[editing,setEditing]=useState(false),[patternFeed,setPatternFeed]=useState<PatternFeed|null>(null);
  const [vehicles,setVehicles]=useState<MapVehicle[]>([]),[vehicleAt,setVehicleAt]=useState<number|null>(null);
  const [now,setNow]=useState(Date.now());
  const refreshing=useRef(false);
  const current=useRef({account,busy,editing});current.current={account,busy,editing};
  const accept=(next:AccountState)=>setAccount(old=>!old||next.revision>=old.revision?next:old);
  const action=async(path:string,data?:unknown)=>{setBusy(true);setError('');try{const result=await request(path,data);accept(result);return result;}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}};
  useEffect(()=>{request('/api/agent/state').then(accept).catch(e=>{if(e.status!==401)setError(e.message);}).finally(()=>setConnecting(false));const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!account)return;let active=true;
    const refresh=()=>{if(document.visibilityState==='hidden'||busy||editing)return;request('/api/agent/state').then(d=>active&&accept(d)).catch(e=>active&&setError(e.message));};
    const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[Boolean(account),busy,editing]);
  const commute=account?.commute;
  useEffect(()=>{
    if(!commute)return;let active=true;setPatternFeed(null);
    fetch(`/api/transit/patterns?line=${encodeURIComponent(commute.line)}`).then(r=>r.json()).then(d=>{if(active&&d.patterns)setPatternFeed(d);}).catch(()=>{});
    return()=>{active=false;};
  },[commute?.line,commute?.patternId]);
  // One refresh trigger for the plan and its map positions. Server caches enforce the upstream budget.
  const refresh=async()=>{
    const state=current.current, selected=state.account?.commute;
    if(!state.account||state.busy||state.editing||refreshing.current)return;
    refreshing.current=true;
    try {
      await action('/api/agent/check',{});

    } finally {refreshing.current=false;}
  };
  useEffect(()=>{
    if(!commute||editing)return;
    void refresh().catch(()=>{});
    const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh().catch(()=>{});},60000);
    return()=>clearInterval(timer);
  },[commute?.patternId,commute?.boardIndex,commute?.alightIndex,editing]);
  const today=dayKey(), ride=account?.rides.find(r=>r.date===today);
  const result=account?.briefing?.journey, plan=result?.plan;
  const pattern=patternFeed?.patterns.find(p=>p.id===(plan?.patternId||commute?.patternId));
  const matchedVehicles:MapVehicle[]=plan?.position&&plan.observedAt&&now-plan.position.recordedAt<=240000?[{...plan.position,destination:commute?.headsign||'',bearing:null}]:[];
  const mapStops=pattern?.stops.filter(s=>s.lat!==null&&s.lon!==null).map(s=>({...s,lat:s.lat!,lon:s.lon!,line:commute!.code}))||[];
  const legacy=()=>{try{return JSON.parse(localStorage.getItem('fogline-v1')||'null');}catch{return null;}};
  return <div className="app commute-app"><header><a className="brand" href="/" aria-label="Fogline home"><span className="mark">≋</span> fogline<span className="brand-dot">.</span></a><span className="mode">YOUR MORNING</span></header><main>
    {!account?<section className="welcome setup"><p className="eyebrow">LESS MORNING MATH</p><h1>A little more time.<br/>A better morning.</h1><p>Save your Muni commute once. Know when to get ready, when to leave, and which trip gets you there.</p>{connecting?<p role="status">Connecting to your saved commute…</p>:<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await request('/api/agent/session',{},key.trim());setKey('');accept(await request('/api/agent/state'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label>Connect this device<input type="password" autoComplete="off" required value={key} onChange={e=>setKey(e.target.value)} placeholder="Personal account key"/></label><button className="primary" disabled={busy}>{busy?'Connecting…':'Connect & keep me signed in'}</button><p className="muted">This device stays connected for 30 days. Your commute and history are saved on your server.</p><details><summary>First-time server setup</summary><p>Run <code>pnpm account</code> in the server terminal to get your private account key. Use the same server address on your phone. Remote access needs HTTPS.</p></details></form>}</section>:<>
      {!editing&&<nav aria-label="Main navigation">{['Today','My commute','History'].map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</nav>}
      {editing?<CommuteSetup account={account} busy={busy} onCancel={()=>setEditing(false)} onSave={async input=>{await action('/api/agent/commute',input);setEditing(false);setTab('Today');}}/>:<>
      {!commute&&tab!=='History'?<section className="welcome"><p className="eyebrow">START WITH YOUR JOURNEY</p><h1>Where are you headed?</h1><p>Choose a line, direction, and both stops. We’ll work backward from your arrival time.</p><button className="primary" onClick={()=>setEditing(true)}>Set up my commute →</button><p className="muted">Existing server preferences and ride history are preserved. Your earlier browser demo stays separate.</p>{legacy()?.entries?.length>0&&<details><summary>Earlier demo feedback is saved on this device</summary><p>Your sample-clock check-ins have not been imported as real trips.</p></details>}</section>:null}
      {commute&&tab==='Today'&&<><div className="morning-heading"><p className="eyebrow">{result?.day&&result.day!==today?`NEXT COMMUTE · ${result.day}`:'TODAY'}</p><h1>Your morning, figured out.</h1><p>{account.profile.destination} by {clockInput(account.profile.arriveBy)} · San Francisco time</p></div>
      <section className="plan" aria-live="polite"><div className="plan-top"><span className="eyebrow">{ride?.arrived?'JOURNEY COMPLETE':ride?.left?'ON YOUR WAY':ride?.started?'GETTING READY':'START GETTING READY'}</span><span className="small-label">{plan?.source==='live'?(plan.observedAt&&now-plan.observedAt<=240000?'PROVIDER PREDICTION':'OLD PROVIDER PREDICTION'):plan?'SCHEDULED ESTIMATE':'PLAN STATUS'}</span></div><div className="hero-time">{ride?.arrived?'You made it.':ride?.left?'Safe travels.':ride?.started?'You’re getting ready.':plan?time(plan.start):busy?'Checking…':'No plan yet'}</div><p>{ride?.arrived?'Your check-ins help improve the next morning.':ride?.left?'Check in when you board, then when you reach your destination.':result?.reason||'Check the latest schedule to build your plan.'}</p>
      {plan&&!ride?.left&&<div className="plan-times"><div><small>Leave by</small><strong>{time(plan.leave)}</strong></div><div><small>Bus {commute.code} estimate</small><strong>{time(plan.expected)}</strong></div><div><small>Estimated arrival</small><strong>{time(plan.arrive)}</strong></div></div>}
      {!ride?.arrived&&<button className="primary" disabled={busy||(!ride?.started&&(!plan||result?.day!==today))} onClick={()=>void action('/api/agent/checkin',{action:!ride?.started?'start':!ride.left?'leave':!ride.boarded?'board':'arrive'}).catch(()=>{})}>{!ride?.started?'I’m starting now':!ride.left?'I’m out the door':!ride.boarded?'I’m on the bus':'I’ve arrived'} ✓</button>}
      <p className="muted">Arrival range is not yet calibrated. Times are estimates, not guarantees.</p><div className="plan-foot"><span>{plan?`Be at the stop by ${time(plan.beAtStop)} · ${plan.boardingMargin} min boarding margin. `:''}{account.profile.ready} min to get ready · {commute.buffer} min arrival buffer</span></div></section>
      <section className="journey-card"><div className="section-title"><h2><span className="route-badge">{commute.code}</span> {commute.directionLabel}</h2><button className="text-button" disabled={busy} onClick={()=>void refresh().catch(()=>{})}>{busy?'Checking…':'Refresh'}</button></div><p>Toward {plan?.headsign||commute.headsign}</p><p className="muted">{plan?.stopsRemaining!=null?`${plan.stopsRemaining} stops before your stop · last confirmed progress`:'Stops remaining are not confirmed for this trip.'}</p><ol className="trip-ends"><li><strong>{commute.stopName}</strong><small>Board · stop {commute.stopId}</small></li><li><strong>{commute.alightName}</strong><small>Get off · stop {commute.alightId}</small></li></ol><p className="feed-meta">{account.briefing?`Plan checked ${time(Date.parse(account.briefing.checkedAt))}. `:''}{account.briefing?.sourceAt?`Trip last observed ${time(Date.parse(account.briefing.sourceAt))}. `:''}Scheduled estimates can change.</p>
      <details><summary>Route map and all stops</summary>{pattern?<><RouteMap stops={mapStops} vehicles={matchedVehicles} shape={pattern.shape} selectedId={commute.stopId} fitKey={pattern.id}/><p className="muted">{matchedVehicles.length?'Vehicle matched to your boarding prediction.':'No confirmed vehicle position for this trip. The route and stops remain available.'}</p><ol className="route-stop-list">{pattern.stops.map(s=><li key={`${s.id}-${s.sequence}`}><b>{s.name}</b><small>Stop {s.code}{s.sequence===(plan?.boardIndex??commute.boardIndex)?' · Board here':s.sequence===(plan?.alightIndex??commute.alightIndex)?' · Get off here':''}</small></li>)}</ol></>:<p>Route map unavailable. Your saved stops are shown above.</p>}</details>
      <details><summary>Why this recommendation?</summary><p>{result?.modelStatus||'No calibrated arrival range is available yet.'}</p><p>Your boarding margin protects against some early arrival uncertainty. Destination arrival {plan?.destinationSource==='live'?'uses a downstream provider prediction.':'uses the schedule and known delay; later delays remain unknown.'}</p>{plan?.observedAt&&<p>Trip observation: {time(plan.observedAt)}{now-plan.observedAt>240000?' · Old observation—refresh before relying on this estimate.':''}</p>}{result?.alternative&&<p>Earlier option: bus {commute.code} at {time(result.alternative.expected)}. Leave by {time(result.alternative.leave)}.</p>}{result?.notices?.map(n=><p key={n.id}>{n.description||n.header}{/^https:\/\//.test(n.url)&&<a href={n.url} target="_blank" rel="noreferrer"> Official notice</a>}</p>)}{result?.rejected?.slice(0,3).map(t=><p key={t.tripId}>{time(t.expected)}: {t.reason}</p>)}</details>
      <details><summary>Official event and travel advisories</summary><p className="muted">{result?.advisoryCoverage} Review exact stop and closure hours in the source. These notices do not add invented delay minutes.</p>{result?.advisories?.length?result.advisories.map(a=><article key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a><p>{a.description}</p></article>):<p>No matching route notice was found in the checked pages. This does not confirm that every stop is open.</p>}</details>
      <details><summary>Upcoming departures for this journey</summary>{result?.departures.length?result.departures.map(d=><div className="feed-row" key={d.tripId}><strong>{commute.code}</strong><span>{commute.headsign}<small>{d.source==='live'?'Live prediction':'Scheduled'}</small></span><span>{time(d.expected)}</span></div>):<p>{result?.reason||'No departures loaded.'}</p>}</details>
      <details><summary>Morning briefing</summary><p>{account.briefing?.speech||'Refresh to hear your plan.'}</p><button className="text-button" onClick={()=>{if(account.briefing&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(account.briefing.speech));}}}>Hear my plan</button></details></section>
      {account.briefing?.alerts.length? <section className="notice"><h2>Service notices</h2>{account.briefing.alerts.map((a,i)=><p key={i}>{a}</p>)}</section>:null}{result?.catalogWarning&&<p className="notice">Schedule refresh unavailable. Using the last verified schedule within its service dates.</p>}
      </>}
      {tab==='My commute'&&<>{commute&&<section className="setup"><p className="eyebrow">SAVED ON YOUR SERVER</p><h1>My commute.</h1><div className="stop-summary"><h2>{commute.code} · {commute.directionLabel}</h2><p>{commute.stopName} → {commute.alightName}</p><p>{account.profile.destination} by {clockInput(account.profile.arriveBy)}</p><p>{commute.days.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')} · {account.profile.ready} min preparation</p></div><button className="primary" onClick={()=>setEditing(true)}>Edit my commute</button>
      <details><summary>Reminders</summary><p>Automatic checks use your saved travel days and server wake window. Push delivery requires ntfy configured on the server; phone calls are not delivered.</p><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const mins=(k:string)=>String(form.get(k)).split(':').map(Number).reduce((a,b)=>a*60+b,0);void action('/api/agent/settings',{revision:account.revision,configRevision:account.configRevision??0,profile:account.profile,settings:{...account.settings,enabled:form.get('enabled')==='on',wakeStart:mins('wakeStart'),wakeEnd:mins('wakeEnd')}}).catch(()=>{});}}><label className="check-label"><input type="checkbox" name="enabled" defaultChecked={account.settings.enabled}/> Enable automatic checks and configured push alerts</label><div className="fields"><label>Wake window starts<input name="wakeStart" type="time" required defaultValue={clockInput(account.settings.wakeStart)}/></label><label>Wake window ends<input name="wakeEnd" type="time" required defaultValue={clockInput(account.settings.wakeEnd)}/></label></div><p className="muted">The wake window must currently start and end on the same day. Keep the server awake and reachable.</p><button disabled={busy}>Save reminders</button></form></details></section>}
      <details><summary>Device connection</summary><p>This device uses a private server session. Disconnecting preserves your commute and history.</p><button disabled={busy} onClick={async()=>{try{await request('/api/agent/logout',{});setAccount(null);setVehicles([]);setEditing(false);}catch(e){setError((e as Error).message);}}}>Disconnect this device</button></details></>}
      {tab==='History'&&<section><p className="eyebrow">YOUR REAL MORNINGS</p><h1>A rhythm that learns.</h1><div className="stat"><strong>{account.profile.ready}<small> min</small></strong><span>Current preparation estimate</span></div><p className="muted">Completed preparation measurements influence the next morning, not the one already in progress.</p>{account.rides.filter(r=>r.started).length?account.rides.filter(r=>r.started).map(r=><article className="history-row" key={r.date}><h3>{r.date}</h3><p>Started {time(Date.parse(r.started!))}{r.left?` · Left ${time(Date.parse(r.left))}`:''}{r.arrived?` · Arrived ${time(Date.parse(r.arrived))}`:''}</p>{r.measured!==null&&<p>{r.measured} min getting ready · next estimate {r.nextReady} min</p>}</article>):<p>Your first real check-in starts this history.</p>}<details><summary>Decision history</summary>{account.events.slice(0,20).map(e=><p key={e.id}>{e.text}</p>)}</details></section>}
      </>}
    </>}
    {error&&<p role="alert" className="notice">{error}</p>}<footer><span className="brand">fogline.</span><p>A clear plan. A little more room for your morning.</p></footer>
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
