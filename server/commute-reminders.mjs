import {createHash} from 'node:crypto';
export function planKey(journey) {return createHash('sha256').update(JSON.stringify([journey?.day,journey?.status,journey?.plan?.tripId,journey?.plan?.leave,journey?.rejected?.map(r=>r.tripId)])).digest('hex').slice(0,16);}
export function queueCommuteReminders(state,now,clock,pushEnabled) {
  const j=state.briefing?.journey,ride=state.rides.find(r=>r.date===clock.date);
  if(!j||!ride||j.day!==clock.date||!state.settings.enabled||ride.arrived||ride.boarded||!state.commute.days.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(clock.weekday))||clock.minute<state.settings.wakeStart||clock.minute>=state.settings.wakeEnd)return;
  const p=j.plan,at=+now;
  const enqueue=(kind,text,suffix='')=>{
    const id=`${clock.date}:commute:${kind}${suffix}`;
    const old=state.events.find(e=>e.id===id);
    if(old&&old.delivery?.status!=='cancelled')return;
    if(old)state.events=state.events.filter(e=>e!==old);
    state.events.unshift({id,at:now.toISOString(),kind:'push',text,dryRun:!pushEnabled,noticeKind:kind,planKey:planKey(j),...(pushEnabled?{delivery:{status:'pending'}}:{})});
  };
  if(!p&&['disrupted','no-fit'].includes(j.status))enqueue('change',`${j.reason} Open Fogline to review your options.`,':'+j.status);
  if(p){
    if(!ride.started&&!ride.acknowledged&&at>=p.start)enqueue('prepare',state.briefing.speech);
    if(ride.started&&!ride.left&&at>=p.leave)enqueue('leave',`Leave now for bus ${state.commute.code}. ${j.reason}`);
    if(!ride.noticePlan)ride.noticePlan={tripId:p.tripId,leave:p.leave};
    else if(p.leave<ride.noticePlan.leave-180000||p.tripId!==ride.noticePlan.tripId){enqueue('change','Your commute recommendation changed. '+state.briefing.speech,':'+planKey(j));ride.noticePlan={tripId:p.tripId,leave:p.leave};}
  }
  state.events=state.events.slice(0,500);
}
export function validCommuteNotice(event,state,ride,date,now) {
  const j=state.briefing?.journey;
  if(!j||j.day!==date||event.planKey!==planKey(j)||ride?.arrived||ride?.boarded||+now-Date.parse(event.at)>10*60000)return false;
  if(event.noticeKind==='prepare')return !ride?.started&&!ride?.acknowledged;
  if(event.noticeKind==='leave')return !!ride?.started&&!ride?.left;
  return event.noticeKind==='change';
}
