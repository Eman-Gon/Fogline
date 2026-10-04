import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountState } from './agent-types';
import type { Commute, JourneyResult, PatternFeed } from './commute-types';
import { CommuteSetup } from './CommuteSetup';
import { AskFogline } from './AskFogline';
import { PhoneNotifications } from './PhoneNotifications';
import { ExaResearchReport } from './ExaResearchReport';
import { TrackRide } from './TrackRide';
import { ArrivalStatus } from './ArrivalStatus';
import { RouteMap, type MapVehicle } from './route-map';
import { clockInput, type Profile } from './planner';
import { codeFromScan, pairLink } from './pair-link';
import { QrMark, QrScanner } from './pair-qr';
import './style.css';

async function request(path:string,data?:unknown,key?:string) {
  const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Fogline-Client':'1',...(key?{Authorization:`Bearer ${key}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Request failed.'),{status:response.status});return result;
}
type View = 'tracking' | 'home' | 'setup' | 'today' | 'quick' | 'route' | 'departures' | 'ask' | 'briefing' | 'notices' | 'history' | 'pair' | 'reminders';
type TempRide = { input: Record<string, unknown>; commute: Commute; profile: Profile; journey: JourneyResult };
const time=(at:number)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(new Date(at));
const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const needsCommute = new Set<View>(['today','route','departures','ask','briefing','notices']);
function App() {
  const [account,setAccount]=useState<AccountState|null>(null);
  const [connecting,setConnecting]=useState(true),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [view,setView]=useState<View>('home'),[editing,setEditing]=useState(false),[quick,setQuick]=useState(false),[temp,setTemp]=useState<TempRide|null>(null),[patternFeed,setPatternFeed]=useState<PatternFeed|null>(null);
  const [pair,setPair]=useState<{code:string;expires:number;scanUrl?:string}|null>(null);
  const [scanning,setScanning]=useState(false);
  const [now,setNow]=useState(Date.now());
  const refreshing=useRef(false);
  const previewing=useRef(false);
  const previewSequence=useRef(0);
  const [previewBusy,setPreviewBusy]=useState(false);
  const current=useRef({account,busy,editing,view});current.current={account,busy,editing,view};
  const accept=(next:AccountState)=>setAccount(old=>!old||next.revision>=old.revision?next:old);
  const action=async(path:string,data?:unknown)=>{setBusy(true);setError('');try{const result=await request(path,data);accept(result);return result;}catch(e){setError((e as Error).message);throw e;}finally{setBusy(false);}};
  useEffect(()=>{request('/api/agent/state').then(accept).catch(e=>{if(e.status!==401)setError(e.message);}).finally(()=>setConnecting(false));const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(connecting)return;
    const code=codeFromScan(location.href);
    if(!code)return;
    history.replaceState(null,'','/');
    if(account)return;
    setBusy(true);setError('');
    request('/api/agent/session',{},code).then(()=>request('/api/agent/state')).then(next=>{accept(next);setView('home');}).catch(e=>setError(e.message)).finally(()=>setBusy(false));
  },[connecting,account]);
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
  const refresh=async()=>{
    const state=current.current, selected=state.account?.commute;
    if(!state.account||!selected||state.busy||state.editing||state.view==='quick'||refreshing.current)return;
    refreshing.current=true;
    try { await action('/api/agent/check',{}); }
    finally {refreshing.current=false;}
  };
  useEffect(()=>{
    if(!commute||editing)return;
    void refresh().catch(()=>{});
  },[commute?.patternId,commute?.boardIndex,commute?.alightIndex,editing]);
  const today=dayKey(), ride=account?.rides.find(r=>r.date===today);
  const result=account?.briefing?.journey, plan=result?.plan;
  const pattern=patternFeed?.patterns.find(p=>p.id===(plan?.patternId||commute?.patternId));
  const matchedVehicles:MapVehicle[]=plan?.position&&plan.observedAt&&now-plan.position.recordedAt<=240000?[{...plan.position,destination:commute?.headsign||'',bearing:null}]:[];
  const mapStops=pattern?.stops.filter(s=>s.lat!==null&&s.lon!==null).map(s=>({...s,lat:s.lat!,lon:s.lon!,line:commute!.code}))||[];
  const legacy=()=>{try{return JSON.parse(localStorage.getItem('fogline-v1')||'null');}catch{return null;}};
  const open=(next:View)=>{ if(needsCommute.has(next)&&!commute)return; setEditing(next==='setup'&&!commute); setView(next); };
  const pages:[View,string,string][]=[
    ['tracking','Track ride',account?.tracking?.active?'Automatic updates and ride analysis':'Track a ride and see delay charts'],
    ['today','Today’s plan','When to get ready and leave'],
    ['route','Map and stops','Where this bus runs'],
    ['departures','Departures','The next trips on this ride'],
    ['ask','Ask Fogline','Say if you’re running late'],
    ['briefing','Morning briefing','Read or hear the plan'],
    ['notices','Route notices',result?.research?.assessment?.title || (account?.briefing?.alerts.length?'Service notices are waiting':'Exa and official advisories')],
    ['history','History','Check-ins and what Fogline learned'],
    ['pair','Pair a device','Show a QR code for your phone'],
    ['reminders','Reminders','Wake plan, then live updates'],
  ];
  const startTracking=async(input?:Record<string,unknown>)=>{try{await action('/api/agent/tracking',{...input,action:'start'});setView('tracking');}catch{/* The action helper displays the error. */}};
  const openSetup=(useQuick:boolean)=>{ setQuick(useQuick);setEditing(true);setView('setup'); };
  const showQuick=async(input:Record<string,unknown>,forceResearch=false)=>{if(previewing.current)return;previewing.current=true;const sequence=++previewSequence.current;setPreviewBusy(true);setBusy(true);setError('');try{const result=await request('/api/agent/preview',{...input,forceResearch});if(sequence!==previewSequence.current)return;setTemp({input,commute:result.commute,profile:result.profile,journey:result.journey});setEditing(false);setQuick(false);setView('quick');}catch(e){if(sequence!==previewSequence.current)return;setError((e as Error).message);throw e;}finally{if(sequence===previewSequence.current){previewing.current=false;setPreviewBusy(false);setBusy(false);}}};
  const askQuick=async(text:string)=>{
    if(!temp||previewing.current)throw Error('Wait for the ride to finish checking.');
    previewing.current=true;const sequence=++previewSequence.current;setBusy(true);
    try {
      const result=await request('/api/agent/preview',{...temp.input,text});
      if(sequence!==previewSequence.current)throw Error('This temporary ride has been closed.');
      setTemp({input:{...temp.input,profile:result.profile},commute:result.commute,profile:result.profile,journey:result.journey});
      return result;
    } finally {if(sequence===previewSequence.current){previewing.current=false;setBusy(false);}}
  };
  const home=()=>{if(previewing.current){previewSequence.current++;previewing.current=false;setPreviewBusy(false);setBusy(false);}setView('home');setEditing(false);setQuick(false);setTemp(null);};
  return <div className="app commute-app"><header><a className="brand" href="/" aria-label="Fogline home" onClick={e=>{e.preventDefault();home();}}><span className="mark">≋</span> fogline<span className="brand-dot">.</span></a><span className="mode">YOUR MORNING</span></header><main>
    {!account?<section className="welcome setup"><p className="eyebrow">CONNECT THIS DEVICE</p><h1>A little more time.<br/>A better morning.</h1><p>Scan the QR code from a device that’s already signed in. The first computer can still use the account key.</p>{connecting?<p role="status">Connecting to your saved commute…</p>:<>{scanning&&<QrScanner onCode={code=>{setScanning(false);setBusy(true);setError('');request('/api/agent/session',{},code).then(()=>request('/api/agent/state')).then(next=>{accept(next);setView('home');}).catch(err=>setError(err.message)).finally(()=>setBusy(false));}}/>}<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await request('/api/agent/session',{},key.trim());setKey('');accept(await request('/api/agent/state'));setView('home');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><label>Account key or pairing code<input type="password" autoComplete="off" required={!scanning} value={key} onChange={e=>setKey(e.target.value)} placeholder="Key or 6-character code"/></label><button className="primary" disabled={busy}>{busy?'Connecting…':'Connect this device'}</button></form><button type="button" className="text-button" onClick={()=>setScanning(on=>!on)}>{scanning?'Close camera':'Scan a QR code'}</button><p className="muted">A phone camera can scan the code shown on a signed-in screen. The connection lasts 30 days.</p><details><summary>Where is the account key?</summary><p>In the Fogline folder, run <code>pnpm account</code>. Paste the key shown in the terminal. It also lives in <code>.env</code> as <code>FOGLINE_ACCOUNT_TOKEN</code>.</p></details></>}</section>:<>
      {view!=='home'&&!(view==='setup'&&editing)&&<button className="text-button back-link" onClick={home}>← Home</button>}
      {view==='home'&&<section>
        <div className="setup-hero"><p className="eyebrow">START HERE</p><h1>{commute?'Your commute.':'Set up your commute.'}</h1>{commute?<><p><span className="route-badge">{commute.code}</span> {commute.directionLabel}</p><p>{commute.stopName} → {commute.alightName}</p><p>{account.profile.destination} by {clockInput(account.profile.arriveBy)}</p><p>Quick use plans another ride on this screen only. It is not saved.</p></>:<p>Set up a commute you keep, or use Quick use for a one-time ride. Quick use is not saved.</p>}<div className="hero-actions"><button className="primary quick-use" onClick={()=>openSetup(true)}>Quick use</button><button className="text-button" onClick={()=>openSetup(false)}>{commute?'Edit commute':'Save a regular commute'}</button></div></div>
        {!commute&&legacy()?.entries?.length>0&&<p className="muted">Earlier demo check-ins on this browser stay separate from your real commute.</p>}
        <nav className="page-menu" aria-label="Choose what to open">{pages.map(([id,label,hint])=><button key={id} className={`page-link ${id==='notices'&&result?.research?.assessment ? `exa-${result.research.assessment.level}` : ''}`} disabled={needsCommute.has(id)&&!commute} onClick={()=>open(id)}><span><strong>{label}</strong><small>{needsCommute.has(id)&&!commute?'Available after setup':hint}</small></span><span aria-hidden="true">→</span></button>)}</nav>
      </section>}
      {view==='tracking'&&(account.tracking?<><TrackRide ride={account.tracking} history={account.trackingHistory} now={now} busy={busy} onAction={step=>void action('/api/agent/tracking',{action:step,id:account.tracking!.id}).catch(()=>{})}/>{!account.tracking.active&&<div className="hero-actions">{commute&&<button className="primary" disabled={busy} onClick={()=>void startTracking()}>Track today’s commute</button>}<button className="text-button" onClick={()=>openSetup(true)}>Choose another ride</button></div>}</>:<section className="setup"><p className="eyebrow">TRACK RIDE</p><h1>Follow this morning’s ride.</h1><p>Check every four minutes from 10–20 minutes before leaving, and every three minutes within ten minutes. Earlier checks run every ten minutes. Delay reports appear only when a delay persists or changes.</p><p>Tracking saves this ride’s observations and check-ins so you can return to its report. Your usual commute stays unchanged.</p><div className="hero-actions">{commute&&<button className="primary" disabled={busy} onClick={()=>void startTracking()}>Track today’s commute</button>}<button className="text-button" onClick={()=>openSetup(true)}>Choose a one-time ride</button></div></section>)}
      {view==='setup'&&<CommuteSetup quick={quick} account={account} busy={busy} onCancel={home} onQuick={showQuick} onSave={async input=>{await action('/api/agent/commute',input);setEditing(false);setQuick(false);setView('home');}}/>}
      {view==='quick'&&temp&&<><div className="morning-heading"><p className="eyebrow">QUICK USE · NOT SAVED</p><h1>This ride only.</h1><p><span className="route-badge">{temp.commute.code}</span> {temp.commute.directionLabel}</p><p>{temp.commute.stopName} to {temp.commute.alightName}</p><p>{temp.profile.destination} · Arrive by {clockInput(temp.profile.arriveBy)}{temp.commute.startAt!==undefined?` · Preparation from ${time(temp.commute.startAt)}`:''}</p></div>
        <section className="plan" aria-live="polite"><div className="plan-top"><span className="eyebrow">{temp.journey.day&&temp.journey.day!==today?`NEXT RIDE · ${temp.journey.day}`:'THIS RIDE'}</span><span className="small-label">{temp.journey.plan?.source==='live'?(temp.journey.plan.observedAt&&now-temp.journey.plan.observedAt<=240000?'PROVIDER PREDICTION':'OLD PROVIDER PREDICTION'):temp.journey.plan?'SCHEDULED ESTIMATE':'PLAN STATUS'}</span></div><div className="hero-time">{!temp.journey.plan&&(busy?'Checking…':'No plan fits')}</div>{temp.journey.plan&&<ArrivalStatus arrive={temp.journey.plan.arrive} deadline={temp.journey.plan.deadline} buffer={temp.commute.buffer} destination={temp.profile.destination}/>}<p>{temp.journey.reason}</p>
        {temp.journey.plan&&<div className="plan-times"><div><small>Leave by</small><strong>{time(temp.journey.plan.leave)}</strong></div><div><small>Bus {temp.commute.code} estimate</small><strong>{time(temp.journey.plan.expected)}</strong></div><div><small>Start getting ready</small><strong>{time(temp.journey.plan.start)}</strong></div></div>}
        {!temp.journey.plan&&!!temp.journey.lateOptions?.length&&<div className="arrival-alternatives"><h3>Catchable, but outside your deadline or buffer</h3>{temp.journey.lateOptions.map(option=><div key={option.tripId}><ArrivalStatus arrive={option.arrive} deadline={option.deadline} buffer={temp.commute.buffer} destination={temp.profile.destination}/><p>Bus {time(option.expected)} · leave by {time(option.leave)}</p></div>)}<p>These are alternatives, not a plan that meets your arrival requirement.</p></div>}
        <p>This setup is not saved. Going home drops it, and your commute stays unchanged.</p></section>
        <button className="text-button" disabled={busy} onClick={()=>void showQuick(temp.input,true).catch(()=>{})}>{previewBusy?'Refreshing ride and Exa…':'Refresh this ride'}</button>
        <button className="primary" disabled={busy||!temp.journey.plan||Boolean(account.tracking?.active)} onClick={()=>void startTracking(temp.input)}>Track this ride</button>
        <p className="muted">Track this ride saves its report and keeps checking automatically. Your usual commute stays unchanged.{account.tracking?.active?' Stop your current tracked ride first.':''}</p>
        <AskFogline quick disabled={busy} ask={askQuick}/>
        <ExaResearchReport research={temp.journey.research} loading={previewBusy}/>
        {!!temp.journey.departures?.length&&<section><h2>Departures</h2>{temp.journey.departures.map(d=><div className="feed-row" key={d.tripId}><strong>{temp.commute.code}</strong><span>{temp.commute.headsign}<small>{d.source==='live'?'Live prediction':'Scheduled'}</small></span><span>{time(d.expected)}</span></div>)}</section>}
      </>}
      {view==='today'&&commute&&<><button className="text-button" disabled={busy} onClick={()=>account.tracking?.active?setView('tracking'):void startTracking()}>{account.tracking?.active?'Open tracked ride':'Track this ride · updates & charts'}</button><div className="morning-heading"><p className="eyebrow">{result?.day&&result.day!==today?`NEXT COMMUTE · ${result.day}`:'TODAY'}</p><h1>Your morning, figured out.</h1><p>{account.profile.destination} by {clockInput(account.profile.arriveBy)} · {commute.stopName} to {commute.alightName}</p></div>
        <section className="plan" aria-live="polite"><div className="plan-top"><span className="eyebrow">{ride?.arrived?'JOURNEY COMPLETE':ride?.left?'ON YOUR WAY':ride?.started?'GETTING READY':'START GETTING READY'}</span><span className="small-label">{plan?.source==='live'?(plan.observedAt&&now-plan.observedAt<=240000?'PROVIDER PREDICTION':'OLD PROVIDER PREDICTION'):plan?'SCHEDULED ESTIMATE':'PLAN STATUS'}</span></div><div className="hero-time">{ride?.arrived?'You made it.':ride?.left?'Safe travels.':ride?.started?'You’re getting ready.':plan?time(plan.start):busy?'Checking…':'No plan yet'}</div><p>{ride?.arrived?'Your check-ins help improve the next morning.':ride?.left?'Check in when you board, then when you reach your destination.':result?.reason||'Check the latest schedule to build your plan.'}</p>
        {plan&&!ride?.left&&<div className="plan-times"><div><small>Leave by</small><strong>{time(plan.leave)}</strong></div><div><small>Bus {commute.code} estimate</small><strong>{time(plan.expected)}</strong></div><div><small>Estimated arrival</small><strong>{time(plan.arrive)}</strong></div></div>}
        {!ride?.arrived&&<button className="primary" disabled={busy||(!ride?.started&&(!plan||result?.day!==today))} onClick={()=>void action('/api/agent/checkin',{action:!ride?.started?'start':!ride.left?'leave':!ride.boarded?'board':'arrive'}).catch(()=>{})}>{!ride?.started?'I’m starting now':!ride.left?'I’m out the door':!ride.boarded?'I’m on the bus':'I’ve arrived'} ✓</button>}
        {plan&&!ride?.arrived&&<ArrivalStatus arrive={plan.arrive} deadline={plan.deadline} buffer={commute.buffer} destination={account.profile.destination}/>}
        <p className="muted">Arrival range is not yet calibrated. Times are estimates, not guarantees.</p><div className="plan-foot"><span>{plan?`Be at the stop by ${time(plan.beAtStop)} · ${plan.boardingMargin} min boarding margin. `:''}{account.profile.ready} min to get ready · {commute.buffer} min arrival buffer</span></div></section>
        <div className="page-menu compact">{([['route','Map and stops'],['departures','Departures'],['ask','Ask Fogline']] as [View,string][]).map(([id,label])=><button key={id} className="page-link" onClick={()=>open(id)}><strong>{label}</strong><span aria-hidden="true">→</span></button>)}</div>
      </>}
      {view==='route'&&commute&&<section className="journey-card"><div className="section-title"><h1><span className="route-badge">{commute.code}</span> {commute.directionLabel}</h1><button className="text-button" disabled={busy} onClick={()=>void refresh().catch(()=>{})}>{busy?'Checking…':'Refresh'}</button></div><p>Toward {plan?.headsign||commute.headsign}</p><p className="muted">{plan?.stopsRemaining!=null?`${plan.stopsRemaining} stops before your stop · last confirmed progress`:'Stops remaining are not confirmed for this trip.'}</p><ol className="trip-ends"><li><strong>{commute.stopName}</strong><small>Board · stop {commute.stopId}</small></li><li><strong>{commute.alightName}</strong><small>Get off · stop {commute.alightId}</small></li></ol>{pattern?<><RouteMap stops={mapStops} vehicles={matchedVehicles} shape={pattern.shape} selectedId={commute.stopId} fitKey={pattern.id}/><p className="muted">{matchedVehicles.length?'Vehicle matched to your boarding prediction.':'No confirmed vehicle position for this trip. The route and stops remain available.'}</p><ol className="route-stop-list">{pattern.stops.map(s=><li key={`${s.id}-${s.sequence}`}><b>{s.name}</b><small>Stop {s.code}{s.sequence===(plan?.boardIndex??commute.boardIndex)?' · Board here':s.sequence===(plan?.alightIndex??commute.alightIndex)?' · Get off here':''}</small></li>)}</ol></>:<p>Route map unavailable. Your saved stops are shown above.</p>}</section>}
      {view==='departures'&&commute&&<section><p className="eyebrow">THIS RIDE</p><h1>Departures.</h1>{result?.departures.length?result.departures.map(d=><div className="feed-row" key={d.tripId}><strong>{commute.code}</strong><span>{commute.headsign}<small>{d.source==='live'?'Live prediction':'Scheduled'}</small></span><span>{time(d.expected)}</span></div>):<p>{result?.reason||'No departures loaded.'}</p>}<button className="text-button" disabled={busy} onClick={()=>void refresh().catch(()=>{})}>{busy?'Checking…':'Refresh'}</button></section>}
      {view==='ask'&&commute&&<AskFogline account={account} ask={text=>request('/api/agent/assist',{text})} onAccount={accept}/>}
      {view==='briefing'&&commute&&<section><p className="eyebrow">SAY IT ALOUD</p><h1>Morning briefing.</h1><p>{account.briefing?.speech||'Refresh to hear your plan.'}</p><button className="primary" onClick={()=>{if(account.briefing&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(account.briefing.speech));}}}>Hear my plan</button></section>}
      {view==='notices'&&commute&&<section><p className="eyebrow">ONLY WHEN YOU WANT IT</p><h1>Route notices.</h1>{account.briefing?.alerts.length?<div className="notice"><h2>Service notices</h2>{account.briefing.alerts.map((a,i)=><p key={i}>{a}</p>)}</div>:null}{result?.catalogWarning&&<p className="notice">Schedule refresh unavailable. Using the last verified schedule within its service dates.</p>}
        <h2>Why this recommendation?</h2><p>{result?.modelStatus||'No calibrated arrival range is available yet.'}</p><p>Your boarding margin protects against some early arrival uncertainty. Destination arrival {plan?.destinationSource==='live'?'uses a downstream provider prediction.':'uses the schedule and known delay; later delays remain unknown.'}</p>{plan?.observedAt&&<p>Trip observation: {time(plan.observedAt)}{now-plan.observedAt>240000?' · Old observation—refresh before relying on this estimate.':''}</p>}{result?.alternative&&<p>Earlier option: bus {commute.code} at {time(result.alternative.expected)}. Leave by {time(result.alternative.leave)}.</p>}{result?.notices?.map(n=><p key={n.id}>{n.description||n.header}{/^https:\/\//.test(n.url)&&<> <a href={n.url} target="_blank" rel="noreferrer">Official notice</a></>}</p>)}{result?.rejected?.slice(0,3).map(t=><p key={t.tripId}>{time(t.expected)}: {t.reason}</p>)}
        <ExaResearchReport research={result?.research}/>
        <h2>Official advisories</h2><p className="muted">{result?.advisoryCoverage} Review exact stop and closure hours in the source. These notices do not add invented delay minutes.</p>{result?.advisories?.length?result.advisories.map(a=><article key={a.url}><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a><p>{a.description}</p></article>):<p>No matching route notice was found in the checked pages. This does not confirm that every stop is open.</p>}</section>}
      {view==='history'&&<section><p className="eyebrow">YOUR REAL MORNINGS</p><h1>A rhythm that learns.</h1><div className="stat"><strong>{account.profile.ready}<small> min</small></strong><span>Current preparation estimate</span></div><p className="muted">Completed preparation measurements influence the next morning, not the one already in progress.</p>{account.rides.filter(r=>r.started).length?account.rides.filter(r=>r.started).map(r=><article className="history-row" key={r.date}><h3>{r.date}</h3><p>Started {time(Date.parse(r.started!))}{r.left?` · Left ${time(Date.parse(r.left))}`:''}{r.arrived?` · Arrived ${time(Date.parse(r.arrived))}`:''}</p>{r.measured!==null&&<p>{r.measured} min getting ready · next estimate {r.nextReady} min</p>}</article>):<p>Your first real check-in starts this history.</p>}<details><summary>Decision history</summary>{account.events.slice(0,20).map(e=><p key={e.id}>{e.text}</p>)}</details></section>}
      {view==='pair'&&<section className="setup"><p className="eyebrow">ANOTHER PHONE OR BROWSER</p><h1>Pair a device.</h1><ol className="pair-steps"><li>Create a code on this screen.</li><li>Open the camera on the other phone and scan the QR code.</li><li>Fogline opens there and stays connected for 30 days.</li></ol><button className="primary" disabled={busy} onClick={()=>void request('/api/agent/pair-code',{}).then(setPair).catch(e=>setError(e.message))}>{pair?'Create a new code':'Create a pairing code'}</button>{pair&&<><p className="pair-code" aria-live="polite">{pair.code}</p><QrMark value={pair.scanUrl||pairLink(pair.code)}/><p className="muted">Scan this with the phone camera on the same Wi-Fi. You can also type the code. It works once and expires {time(pair.expires)}.</p></>}<button className="text-button" disabled={busy} onClick={async()=>{try{await request('/api/agent/logout',{});setAccount(null);setEditing(false);setView('home');}catch(e){setError((e as Error).message);}}}>Disconnect this device</button></section>}
      {view==='reminders'&&<section className="setup"><p className="eyebrow">WHILE YOU’RE ASLEEP</p><h1>Reminders.</h1><p>On a travel day, Fogline plans your saved Muni route and checks Exa once when this wake time starts, then notifies you. Ten minutes before departure it checks live 511 predictions and keeps checking every few minutes until you board, notifying you when the estimate changes. This uses your saved stops, not Google Maps or Apple Maps. Push delivery requires ntfy configured on the server. Phone calls are not delivered.</p><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const mins=(k:string)=>String(form.get(k)).split(':').map(Number).reduce((a,b)=>a*60+b,0);void action('/api/agent/settings',{revision:account.revision,configRevision:account.configRevision??0,profile:account.profile,settings:{...account.settings,enabled:form.get('enabled')==='on',wakeStart:mins('wakeStart'),wakeEnd:mins('wakeEnd')}}).catch(()=>{});}}><label className="check-label"><input type="checkbox" name="enabled" defaultChecked={account.settings.enabled}/> Enable the wake-up plan and live departure alerts</label><div className="fields"><label>Wake window starts<input name="wakeStart" type="time" required defaultValue={clockInput(account.settings.wakeStart)}/></label><label>Wake window ends<input name="wakeEnd" type="time" required defaultValue={clockInput(account.settings.wakeEnd)}/></label></div><p className="muted">The wake window must start and end on the same day. Fogline stays quiet between the wake-up plan and the last 10 minutes, so keep this server awake through the morning.</p><button className="primary" disabled={busy}>Save reminders</button></form><PhoneNotifications/></section>}
    </>}
    {error&&<p role="alert" className="notice">{error}</p>}<footer><span className="brand">fogline.</span><p>A clear plan. A little more room for your morning.</p></footer>
  </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
