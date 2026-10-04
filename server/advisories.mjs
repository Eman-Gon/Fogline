import {load} from 'cheerio';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='https://www.sfmta.com';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function advisoryDates(title){
  const match=new RegExp(`(${months.join('|')})\\s+(?:(\\d{1,2})(?:[–-](\\d{1,2}))?,?\\s+)?(20\\d{2})`,'i').exec(title);
  if(!match)return null;
  const month=months.findIndex(m=>m.toLowerCase()===match[1].toLowerCase())+1,year=Number(match[4]);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();const first=Number(match[2]||1),end=Number(match[3]||match[2]||last);
  if(first<1||end<first||end>last)return null;
  const prefix=`${year}-${String(month).padStart(2,'0')}-`;
  return {start:prefix+String(first).padStart(2,'0'),end:prefix+String(end).padStart(2,'0'),precision:match[2]?'day':'month'};
}
export function parseAdvisory(html,url){
  const $=load(html),title=$('h1').first().text().trim();
  const routes=$('.field--name-field-routes a').toArray().flatMap(a=>{
    const text=$(a).text().trim(),code=/^([0-9]+[A-Z]*|[A-Z]+)\b/.exec(text)?.[1];
    return code?[(/\bBus\b/.test(text)&&/^[A-Z]$/.test(code))?code+'BUS':code]:[];
  });
  let description='';
  $('script[type="application/ld+json"]').each((_,el)=>{try{const data=JSON.parse($(el).text());const entry=(data['@graph']||[data]).find(e=>e.description&&e.headline);if(entry)description=entry.description;}catch{}});
  return {title,url,routes:[...new Set(routes)],dates:advisoryDates(title),description:String(description).slice(0,1200)};
}
async function page(url){
  const parsed=new URL(url);if(parsed.origin!==origin)throw Error('Unsupported advisory source.');
  const r=await fetch(parsed,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Official advisory page unavailable.');return r.text();
}
let saved, pending, failedAt=0;
export async function getTravelAdvisories(){
  if(failedAt&&Date.now()-failedAt<600000)return {...saved,items:saved?.items||[],error:'Official event advisories are unavailable.',coverage:'Coverage could not be confirmed.'};
  const file=resolve('data/transit/advisories.json');
  if(!saved){try{saved=JSON.parse(await readFile(file,'utf8'));}catch{}}
  if(saved&&Date.now()-saved.fetchedAt<6*3600000)return saved;
  if(pending)return pending;
  pending=(async()=>{
    try{
      const $=load(await page(origin+'/travel-transit-updates'));
      const urls=[...new Set($('a[href^="/travel-updates/"]').toArray().map(a=>new URL($(a).attr('href'),origin).href))].slice(0,10);
      const items=[];let failures=0;
      for(let i=0;i<urls.length;i+=2){const batch=await Promise.allSettled(urls.slice(i,i+2).map(async url=>parseAdvisory(await page(url),url)));for(const r of batch)r.status==='fulfilled'?items.push(r.value):failures++;}
      const next={fetchedAt:Date.now(),items,error:failures?'Some official advisories could not be loaded.':null,coverage:'Latest ten notices listed by SFMTA; this is not a complete closure inventory.'};
      await mkdir(resolve('data/transit'),{recursive:true});await writeFile(file+'.next',JSON.stringify(next));await rename(file+'.next',file);saved=next;return next;
    }catch{failedAt=Date.now();return {...saved,items:saved?.items||[],error:'Official event advisories are unavailable.',coverage:'Coverage could not be confirmed.'};}
  })().finally(()=>{pending=null;});return pending;
}
export function relevantAdvisories(feed,commute,day){
  if(!feed||Date.now()-feed.fetchedAt>24*3600000)return [];
  return feed.items.filter(a=>a.routes.includes(commute.code)&&(!a.dates||day>=a.dates.start&&day<=a.dates.end));
}
