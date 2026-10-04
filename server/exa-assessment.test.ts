import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessEvidence,researchAssessment} from './exa-assessment';
import {freshAccount} from './agent';
const window={start:Date.parse('2026-10-05T15:00:00-07:00'),end:Date.parse('2026-10-05T16:00:00-07:00')};
const evidence='Route 15 is rerouted due to the festival from 1 PM to 5 PM on October 5, 2026.';
const source={url:'https://www.sfmta.com/travel-updates/test',text:evidence};
const finding={title:'Festival reroute',explanation:'The festival overlaps the journey.',url:source.url,evidence,routeRelevant:true,kind:'reroute',start:'2026-10-05T13:00:00-07:00',end:'2026-10-05T17:00:00-07:00'};
const run=(changes:any={},sources=[source])=>assessEvidence({findings:[{...finding,...changes}]},sources,window);
test('festival 1–5 conflicts with a 4 PM arrival, but an event alone is amber',()=>{
  assert.equal(run().level,'red');assert.equal(run({kind:'event'}).level,'amber');
  assert.equal(run({end:'2026-10-05T14:00:00-07:00'}).level,'unknown');
  assert.equal(run({start:'2026-10-04T13:00:00-07:00',end:'2026-10-04T17:00:00-07:00'}).level,'unknown');
});
test('missing evidence, unknown hours, and unrelated reports cannot turn red or green',()=>{
  assert.equal(run({evidence:'Invented evidence with enough characters'}).level,'unknown');
  assert.equal(run({start:'',end:''}).level,'unknown');
  assert.equal(run({routeRelevant:false}).level,'unknown');
  assert.equal(run({},[]).level,'unknown');
  assert.equal(assessEvidence({findings:[]},[],window).level,'unknown');
});
test('green needs explicit normal-service evidence for the entire window; disruptions take precedence',()=>{
  const quote='Route 15 operates normally throughout October 5, 2026.';
  const normal={...finding,kind:'normal_service',evidence:quote};
  const normalSource={...source,text:quote};
  assert.equal(assessEvidence({findings:[normal]},[normalSource],window).level,'green');
  assert.equal(assessEvidence({findings:[{...normal,start:''}]},[normalSource],window).level,'unknown');
  assert.equal(assessEvidence({findings:[normal,finding]},[{...source,text:quote+' '+evidence}],window).level,'red');
  assert.equal(run({url:'javascript:alert(1)'}).level,'unknown');
});
test('an inconclusive report hides sources without confirmed overlapping impacts',async()=>{
  const previous=process.env.EXA_API_KEY;process.env.EXA_API_KEY='test-only';
  try{
    const request:typeof fetch=async()=>new Response(JSON.stringify({answer:{findings:[]},citations:[
      {...source,title:'Route notices'}, {...source,title:'Duplicate'},
      {url:'javascript:alert(1)',title:'Unsafe'}, {url:'https://user:password@example.com/private',title:'Credentials'},
    ]}),{status:200,headers:{'Content-Type':'application/json'}});
    const report=await researchAssessment(freshAccount(),request,'2026-10-05',window);
    assert.equal(report.assessment.level,'unknown');
    assert.deepEqual(report.assessment.findings,[]);
    assert.equal(report.sources.length,0);
    assert.match(report.assessment.explanation,/not an all-clear/);
  }finally{if(previous===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=previous;}
});


test('non-overlapping and undated notices are excluded even alongside a valid disruption',()=>{
  const report=assessEvidence({findings:[finding,{...finding,title:'Old report',start:'2026-10-04T13:00:00-07:00',end:'2026-10-04T17:00:00-07:00'},{...finding,title:'Unknown hours',start:'',end:''},{...finding,title:'Starts after arrival',start:'2026-10-05T16:00:00-07:00'}]},[source],window);
  assert.deepEqual(report.findings.map(f=>f.title),['Festival reroute']);
});
