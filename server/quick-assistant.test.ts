import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgentService, freshAccount } from './agent';
import { fixture, chosen } from './journey-fixture';

const call=(name:string,args:unknown={})=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}});
async function harness() {
 const catalog=fixture(), saved=freshAccount(), secret='quick-assistant-test-private-account-token';
 let writes=0,pushes=0,steps:any[]=[],seenTools:any[]=[];
 const windows:any[]=[];
 const service=createAgentService({file:'unused',token:()=>secret,store:{read:async()=>structuredClone(saved),save:async()=>{writes++;}},now:()=>new Date('2026-10-05T14:00:00Z'),catalog:async()=>catalog,snapshot:async()=>null,
  publish:async()=>{pushes++;return 'id';},pushEnabled:()=>true,
  research:async(_s,day,window)=>{windows.push(window);return {status:'ready',day,checkedAt:'2026-10-05T14:00:00Z',sources:[],message:'Synthetic route report'};},
  chat:async(_messages,tools)=>{seenTools=tools as any[];return steps.shift()??{role:'assistant',content:'The updated ride is based on the schedule.'};}});
 const server=createServer((req,res)=>{if(!service.handler(req,res))res.writeHead(404).end();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const input={commute:chosen(catalog),profile:{...saved.profile,ready:35,walk:6,destinationWalk:5,arriveBy:540},quickTiming:'now'};
 return {input,windows,get writes(){return writes;},get pushes(){return pushes;},get tools(){return seenTools;},script:(calls:any[])=>{steps=[{role:'assistant',tool_calls:calls}];},
  send:async(data:any)=>{const res=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/agent/preview`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:res.status,body:await res.json()};},
  close:()=>new Promise<void>(r=>server.close(()=>r()))};
}
test('Quick use AI works without a saved commute and keeps updates in the returned temporary ride',async()=>{
 const h=await harness();try{
  h.script([call('read_morning_state'),call('report_running_late',{minutes:20})]);
  const out=await h.send({...h.input,text:'I need 20 more minutes to get ready.'});
  assert.equal(out.status,200);assert.equal(out.body.saved,false);assert.equal(out.body.account,undefined);
  assert.equal(out.body.profile.ready,55);assert.equal(out.body.journey.plan.tripId,'t2');
  assert.ok(out.body.toolsUsed.includes('report_running_late'));assert.equal(out.body.journey.research.message,'Synthetic route report');
  const refresh=await h.send({...h.input,profile:out.body.profile});
  assert.equal(refresh.body.profile.ready,55);assert.equal(refresh.body.journey.plan.tripId,'t2');
  assert.equal(h.writes,0);assert.equal(h.pushes,0);
  assert.ok(!h.tools.some(t=>t.function.name==='notify_plan'));
  assert.deepEqual(h.tools.find(t=>t.function.name==='apply_today_exception').function.parameters.properties.kind.enum,['deadline']);
 }finally{await h.close();}
});
test('Quick use can change its own deadline earlier, but cannot invent a time or send notifications',async()=>{
 const h=await harness();try{
  h.script([call('apply_today_exception',{kind:'deadline',arrive_by:'08:30'}),call('notify_plan'),call('apply_today_exception',{kind:'skip'})]);
  const out=await h.send({...h.input,text:'I need to arrive by 8:30 AM.'});
  assert.equal(out.status,200);assert.equal(out.body.profile.arriveBy,510);assert.equal(out.body.journey.plan,null);
  assert.equal(out.body.journey.status,'no-fit');assert.match(out.body.reply,/8:30 AM/);
  assert.equal(h.writes,0);assert.equal(h.pushes,0);assert.equal(out.body.actions.length,1);
  h.script([call('apply_today_exception',{kind:'deadline',arrive_by:'10:00'})]);
  const invalid=await h.send({...h.input,text:'Explain this ride.'});
  assert.equal(invalid.body.profile.arriveBy,540);assert.equal(invalid.body.actions.length,0);
 }finally{await h.close();}
});
test('Quick use rejects invalid chat input before research and caps temporary preparation',async()=>{
 const h=await harness();try{
  assert.equal((await h.send({...h.input,text:' '})).status,400);assert.equal(h.windows.length,0);
  h.script([call('report_running_late',{minutes:90})]);
  const result=await h.send({...h.input,profile:{...h.input.profile,ready:120},text:'I need 90 more minutes.'});
  assert.equal(result.status,200);assert.equal(result.body.profile.ready,120);assert.equal(result.body.actions.length,0);
 }finally{await h.close();}
});
