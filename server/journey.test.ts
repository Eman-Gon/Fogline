import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, chosen } from './journey-fixture';
// @ts-expect-error JS GTFS adapter
import { csv, parseGtfs } from './gtfs.mjs';
// @ts-expect-error JS journey adapter
import { compareLines, catalogView, validateJourney, scheduledJourneys, planJourney, serviceActive, wallTime } from './journey.mjs';
const day='2026-10-05';
const profile={destination:'Work',arriveBy:540,ready:35,walk:6,destinationWalk:5};
test('numeric variants stay together before letter-led routes',()=>{assert.deepEqual(['T','14R','2','FBUS','1X','14','1','714','8BX','8AX','8'].map(id=>({id})).sort(compareLines).map(x=>x.id),['1','1X','2','8','8AX','8BX','14','14R','714','FBUS','T']);});
test('CSV quoting, stops without coordinates, and pattern order survive import',()=>{assert.deepEqual([...csv('a,b\n"one,two","a""b"\n')][1],['one,two','a"b']);const c=fixture();assert.equal(c.stops['10002'].lat,null);assert.deepEqual(c.patterns[chosen(c).patternId].stopIds,['10001','10002','10003']);assert.equal(catalogView(c).items.find((x:any)=>x.code==='78X').available,false);});
test('rejects reversed boarding/alighting and wrong route identity',()=>{const c=fixture(),j=chosen(c);assert.throws(()=>validateJourney({...j,boardIndex:2,alightIndex:0},c));assert.throws(()=>validateJourney({...j,line:'33'},c));});
test('schedule, exceptions and after-midnight service use the correct service day',()=>{const c=fixture(),j=chosen(c);assert.equal(serviceActive(c,'work','2026-10-12'),false);assert.equal(serviceActive(c,'work','2026-10-11'),true);assert.equal(scheduledJourneys(c,j,'2026-10-06').filter((t:any)=>t.tripId==='night').length,1);assert.equal(wallTime('2026-11-02',420),Date.parse('2026-11-02T15:00:00Z'));assert.throws(()=>wallTime('2026-03-08',150));});
test('expired schedules and changed patterns cannot fabricate a trip',()=>{const c=fixture(),j=chosen(c);c.end='20261001';assert.equal(planJourney(c,j,profile,null,new Date('2026-10-05T14:00:00Z')).plan,null);c.end='20261231';assert.equal(planJourney(c,{...j,stopId:'missing'},profile,null,new Date('2026-10-05T14:00:00Z')).status,'setup');});
