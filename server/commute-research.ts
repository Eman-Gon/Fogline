import type { AccountState } from '../src/agent-types';
import type { CommuteResearch } from '../src/commute-types';
import {researchAssessment, type TravelWindow} from './exa-assessment';
import type {Research} from './integrations';
import type {RouteAssessment} from './exa-assessment';

export function createCommuteResearch(search:(state:AccountState,request:typeof fetch,day:string,window?:TravelWindow)=>Promise<Research & {assessment?:RouteAssessment}> = researchAssessment, configured = () => Boolean(process.env.EXA_API_KEY), now = Date.now) {
  const cache = new Map<string, {until:number;value:CommuteResearch}>();
  const pending = new Map<string, Promise<CommuteResearch>>();
  return async (state:AccountState, day:string,window?:TravelWindow,options:{force?:boolean}={}):Promise<CommuteResearch> => {
    const at = now();
    const localDay = (time:number) => new Intl.DateTimeFormat('en-CA', {timeZone:state.settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
    const deferred = (message:string):CommuteResearch => ({status:'deferred',day,checkedAt:null,sources:[],message});
    if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end <= window.start)
      return deferred('Choose a ride with a confirmed travel window before researching route conditions.');
    if (day !== localDay(at) || localDay(window.start) !== localDay(at) || window.start - at > 2 * 60 * 60000)
      return deferred('Route research opens on the day of your ride, two hours before you leave.');
    if (at >= window.end) return deferred('This ride’s travel window has ended. Choose an upcoming ride for current route research.');
    if (state.rides.some(ride => ride.date === day && (ride.skipped || ride.arrived)))
      return deferred('No route research is needed for a skipped or completed ride.');
    if (!configured()) return {status:'unavailable',day,checkedAt:null,sources:[],message:'Exa research is not configured. Route conditions have not been checked by Exa.'};
    const key=JSON.stringify([state.commute?.code||state.settings.line,state.commute?.directionLabel,state.commute?.headsign||state.settings.headsign,state.commute?.stopId,state.commute?.alightId,day,window]);
    const running=pending.get(key);if(running)return running;
    if(options.force)cache.delete(key);
    const cached=cache.get(key);
    if(cached&&cached.until>at) return cached.value;
    const work=(async()=>{
      let value:CommuteResearch;
      try {
        const result=await search(state,fetch,day,window);
        value={assessment:result.assessment,status:'ready',day,checkedAt:result.checkedAt,sources:result.sources,message:result.assessment?.explanation || (result.sources.length?'Exa found possible route notices. Check the linked dates and affected stops before traveling.':'Exa found no matching reports. This does not confirm that the route is clear.')};
      } catch {
        value={status:'unavailable',day,checkedAt:null,sources:[],message:'Exa research is temporarily unavailable. Your transit plan is still available.'};
      }
      if(cache.size>=100)cache.delete(cache.keys().next().value!);
      cache.set(key,{until:now()+(value.status==='ready'?30:10)*60000,value});
      return value;
    })();
    pending.set(key,work);
    try{return await work;}finally{pending.delete(key);}
  };
}
export const checkCommuteResearch=createCommuteResearch();
