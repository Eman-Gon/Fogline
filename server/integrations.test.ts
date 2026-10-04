import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCorrection, interpretCorrection, researchRoute } from './integrations.ts';
import { freshAccount, createAgentService } from './agent.ts';
import { fileStore } from './store.ts';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const call = (name: string, args: unknown) => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] });
test('untrusted model output cannot execute unknown actions or invalid durations', () => {
  for (const value of [-5, 181, 3.5, '45', null]) assert.deepEqual(decodeCorrection(call('set_tomorrow_ready_minutes', {minutes:value})), {kind:'clarify'});
  assert.deepEqual(decodeCorrection(call('send_email', {})), {kind:'clarify'});
  assert.deepEqual(decodeCorrection({choices:[{message:{content:'Start at 7:10'}}]}), {kind:'clarify'});
  assert.deepEqual(decodeCorrection(call('set_tomorrow_ready_minutes', {minutes:45})), {kind:'ready',minutes:45});
});
test('Mastra sends a bounded tool request and keeps provider error bodies private', async () => {
  const old = process.env.MASTRA_GATEWAY_API_KEY; process.env.MASTRA_GATEWAY_API_KEY = 'test-key';
  try {
    const request: typeof fetch = async (_url, options) => {
      const payload=JSON.parse(String(options?.body));
      assert.equal(payload.tools.length,3); assert.equal(payload.tool_choice,'required');
      return new Response(JSON.stringify(call('set_tomorrow_ready_minutes',{minutes:45})));
    };
    assert.deepEqual(await interpretCorrection('45 minutes tomorrow',request), {kind:'ready',minutes:45});
    await assert.rejects(interpretCorrection('45 minutes',async()=>new Response('SECRET PROVIDER BODY',{status:402})), error => error instanceof Error && error.message.includes('402') && !error.message.includes('SECRET'));
  } finally { if(old===undefined) delete process.env.MASTRA_GATEWAY_API_KEY; else process.env.MASTRA_GATEWAY_API_KEY=old; }
});
test('Exa filters unsafe links, caches queries, and excludes personal profile from search', async () => {
  const old=process.env.EXA_API_KEY;process.env.EXA_API_KEY='test-key';
  try {
    const state=freshAccount();state.settings.line='TEST';state.profile.destination='PRIVATE HOME';let count=0;
    const request: typeof fetch=async(_url,options)=>{count++;assert.ok(!String(options?.body).includes('PRIVATE HOME'));return new Response(JSON.stringify({results:[{url:'javascript:alert(1)',title:'bad'},{url:'https://example.com/alert',title:'Report'}]}));};
    const result=await researchRoute(state,request);assert.equal(result.sources.length,1);assert.equal(result.sources[0].url,'https://example.com/alert');
    await researchRoute(state,request);assert.equal(count,1);
  }finally{if(old===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=old;}
});
test('tomorrow correction survives restart, leaves today unchanged, and applies next day',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fogline-correction-'));const file=join(dir,'account.json');let date=new Date('2026-10-05T14:00:00Z');
  const secret='x'.repeat(40); const options={file,store:fileStore(file),token:()=>secret,now:()=>date,snapshot:async()=>null,interpret:async()=>({kind:'ready' as const,minutes:45})};
  let service=createAgentService(options);const server=createServer((req,res)=>{if(!service.handler(req,res))res.writeHead(404).end();});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
  const request=async(path:string,body:unknown)=>{const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
  try{
    const updated=await request('/api/agent/correct',{text:'I need 45 minutes tomorrow'});assert.equal(updated.profile.ready,35);assert.deepEqual(updated.readyOverride,{date:'2026-10-06',minutes:45});
    service=createAgentService(options);date=new Date('2026-10-06T14:00:00Z');
    const next=await request('/api/agent/check',{});assert.equal(next.profile.ready,45);assert.equal(next.readyOverride,undefined);
    assert.equal(next.events.filter((e:any)=>e.text.includes('Mastra interpreted')).length,1);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
