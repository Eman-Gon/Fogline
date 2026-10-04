import {relevantAdvisories} from './advisories.mjs';
import { sourceFresh, observationFresh, applicableAlerts } from './realtime.mjs';
import { getCatalog } from './gtfs.mjs';
export function compareLines(a, b) {
  const x = String(a.code || a.id), y = String(b.code || b.id);
  const nx = /^\d+/.test(x), ny = /^\d+/.test(y);
  return nx !== ny ? (nx ? -1 : 1) : x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' });
}
const supplemental = [
  ['78X','16th Street Arena Express','Event-only service'], ['KLM Bus','Muni Metro Shuttle','Temporary maintenance shuttle'],
  ['L Bus','Taraval Bus','Replacement service'], ['M Bus','Ocean View Bus','Replacement service'],
  ['S','Shuttle','Schedule needs verification'], ['SF','FIFA shuttle','June event dates only'],
];
export function catalogView(c) {
  const items = Object.values(c.routes).map(r => ({ id:r.id, code:r.code, name:r.name, mode:r.mode, description:r.description, available:r.patterns.length>0 }));
  for (const [code,name,description] of supplemental) {
    const aliases = [code,code.replace(' Bus','BUS'),code.replace(' Bus','')];
    // Rail L/M must not be mistaken for their distinct bus substitutions.
    const candidates = code.endsWith(' Bus') ? aliases.slice(0,2) : aliases;
    if (!items.some(r=>candidates.includes(r.id)||candidates.includes(r.code))) items.push({id:`reference:${code}`,code,name,mode:code==='S'?'Rail':'Bus',description:`${description} · No verified schedule in this feed`,available:false});
  }
  return {items:items.sort(compareLines),version:c.version,start:c.start,end:c.end,error:c.error||null};
}
export function patternView(c, line) {
  const route = c.routes[line];
  if (!route) throw Error('This route has no verified schedule in the current feed.');
  const patterns = route.patterns.map(id=>c.patterns[id]).sort((a,b)=>a.direction.localeCompare(b.direction)||b.stopIds.length-a.stopIds.length);
  return {line:route.id,code:route.code,name:route.name,version:c.version,error:c.error||null,patterns:patterns.map(p=>({...p,stops:p.stopIds.map((id,index)=>({...c.stops[id],line:route.id,sequence:index,pickup:p.pickup[index],dropoff:p.dropoff[index]}))}))};
}
export function dateParts(at, zone='America/Los_Angeles') {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
}
export function dateKey(at,zone='America/Los_Angeles') { const p=dateParts(at,zone); return `${p.year}-${p.month}-${p.day}`; }
export function addDays(day,n) { return new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10); }
export function wallTime(day, minute, zone='America/Los_Angeles') {
  const target=Date.parse(day+'T00:00:00Z')+minute*60000; let result=target;
  for(let i=0;i<4;i++) { const p=dateParts(new Date(result),zone); const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute); const diff=target-rendered; if(!diff)return result;result+=diff; }
  throw Error('That local time does not exist because the clock changes. Choose another deadline.');
}
export function serviceActive(c,service,day) {
  const compact=day.replaceAll('-',''); const exception=c.exceptions.find(e=>e.service_id===service&&e.date===compact);
  if(exception)return exception.exception_type==='1';
  const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(day+'T12:00:00Z').getUTCDay()];
  return c.calendar.some(x=>x.service_id===service&&compact>=x.start_date&&compact<=x.end_date&&x[weekday]==='1');
}
export function validateJourney(input,c) {
  const p=c.patterns[input?.patternId];
  if(!p||p.line!==input?.line)throw Error('Choose a current route and direction.');
  const board=input.boardIndex,alight=input.alightIndex;
  if(!Number.isInteger(board)||!Number.isInteger(alight)||board<0||alight<=board||alight>=p.stopIds.length||p.pickup[board]==='1'||p.dropoff[alight]==='1')throw Error('Choose a boarding stop followed by a destination stop on this journey.');
  return {line:p.line,code:c.routes[p.line].code,patternId:p.id,direction:p.direction,directionLabel:p.label,headsign:p.headsign,boardIndex:board,alightIndex:alight,
    stopId:p.stopIds[board],stopName:c.stops[p.stopIds[board]].name,alightId:p.stopIds[alight],alightName:c.stops[p.stopIds[alight]].name,catalogVersion:c.version};
}
export function scheduledJourneys(c,journey,day) {
  const p=c.patterns[journey.patternId];
  if(!p||p.stopIds[journey.boardIndex]!==journey.stopId||p.stopIds[journey.alightIndex]!==journey.alightId)return [];
  const results=[];
  // GTFS times are elapsed seconds from local noon minus twelve hours, including >24h service.
  for(const serviceDay of [addDays(day,-1),day]) {
    const start=wallTime(serviceDay,720)-12*3600000;
    for(const t of c.routes[p.line].trips) {
      const q=c.patterns[t.pattern];
      if(q.direction!==p.direction||!serviceActive(c,t.service,serviceDay))continue;
      let board=journey.boardIndex,alight=journey.alightIndex;
      if(q.id!==p.id){
        if(q.stopIds.filter(id=>id===journey.stopId).length!==1||q.stopIds.filter(id=>id===journey.alightId).length!==1)continue;
        board=q.stopIds.indexOf(journey.stopId);alight=q.stopIds.indexOf(journey.alightId);
        if(board<0||alight<=board||q.pickup[board]==='1'||q.dropoff[alight]==='1')continue;
      }
      if(!Number.isFinite(t.departures[board])||!Number.isFinite(t.arrivals[alight]))continue;
      const departure=start+t.departures[board]*1000;
      if(dateKey(new Date(departure))!==day)continue;
      results.push({tripId:t.id,serviceDay,boardIndex:board,alightIndex:alight,boardSequence:t.sequences[board],alightSequence:t.sequences[alight],stopIds:q.stopIds,line:q.line,direction:q.direction,patternId:q.id,headsign:q.headsign,departure,arrival:start+t.arrivals[alight]*1000});
    }
  }
  return results.sort((a,b)=>a.departure-b.departure);
}
export function matchingPrediction(item, trip, journey) {
  return item.line===journey.line && item.tripId===trip.tripId && item.serviceDate===trip.serviceDay.replaceAll('-','') && (!item.direction || item.direction===journey.direction);
}
function callFor(calls,trip,stopId,sequence) {
  return calls.find(s=>s.sequence!=null?s.sequence===sequence&&(!s.stopId||s.stopId===stopId):s.stopId===stopId&&trip.stopIds.filter(id=>id===stopId).length===1);
}
export function assessTrip(trip,commute,snapshot,at) {
  const realtime=snapshot?.realtime, reasons=[];
  const updates=realtime?.trips?.items||[];
  const update=updates.find(u=>matchingPrediction(u,trip,commute));
  const position=(realtime?.positions?.items||[]).find(v=>matchingPrediction(v,trip,commute)&&(!update?.vehicle||v.vehicle===update.vehicle));
  const calls=update?.calls||[], board=callFor(calls,trip,commute.stopId,trip.boardSequence), alight=callFor(calls,trip,commute.alightId,trip.alightSequence);
  const updateFresh=sourceFresh(realtime?.trips,at)&&observationFresh(update?.recordedAt,at);
  const positionFresh=sourceFresh(realtime?.positions,at)&&observationFresh(position?.recordedAt,at);
  let blocked=null;
  // Retain known cancellations/skips during an outage instead of reviving them as schedule trips.
  if(update&&['CANCELED','DELETED'].includes(update.relationship))blocked='Trip canceled';
  if([board,alight].some(s=>s?.relationship==='SKIPPED'))blocked='Your boarding or destination stop is skipped';
  if(positionFresh&&Number.isInteger(position.sequence)&&position.sequence>trip.boardSequence)blocked='Bus has already passed your boarding stop';
  const disruptions=applicableAlerts(realtime?.alerts,trip,commute,trip.departure,at);
  for(const a of disruptions) {
    if(a.effect==='NO_SERVICE')blocked='Service is suspended for this journey';
    if(a.effect==='DETOUR'||a.effect==='STOP_MOVED'||(a.selectors.some(s=>s.stopId)&&/STOP\s+(?:TEMP\.?\s+)?(?:MOVED|CLOSED)/i.test(a.header)))blocked='Stop change or detour: review the service notice before traveling';
  }
  if(!updateFresh)reasons.push(update?'Trip observation is old or its timestamp is unavailable.':'No confirmed live trip prediction.');
  const boardTime=updateFresh&&board?.relationship!=='NO_DATA'?(board?.arrival??board?.departure):null;
  const expected=Number.isFinite(boardTime)?boardTime:trip.departure;
  const destinationTime=updateFresh&&alight?.relationship!=='NO_DATA'?(alight?.arrival??alight?.departure):null;
  // Until downstream evidence exists, never assume delay will be recovered.
  const arrival=Number.isFinite(destinationTime)?destinationTime:trip.arrival+Math.max(0,expected-trip.departure);
  const observedAt=Number.isFinite(boardTime)?update.recordedAt:null;
  const stopsRemaining=positionFresh&&Number.isInteger(position.sequence)&&position.sequence<=trip.boardSequence?trip.boardSequence-position.sequence:null;
  if(blocked)reasons.unshift(blocked);
  return {...trip,scheduledDeparture:trip.departure,departure:Math.min(trip.departure,expected),expected,arrival,source:observedAt?'live':'schedule',destinationSource:Number.isFinite(destinationTime)?'live':'schedule',observedAt,vehicle:observedAt&&positionFresh?position.vehicle:null,position:observedAt&&positionFresh&&Number.isFinite(position.lat)&&Number.isFinite(position.lon)?position:null,stopsRemaining,blocked,reasons,disruptions};
}
export function planJourney(c,commute,profile,snapshot,now=new Date(),ride=null,previous=null) {
  const at=now.getTime(); const today=dateKey(now); let day=today;
  const margin=commute.boardingMargin??3;
  for(let i=0;i<8;i++,day=addDays(day,1)) {
    const weekday=new Date(day+'T12:00:00Z').getUTCDay();
    if(!commute.days.includes(weekday))continue;
    const deadline=wallTime(day,profile.arriveBy);
    if(deadline<=at)continue;
    const compact=day.replaceAll('-','');
    if(c.start&&compact<c.start||c.end&&compact>c.end)return {status:'unavailable',day,reason:'The verified schedule does not cover this date.',plan:null,departures:[]};
    const p=c.patterns[commute.patternId];
    if(!p||p.stopIds[commute.boardIndex]!==commute.stopId||p.stopIds[commute.alightIndex]!==commute.alightId)return {status:'setup',day,reason:'Your route changed. Review your commute to reconnect its stops.',plan:null,departures:[]};
    const remaining=day===today&&ride?.started?Math.max(0,profile.ready-(at-Date.parse(ride.started))/60000):profile.ready;
    const walking=day===today&&ride?.left?Math.max(0,profile.walk-(at-Date.parse(ride.left))/60000):profile.walk;
    const assessed=scheduledJourneys(c,commute,day).map(t=>assessTrip(t,commute,snapshot,at));
    const notices=[...new Map(assessed.flatMap(t=>t.disruptions).map(a=>[a.id,a])).values()];
    const rejected=assessed.filter(t=>t.blocked&&t.expected>at).map(t=>({tripId:t.tripId,expected:t.expected,reason:t.blocked}));
    const departures=assessed.filter(t=>!t.blocked&&t.expected>at).map(t=>({...t,beAtStop:t.departure-margin*60000,leave:t.departure-(profile.walk+margin)*60000,start:t.departure-(profile.walk+profile.ready+margin)*60000,arrive:t.arrival+profile.destinationWalk*60000,deadline,boardingMargin:margin,range:null,confidence:'uncalibrated'}));
    const candidates=departures.filter(t=>t.beAtStop-(walking+(ride?.left?0:remaining))*60000>=at&&t.arrive+commute.buffer*60000<=deadline).sort((a,b)=>b.departure-a.departure);
    let selected=candidates[0]||null;
    // Keep the previously advised trip while it remains feasible; don't move departure later silently.
    if(previous?.day===day&&previous.plan){const same=candidates.find(t=>t.tripId===previous.plan.tripId);if(same)selected=same;}
    if(selected&&previous?.day===day&&previous.plan?.tripId===selected.tripId)selected={...selected,start:Math.min(selected.start,previous.plan.start),leave:Math.min(selected.leave,previous.plan.leave)};
    const warnings=[];
    if(!sourceFresh(snapshot?.realtime?.alerts,at,15*60000))warnings.push('Current service alerts could not be confirmed.');
    const plan=selected;
    return {status:plan?'ready':rejected.length?'disrupted':departures.length?'no-fit':'no-service',day,plan,alternative:plan?candidates.find(t=>t.tripId!==plan.tripId&&t.departure<plan.departure)||null:null,departures:departures.slice(0,8),rejected,notices,warnings,advisories:relevantAdvisories(snapshot?.realtime?.advisories,commute,day),advisoryCoverage:snapshot?.realtime?.advisories?.error||snapshot?.realtime?.advisories?.coverage||'Official event notices have not been checked.',modelStatus:'Collecting evidence; no calibrated arrival range yet.',reason:plan?(plan.source==='live'?'Provider prediction matched to this trip and stop.':'Scheduled estimate; no confirmed live prediction for this boarding.'):(rejected.length?'Some trips cannot serve your journey. Review service notices.':departures.length?'No remaining trip fits your deadline and preparation time.':'No remaining scheduled service for this journey on this date.'),catalogWarning:c.error||null};
  }
  return {status:'unavailable',day,plan:null,departures:[],reason:'Choose at least one travel day.'};
}
export async function journeyHandler(url) {
  const c=await getCatalog();
  if(url.pathname==='/api/transit/catalog')return catalogView(c);
  if(url.pathname==='/api/transit/patterns')return patternView(c,url.searchParams.get('line'));
  return null;
}
