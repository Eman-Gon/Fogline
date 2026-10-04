import {evaluateHistoricalCandidate} from './historical-model.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateArchive} from './observations.mjs';
const directory=resolve(process.env.FOGLINE_OBSERVATIONS_DIR||'data/observations');
let names=[];try{names=await readdir(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
const records=[];for(const name of names.filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort())for(const line of (await readFile(resolve(directory,name),'utf8')).split('\n').filter(Boolean)){try{records.push(JSON.parse(line));}catch{}}
const report=evaluateArchive(records);const buckets={};for(const s of report.scores){const b=buckets[s.horizon]||={count:0,scheduleDistance:0,forecastDistance:0};b.count++;b.scheduleDistance+=s.scheduleDistance;b.forecastDistance+=s.forecastDistance;}const candidate=evaluateHistoricalCandidate(report.scores);delete report.scores;
console.log(JSON.stringify({...report,candidate,horizons:Object.fromEntries(Object.entries(buckets).map(([h,b])=>[h,{count:b.count,meanScheduleDistanceMinutes:b.scheduleDistance/b.count,meanForecastDistanceMinutes:b.forecastDistance/b.count}]))},null,2));
