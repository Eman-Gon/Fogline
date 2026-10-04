import { appendFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function createObservationArchive(directory) {
  let queue=Promise.resolve(), loadedDay='', records=[], ids=new Set();
  return {
    append(record) {
      const task=queue.then(async()=>{
        const day=new Date(record.at).toISOString().slice(0,10);
        await mkdir(directory,{recursive:true});
        const file=resolve(directory,day+'.jsonl');
        if(day!==loadedDay){
          let content='';try{content=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
          if(content&&!content.endsWith('\n'))await appendFile(file,'\n');
          records=content.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
          ids=new Set(records.map(r=>r.id));loadedDay=day;
          const cutoff=new Date(record.at-30*86400000).toISOString().slice(0,10);
          for(const name of await readdir(directory))if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&name.slice(0,10)<cutoff)await unlink(resolve(directory,name));
        }
        if(ids.has(record.id))return false;
        if(records.length>=2000)throw Error('Observation archive daily limit reached.');
        await appendFile(file,JSON.stringify(record)+'\n',{mode:0o600});records.push(record);ids.add(record.id);return true;
      });queue=task.catch(()=>{});return task;
    }
  };
}
let archive, archiveDirectory;
export async function recordEvidence(c,commute,snapshot,journey,now) {
  const directory=resolve(process.env.FOGLINE_OBSERVATIONS_DIR||'data/observations');
  if(directory!==archiveDirectory){archive=createObservationArchive(directory);archiveDirectory=directory;}
  const rt=snapshot?.realtime;if(!rt)return;
  const trips=(rt.trips.items||[]).filter(t=>t.line===commute.line);
  const positions=(rt.positions.items||[]).filter(t=>t.line===commute.line);
  const forecasts=(journey?.departures||[]).filter(t=>t.departure>+now).map(t=>({tripId:t.tripId,serviceDay:t.serviceDay,stopId:commute.stopId,sequence:t.boardSequence,scheduled:t.scheduledDeparture??t.departure,expected:t.expected,source:t.source,sourceAt:t.observedAt,model:'provider-or-schedule-v1'}));
  const identity=JSON.stringify([c.version,commute.line,commute.stopId,commute.patternId,rt.trips.sourceAt,rt.positions.sourceAt,journey?.day,journey?.plan?.tripId]);
  await archive.append({id:createHash('sha256').update(identity).digest('hex'),at:+now,version:c.version,line:commute.line,stopId:commute.stopId,patternId:commute.patternId,quality:{trips:rt.trips.error||null,positions:rt.positions.error||null},trips,positions,forecasts});
}
// Passage intervals are evidence of progress, not proof that doors opened or a rider boarded.
export function passageOutcomes(records) {
  const previous=new Map(),outcomes=[],seen=new Set();
  for(const r of [...records].sort((a,b)=>a.at-b.at))for(const p of r.positions||[]){
    if(!p.tripId||!p.serviceDate||!Number.isInteger(p.sequence)||!Number.isFinite(p.recordedAt)||r.at-p.recordedAt>240000||r.at-p.recordedAt<0)continue;
    const key=[r.version,p.line,p.tripId,p.serviceDate,p.vehicle].join(':');const last=previous.get(key);
    if(last&&p.recordedAt<=last.recordedAt)continue;
    if(last&&p.sequence>last.sequence&&p.recordedAt-last.recordedAt<=240000){
      const id=key+':'+last.sequence;
      if(!seen.has(id)){outcomes.push({id,version:r.version,line:p.line,tripId:p.tripId,serviceDate:p.serviceDate,sequence:last.sequence,lower:last.recordedAt,upper:p.recordedAt,kind:last.status==='STOPPED_AT'?'departure-interval':'passage-interval',quality:'inferred'});seen.add(id);}
    }
    previous.set(key,p);
  }
  return outcomes;
}
export function evaluateArchive(records) {
  const outcomes=passageOutcomes(records),scores=[],seen=new Set();
  for(const r of records)for(const f of r.forecasts||[]){
    const o=outcomes.find(o=>o.version===r.version&&o.line===r.line&&o.tripId===f.tripId&&o.serviceDate===f.serviceDay?.replaceAll('-','')&&o.sequence===f.sequence&&o.lower>r.at);
    if(!o)continue;
    const lead=(o.lower-r.at)/60000;if(lead>75||lead<0)continue;const horizon=lead>=45?60:lead>=20?30:lead>=10?15:5;
    const key=o.id+':'+horizon;if(seen.has(key))continue;seen.add(key);
    const distance=t=>Math.max(o.lower-t,0,t-o.upper)/60000;
    scores.push({horizon,source:f.source,scheduleDistance:distance(f.scheduled),forecastDistance:distance(f.expected),serviceDate:o.serviceDate,tripId:o.tripId,cohort:[o.version,o.line,o.sequence,horizon,f.source].join(':'),expected:f.expected,lower:o.lower,upper:o.upper});
  }
  return {records:records.length,independentTripInstances:new Set(outcomes.map(o=>o.tripId+':'+o.serviceDate)).size,inferredPassageIntervals:outcomes.length,scoredForecasts:scores.length,scores,promotion:'disabled',reason:'Inferred passages do not prove boarding or exact arrival. No calibrated rider-facing model is enabled.'};
}
