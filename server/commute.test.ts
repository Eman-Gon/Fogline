import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgentService, freshAccount } from './agent';
import { fixture, chosen } from './journey-fixture';
test('device sessions persist, commute saves are atomic, and old history survives',async()=>{
 let state:any={...freshAccount(),events:[{id:'old',at:'2026-10-01T12:00:00Z',text:'Existing history',kind:'decision',dryRun:false}]};
 const store={read:async()=>structuredClone(state),save:async(s:any)=>{state=structuredClone(s);}};
 const secret='a-private-test-account-token-that-is-long-enough';const c=fixture();
 const options={file:'unused',store,token:()=>secret,now:()=>new Date('2026-10-05T14:00:00Z'),snapshot:async()=>({alerts:{items:[],stale:false},arrivals:{items:[],fetchedAt:Date.now()}}),catalog:async()=>c};
 let service=createAgentService(options);const server=createServer((req,res)=>{if(!service.handler(req,res))res.writeHead(404).end();});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const send=async(path:string,data?:any,cookie?:string,bearer=false,origin=base)=>{const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:`Bearer ${secret}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,cookie:r.headers.get('set-cookie'),body:await r.json()};};
 try{
  const pair=await send('/api/agent/session',{},undefined,true);assert.equal(pair.status,200);assert.match(pair.cookie!,/HttpOnly/);const cookie=pair.cookie!.split(';')[0];
  service=createAgentService(options);const first=await send('/api/agent/state',undefined,cookie);assert.equal(first.status,200);assert.equal(first.body.sessions,undefined);
  const payload={revision:first.body.revision,profile:first.body.profile,commute:chosen(c)};
  assert.equal((await send('/api/agent/commute',payload,cookie,false,'https://other.example')).status,403);
  const saved=await send('/api/agent/commute',payload,cookie);assert.equal(saved.status,200);assert.equal(saved.body.commute.line,'15');assert.equal(saved.body.profile.stopCode,'10001');assert.equal(saved.body.briefing.source,'schedule');assert.ok(saved.body.events.some((e:any)=>e.id==='old'));
  assert.equal((await send('/api/agent/commute',payload,cookie)).status,409);
  const configPayload={...payload,configRevision:saved.body.configRevision};
  await send('/api/agent/check',{},cookie);
  const edited=await send('/api/agent/commute',configPayload,cookie);assert.equal(edited.status,200);
  assert.equal((await send('/api/agent/commute',configPayload,cookie)).status,409);
  await send('/api/agent/logout',{},cookie);assert.equal((await send('/api/agent/state',undefined,cookie)).status,401);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
