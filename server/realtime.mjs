import {getTravelAdvisories} from './advisories.mjs';
import rt from 'gtfs-realtime-bindings';
import { fetch511 } from './transit-source.mjs';
import { createTransitCache } from './transit-cache.mjs';

const cached=createTransitCache();
const millis=v=>v===undefined||v===null?null:Number(v)*1000;
export function normalizeRealtime(feed) {
  const sourceAt=millis(feed.header?.timestamp);
  if(feed.header?.incrementality==='DIFFERENTIAL')throw Error('Incremental transit feeds are unsupported.');
  const trips=[],vehicles=[],alerts=[];
  for(const e of feed.entity||[]) {
    if(e.isDeleted)continue;
    const u=e.tripUpdate,v=e.vehicle,a=e.alert;
    const identity=t=>({tripId:t?.tripId||'',serviceDate:t?.startDate||'',startTime:t?.startTime||'',line:t?.routeId||'',direction:t?.directionId==null?'':String(t.directionId),relationship:t?.scheduleRelationship||'SCHEDULED'});
    if(u)trips.push({...identity(u.trip),recordedAt:millis(u.timestamp),vehicle:u.vehicle?.id||'',calls:(u.stopTimeUpdate||[]).map(s=>({stopId:s.stopId||'',sequence:s.stopSequence??null,relationship:s.scheduleRelationship||'SCHEDULED',arrival:millis(s.arrival?.time),departure:millis(s.departure?.time),arrivalDelay:s.arrival?.delay??null,departureDelay:s.departure?.delay??null}))});
    if(v)vehicles.push({...identity(v.trip),recordedAt:millis(v.timestamp),vehicle:v.vehicle?.id||'',sequence:v.currentStopSequence??null,stopId:v.stopId||'',status:v.currentStatus||'IN_TRANSIT_TO',lat:v.position?.latitude??null,lon:v.position?.longitude??null});
    if(a) {
      const translate=t=>(t?.translation||[]).find(x=>x.language==='en')?.text||(t?.translation||[])[0]?.text||'';
      alerts.push({id:e.id,header:translate(a.headerText),description:translate(a.descriptionText),url:translate(a.url),effect:a.effect||'UNKNOWN_EFFECT',periods:(a.activePeriod||[]).map(p=>({start:millis(p.start),end:millis(p.end)})),selectors:(a.informedEntity||[]).map(s=>({agency:s.agencyId||'',line:s.routeId||'',stopId:s.stopId||'',tripId:s.trip?.tripId||'',direction:(s.directionId??s.trip?.directionId)==null?'':String(s.directionId??s.trip?.directionId)}))});
    }
  }
  return {sourceAt,trips,vehicles,alerts};
}
export function sourceFresh(feed,at,maxAge=4*60000) {
  return !!feed&&!feed.error&&!feed.stale&&Number.isFinite(feed.sourceAt)&&at-feed.sourceAt>=-30000&&at-feed.sourceAt<=maxAge;
}
export function observationFresh(value,at,maxAge=4*60000) {
  return Number.isFinite(value)&&at-value>=-30000&&at-value<=maxAge;
}
export async function getRealtimeSnapshot() {
  const load=(endpoint,ttl)=>cached(endpoint,async()=>{
    const bytes=await fetch511(endpoint,{agency:'SF'},'binary');
    const feed=rt.transit_realtime.FeedMessage.toObject(rt.transit_realtime.FeedMessage.decode(bytes),{longs:Number,enums:String});
    const normalized=normalizeRealtime(feed);
    return {...normalized,items:endpoint==='tripupdates'?normalized.trips:endpoint==='vehiclepositions'?normalized.vehicles:normalized.alerts};
  },{ttl,retryAfter:180000});
  const [trips,positions,alerts,advisories]=await Promise.all([load('tripupdates',180000),load('vehiclepositions',180000),load('servicealerts',600000),getTravelAdvisories()]);
  return {trips,positions,alerts,advisories};
}
export function applicableAlerts(feed,trip,journey,at,now=at) {
  if(!feed?.items)return [];
  return feed.items.filter(a=>((!a.periods.length&&sourceFresh(feed,now,15*60000))||a.periods.some(p=>(p.start==null||trip.arrival>=p.start)&&(p.end==null||at<p.end)))&&a.selectors.some(s=>(!s.agency||s.agency==='SF')&&(!s.line||s.line===journey.line)&&(!s.direction||s.direction===journey.direction)&&(!s.tripId||s.tripId===trip.tripId||s.tripId===trip.sourceTripId)&&(!s.stopId||s.stopId===journey.stopId||s.stopId===journey.alightId)));
}
