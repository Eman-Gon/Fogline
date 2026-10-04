import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCommuteResearch} from './commute-research';
import {freshAccount} from './agent';
const at=Date.parse('2026-10-05T14:00:00Z');
const window={start:at+60*60000,end:at+90*60000};
test('Exa checks coalesce, cache by travel date, and preserve failure status',async()=>{
  let calls=0;
  const research=createCommuteResearch(async(_s,_request,day)=>{calls++;return {checkedAt:new Date().toISOString(),query:day!,sources:[]};},()=>true,()=>at);
  const state=freshAccount();
  const results=await Promise.all([research(state,'2026-10-05',window),research(state,'2026-10-05',window)]);
  assert.equal(calls,1);assert.equal(results[0].status,'ready');assert.match(results[0].message,/does not confirm/);
  await research(state,'2026-10-06',window);assert.equal(calls,1,'future dates are deferred');
  let failures=0;
  const failed=createCommuteResearch(async()=>{failures++;throw Error('private provider payload');},()=>true,()=>at);
  assert.equal((await failed(state,'2026-10-05',window)).status,'unavailable');
  assert.equal((await failed(state,'2026-10-05',window)).sources.length,0);assert.equal(failures,1);
  const absent=createCommuteResearch(async()=>{throw Error('should not call');},()=>false,()=>at);
  assert.match((await absent(state,'2026-10-05',window)).message,/not configured/);
});

test('manual refresh bypasses completed reports and coalesces concurrent refreshes and readers',async()=>{
  let calls=0;
  let finishRefresh!:()=>void;
  const gate=new Promise<void>(resolve=>{finishRefresh=resolve;});
  const research=createCommuteResearch(async(_state,_request,day)=>{
    const call=++calls;
    if(call===2)await gate;
    return {checkedAt:`2026-10-05T14:0${call}:00Z`,query:day,sources:[]};
  },()=>true,()=>at);
  const state=freshAccount(),day='2026-10-05';
  const first=await research(state,day,window);
  assert.equal((await research(state,day,window)).checkedAt,first.checkedAt);
  assert.equal(calls,1);
  const refresh=research(state,day,window,{force:true});
  const secondRefresh=research(state,day,window,{force:true});
  const reader=research(state,day,window);
  assert.equal(calls,2);
  finishRefresh();
  const reports=await Promise.all([refresh,secondRefresh,reader]);
  assert.ok(reports.every(report=>report.checkedAt==='2026-10-05T14:02:00Z'));
  assert.equal((await research(state,day,window)).checkedAt,reports[0].checkedAt);
  assert.equal(calls,2);
  await research(state,day,{...window,end:window.end+60000});
  assert.equal(calls,3,'a different travel window gets its own report');
});

test('a failed manual refresh replaces stale success and can be retried immediately',async()=>{
  let calls=0;
  const research=createCommuteResearch(async(_state,_request,day)=>{
    const call=++calls;
    if(call===2)throw Error('private provider failure');
    return {checkedAt:`2026-10-05T14:0${call}:00Z`,query:day,sources:[]};
  },()=>true,()=>at);
  const state=freshAccount(),day='2026-10-05';
  assert.equal((await research(state,day,window)).status,'ready');
  const failed=await research(state,day,window,{force:true});
  assert.equal(failed.status,'unavailable');
  assert.equal(failed.checkedAt,null);
  assert.equal((await research(state,day,window)).status,'unavailable');
  assert.equal(calls,2,'automatic reads keep the brief failure cache');
  const recovered=await research(state,day,window,{force:true});
  assert.equal(recovered.status,'ready');
  assert.equal(recovered.checkedAt,'2026-10-05T14:03:00Z');
  assert.equal(calls,3);
});


test('research opens exactly two hours before departure on the local travel day and expires at arrival',async()=>{
  let time=window.start-2*60*60000-1,calls=0;
  const research=createCommuteResearch(async()=>{calls++;return {checkedAt:new Date(time).toISOString(),query:'route',sources:[]};},()=>true,()=>time);
  const state=freshAccount(),day='2026-10-05';
  assert.equal((await research(state,day,window,{force:true})).status,'deferred');
  assert.equal(calls,0);
  time++;
  assert.equal((await research(state,day,window)).status,'ready');
  assert.equal(calls,1);
  time=window.start;
  assert.equal((await research(state,day,window)).status,'ready');
  time=window.end;
  assert.equal((await research(state,day,window,{force:true})).status,'deferred');
  assert.equal(calls,2);
});

test('missing windows, previous local days, and skipped rides never search',async()=>{
  let time=Date.parse('2026-10-06T06:30:00Z'); // Oct 5, 11:30 PM in San Francisco.
  let calls=0;
  const research=createCommuteResearch(async()=>{calls++;throw Error('should not search');},()=>true,()=>time);
  const state=freshAccount();
  const tomorrow={start:Date.parse('2026-10-06T07:30:00Z'),end:Date.parse('2026-10-06T08:00:00Z')};
  assert.equal((await research(state,'2026-10-06',tomorrow)).status,'deferred');
  assert.equal((await research(state,'2026-10-05')).status,'deferred');
  time=at;
  state.rides=[{date:'2026-10-05',skipped:true,started:null,left:null,arrived:null,measured:null,nextReady:null,acknowledged:false}];
  assert.equal((await research(state,'2026-10-05',window,{force:true})).status,'deferred');
  assert.equal(calls,0);
});
