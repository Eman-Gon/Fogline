import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionChoices, directionPatterns, boardingStops, getOffStops, stopPair } from '../src/commute-directions';
import type { Pattern } from '../src/commute-types';
// @ts-expect-error JS data adapter
import { stopDetails } from './stop-details.mjs';

const pattern=(id:string,direction:string,label:string,count:number)=>({id,direction,label,stops:Array.from({length:count},(_,i)=>({id:`${id}-${i}`}))} as Pattern);
test('simple stop lists include branch stops and only allow compatible downstream pairs',()=>{
  const make=(id:string,ids:string[])=>({...pattern(id,'1','Inbound',0),stops:ids.map((id,i)=>({id,name:id,code:id,sequence:i,pickup:'0',dropoff:'0',lat:null,lon:null,accessibility:'0'}))});
  const full=make('full',['A','B','C','D']), branch=make('branch',['X','C','D']);
  const patterns=[full,branch];
  assert.deepEqual(boardingStops(patterns).map(s=>s.id),['A','B','X','C']);
  assert.deepEqual(boardingStops([branch,full]).map(s=>s.id),['A','B','X','C']);
  assert.deepEqual(getOffStops(patterns,'X').map(s=>s.id),['C','D']);
  assert.deepEqual(getOffStops(patterns,'A').map(s=>s.id),['B','C','D']);
  const pair=stopPair(patterns,'X','D');
  assert.equal(pair?.pattern.id,'branch');
  assert.equal(pair?.board,0);assert.equal(pair?.alight,2);
  assert.equal(stopPair(patterns,'X','B'),null);
  assert.equal(stopPair(patterns,'D','A'),null);
  assert.equal(stopPair(patterns,'C','D','branch')?.pattern.id,'branch');
  branch.stops[0].pickup='1';
  assert.equal(boardingStops(patterns).some(s=>s.id==='X'),false);
  full.stops[3].dropoff='1';branch.stops[2].dropoff='1';
  assert.equal(getOffStops(patterns,'A').some(s=>s.id==='D'),false);
});
test('stop menus follow the bus, including names that would sort apart',()=>{
  const make=(id:string,ids:string[])=>({...pattern(id,'0','Outbound',0),stops:ids.map((id,i)=>({id,name:id,code:id,sequence:i,pickup:'0',dropoff:'0',lat:null,lon:null,accessibility:'0'}))});
  const outbound=make('full',['Sutter St & Sansome St','Stockton St & Geary St','3rd St & 20th St','Third St & Marin St','Palou Ave & 3rd St']);
  assert.deepEqual(boardingStops([outbound]).map(s=>s.id),['Sutter St & Sansome St','Stockton St & Geary St','3rd St & 20th St','Third St & Marin St']);
  assert.deepEqual(getOffStops([outbound],'Sutter St & Sansome St').map(s=>s.id),['Stockton St & Geary St','3rd St & 20th St','Third St & Marin St','Palou Ave & 3rd St']);
});
test('direction selection isolates inbound/outbound and defaults to the longest trip',()=>{
  const patterns=[pattern('short','1','Inbound',2),pattern('out','0','Outbound',8),pattern('full','1','Inbound',5)];
  assert.deepEqual(directionChoices(patterns),[{id:'1',label:'Inbound'},{id:'0',label:'Outbound'}]);
  assert.deepEqual(directionPatterns(patterns,'1').map(p=>p.id),['full','short']);
  assert.deepEqual(directionPatterns(patterns,'0').map(p=>p.id),['out']);
  assert.deepEqual(directionPatterns(patterns,''),[]);
  assert.deepEqual(patterns.map(p=>p.id),['short','out','full']);
});
test('supplementary details require compatible ID and nearby coordinates; blanks stay unknown',()=>{
  const details={id:'4225',lat:37.775407,lon:-122.449774,shelter:null};
  const source={'4225':details};
  const stop={id:'14225',lat:details.lat,lon:details.lon};
  assert.equal(stopDetails(stop,source),details);
  assert.equal(stopDetails({...stop,lat:37.78},source),null);
  assert.equal(stopDetails({...stop,lat:null},source),null);
  assert.equal(stopDetails({...stop,id:'24225'},source),null);
  assert.equal(stopDetails({...stop,id:'14226'},source),null);
  assert.equal(stopDetails(stop,source).shelter,null);
});
