import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, plan, learn } from './planner.ts';
test('plans backward with enough room for the empirical buffer',()=>{const p=plan(defaults)!;assert.ok(p.arrive+p.buffer<=defaults.arriveBy);assert.equal(p.leave-p.start,35);assert.equal(p.trip-p.leave,6);});
test('delay selects an earlier trip rather than postponing preparation',()=>{const a=plan(defaults)!;const b=plan(defaults,12)!;assert.ok(b.trip<a.trip);assert.ok(b.arrive+b.buffer<=defaults.arriveBy);});
test('feedback changes tomorrow without changing today',()=>{const profile={...defaults};const ready=learn(profile.ready,43);assert.equal(ready,37);assert.equal(profile.ready,35);assert.equal(plan({...profile,ready})!.start,plan(profile)!.start-2);});
test('impossible deadline and missed preparation window return no plan',()=>{assert.equal(plan({...defaults,arriveBy:300}),null);assert.equal(plan(defaults,0,600),null);});
test('invalid measurements cannot poison learning',()=>{for(const n of [-1,0,181,NaN]) assert.throws(()=>learn(35,n));});
