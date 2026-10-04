import {createHash} from 'node:crypto';
import {LIVE_AFTER_MS,LIVE_LEAD_MS} from './agent-schedule.mjs';
export function planKey(journey) {return createHash('sha256').update(JSON.stringify([journey?.day,journey?.status,journey?.plan?.tripId,journey?.plan?.leave,journey?.rejected?.map(r=>r.tripId)])).digest('hex').slice(0,16);}
export function queueCommuteReminders(state,now,clock,pushEnabled) {
  const j=state.briefing?.journey,ride=state.rides.find(r=>r.date===clock.date);
  if(!j||!ride||ride.skipped||j.day!==clock.date||!state.settings.enabled||ride.arrived||ride.boarded||!state.commute.days.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(clock.weekday))||clock.minute<state.settings.wakeStart||clock.minute>=state.settings.wakeEnd)return;
  const p=j.plan,at=+now;
  const enqueue=(kind,text,suffix='')=>{
    const id=`${clock.date}:commute:${kind}${suffix}`;
    const old=state.events.find(e=>e.id===id);
    if(old&&old.delivery?.status!=='cancelled')return;
    if(old)state.events=state.events.filter(e=>e!==old);
    state.events.unshift({id,at:now.toISOString(),kind:'push',text,dryRun:!pushEnabled,noticeKind:kind,planKey:planKey(j),...(pushEnabled?{delivery:{status:'pending'}}:{})});
  };
  if(!p&&['disrupted','no-fit'].includes(j.status))enqueue('change',`${j.reason} Open Fogline to review your options.`,':'+j.status);
  const research=j.research?.message?` Route check: ${j.research.message}`:'';
  const inLive=Boolean(p)&&at>=p.leave-LIVE_LEAD_MS&&at<p.leave+LIVE_AFTER_MS;
  if(!inLive)enqueue('wake',`${state.briefing.speech}${research}`);
  if(p){
    if(!ride.started&&!ride.acknowledged&&at>=p.start)enqueue('prepare',state.briefing.speech);
    if(ride.started&&!ride.left&&at>=p.leave)enqueue('leave',`Leave now for bus ${state.commute.code}. ${j.reason}`);
    if(!ride.noticePlan)ride.noticePlan={tripId:p.tripId,leave:p.leave};
    else if(p.leave<ride.noticePlan.leave-180000||p.tripId!==ride.noticePlan.tripId){enqueue('change','Your commute recommendation changed. '+state.briefing.speech,':'+planKey(j));ride.noticePlan={tripId:p.tripId,leave:p.leave};}
    if(inLive){
      const signature=[p.tripId,p.expected,p.source,p.stopsRemaining??'',p.arrival].join(':');
      if(ride.liveNotice!==signature){
        const prefix=ride.liveNotice?(p.source==='live'?'Live update':'Schedule update'):'Ten minutes out';
        enqueue('live',`${prefix}: ${state.briefing.speech}${ride.liveNotice?'':research}`,':'+signature);
        ride.liveNotice=signature;
      }
    }
  }
  state.events=state.events.slice(0,500);
}
export function validCommuteNotice(event,state,ride,date,now) {
  const j=state.briefing?.journey;
  if(!j||ride?.skipped||j.day!==date||event.planKey!==planKey(j)||ride?.arrived||ride?.boarded||+now-Date.parse(event.at)>10*60000)return false;
  if(event.noticeKind==='prepare')return !ride?.started&&!ride?.acknowledged;
  if(event.noticeKind==='leave')return !!ride?.started&&!ride?.left;
  if(event.noticeKind==='wake')return !ride?.started;
  if(event.noticeKind==='live')return !ride?.boarded;
  return event.noticeKind==='change';
}
