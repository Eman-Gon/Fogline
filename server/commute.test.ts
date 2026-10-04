import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgentService, freshAccount } from './agent';
import { fixture, chosen } from './journey-fixture';
import { createCommuteResearch } from './commute-research';
import type { AccountState } from '../src/agent-types';
import type { TravelWindow } from './exa-assessment';
test('device sessions persist, commute saves are atomic, and old history survives',async()=>{
 let state:any={...freshAccount(),events:[{id:'old',at:'2026-10-01T12:00:00Z',text:'Existing history',kind:'decision',dryRun:false}]};
 const store={read:async()=>structuredClone(state),save:async(s:any)=>{state=structuredClone(s);}};
 const secret='a-private-test-account-token-that-is-long-enough';const c=fixture();
 const options={file:'unused',store,token:()=>secret,now:()=>new Date('2026-10-05T14:00:00Z'),snapshot:async()=>({alerts:{items:[],stale:false},arrivals:{items:[],fetchedAt:Date.now()}}),catalog:async()=>c,research:async(_state:any,day:string)=>({status:'ready' as const,day,checkedAt:'2026-10-05T14:00:00Z',sources:[],message:'Exa checked'})};
 let service=createAgentService(options);const server=createServer((req,res)=>{if(!service.handler(req,res))res.writeHead(404).end();});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const send=async(path:string,data?:any,cookie?:string,bearer=false,origin=base)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:`Bearer ${secret}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,cookie:r.headers.get('set-cookie'),body:await r.json()};};
 try{
  const pair=await send('/api/agent/session',{},undefined,true);assert.equal(pair.status,200);assert.match(pair.cookie!,/HttpOnly/);const cookie=pair.cookie!.split(';')[0];
  service=createAgentService(options);const first=await send('/api/agent/state',undefined,cookie);assert.equal(first.status,200);assert.equal(first.body.sessions,undefined);
  const payload={revision:first.body.revision,profile:first.body.profile,commute:chosen(c)};
  const preview=await send('/api/agent/preview',payload,cookie);assert.equal(preview.status,200);assert.equal(preview.body.saved,false);assert.equal(preview.body.journey.plan.source,'schedule');
  const quickNow=await send('/api/agent/preview',{...payload,profile:{...payload.profile,ready:35,walk:6,arriveBy:540},quickTiming:'now'},cookie);
  assert.equal(quickNow.status,200);assert.equal(quickNow.body.journey.plan.tripId,'t1');assert.equal(quickNow.body.journey.research.message,'Exa checked');
  const quickLater=await send('/api/agent/preview',{...payload,profile:{...payload.profile,ready:35,walk:6},quickTiming:'07:20'},cookie);
  assert.equal(quickLater.status,200);assert.equal(quickLater.body.journey.plan.tripId,'t2');
  const noFit=await send('/api/agent/preview',{...payload,profile:{...payload.profile,ready:35,walk:6,arriveBy:520},quickTiming:'07:20'},cookie);
  assert.equal(noFit.status,200);assert.equal(noFit.body.journey.plan,null);assert.equal(noFit.body.journey.lateOptions[0].tripId,'t2');
  assert.match(noFit.body.journey.reason,/arrival deadline/);

  assert.equal((await send('/api/agent/preview',{...payload,quickTiming:'06:00'},cookie)).status,400);
  const untouched=await send('/api/agent/state',undefined,cookie);assert.equal(untouched.body.revision,first.body.revision);assert.equal(untouched.body.commute,undefined);
  assert.equal((await send('/api/agent/commute',payload,cookie,false,'https://other.example')).status,403);
  const saved=await send('/api/agent/commute',payload,cookie);assert.equal(saved.status,200);assert.equal(saved.body.commute.line,'15');assert.equal(saved.body.profile.stopCode,'10001');assert.equal(saved.body.briefing.source,'schedule');assert.equal(saved.body.briefing.journey.research.message,'Exa checked');assert.equal(saved.body.briefing.journey.research.day,saved.body.briefing.journey.day);assert.ok(saved.body.events.some((e:any)=>e.id==='old'));
  assert.equal((await send('/api/agent/commute',payload,cookie)).status,409);
  const configPayload={...payload,configRevision:saved.body.configRevision};
  await send('/api/agent/check',{},cookie);
  const edited=await send('/api/agent/commute',configPayload,cookie);assert.equal(edited.status,200);
  assert.equal((await send('/api/agent/commute',configPayload,cookie)).status,409);
  const issued=await send('/api/agent/pair-code',{},cookie);assert.equal(issued.status,200);assert.match(issued.body.code,/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);assert.match(issued.body.scanUrl,new RegExp(`\\?pair=${issued.body.code}$`));assert.equal((await send('/api/agent/state',undefined,cookie)).body.pairCode,undefined);
  const wrong=await fetch(base+'/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Authorization:'Bearer ABC-DEF'}});assert.equal(wrong.status,401);
  const paired=await fetch(base+'/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Authorization:`Bearer ${issued.body.code}`}});assert.equal(paired.status,200);assert.match(paired.headers.get('set-cookie')||'',/HttpOnly/);
  assert.equal((await fetch(base+'/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Authorization:`Bearer ${issued.body.code}`}})).status,401);
  await send('/api/agent/logout',{},cookie);assert.equal((await send('/api/agent/state',undefined,cookie)).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('temporary ride previews return Exa reports and manual refresh reruns research without account writes or pushes',async()=>{
 const c=fixture(),secret='a-private-preview-account-token-that-is-long-enough';
 const saved:AccountState={...freshAccount(),profile:{...freshAccount().profile,destination:'Saved private destination',ready:90},commute:chosen(c)};
 let writes=0,pushes=0,clock=new Date('2026-10-05T14:00:00Z');
 const requests:{state:AccountState;day:string;window?:TravelWindow}[]=[];
 const research=createCommuteResearch(async(state,_request,day,window)=>{
   requests.push({state:structuredClone(state),day,window});
   return {checkedAt:`2026-10-05T14:0${requests.length}:00Z`,query:day,sources:[]};
 },()=>true,()=>clock.getTime());
 const service=createAgentService({file:'unused',store:{read:async()=>structuredClone(saved),save:async()=>{writes++;}},token:()=>secret,now:()=>clock,snapshot:async()=>null,catalog:async()=>c,research,pushEnabled:()=>true,publish:async()=>{pushes++;return 'unexpected';}});
 const server=createServer((req,res)=>{if(!service.handler(req,res))res.writeHead(404).end();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const payload={profile:{...freshAccount().profile,destination:'Temporary destination'},commute:chosen(c)};
 const send=async(data:unknown)=>{const r=await fetch(base+'/api/agent/preview',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
 try{
   const first=await send(payload);
   assert.equal(first.status,200);assert.equal(first.body.saved,false);
   assert.equal(first.body.journey.research.status,'ready');
   assert.equal(first.body.journey.research.checkedAt,'2026-10-05T14:01:00Z');
   assert.deepEqual(requests[0].state.commute,first.body.commute);
   assert.equal(requests[0].state.profile.destination,'Temporary destination');
   assert.equal(requests[0].state.profile.ready,payload.profile.ready);
   assert.equal(requests[0].state.settings.line,first.body.commute.line);
   assert.equal(requests[0].state.settings.headsign,first.body.commute.headsign);
   assert.deepEqual(requests[0].state.rides,[]);
   assert.equal(requests[0].day,first.body.journey.day);
   assert.deepEqual(requests[0].window,{start:first.body.journey.plan.leave,end:first.body.journey.plan.arrive});
   await send(payload);assert.equal(requests.length,1,'initial reads use the completed report');
   const refreshed=await send({...payload,forceResearch:true});
   assert.equal(refreshed.status,200);assert.equal(requests.length,2);
   assert.equal(refreshed.body.journey.research.checkedAt,'2026-10-05T14:02:00Z');
   assert.equal((await send({...payload,forceResearch:'true'})).status,400);
   assert.equal(requests.length,2);
   clock=new Date('2027-01-04T14:00:00Z'); // Outside the fixture's schedule coverage.
   const noPlan=await send({...payload,forceResearch:true});
   assert.equal(noPlan.status,200);assert.equal(noPlan.body.journey.plan,null);
   assert.equal(noPlan.body.journey.research.status,'deferred');
   assert.equal(requests.length,2,'no travel window means no web research');
   assert.equal(writes,0);assert.equal(pushes,0);
   assert.equal(saved.profile.destination,'Saved private destination');assert.equal(saved.profile.ready,90);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
