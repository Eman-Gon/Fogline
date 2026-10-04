import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Persist before requesting: failed loads and restarts consume the same quota.
// Like account storage, this ledger is owned by one server process.
export function createRequestBudget({file, limit=55, now=Date.now}={}) {
  let queue=Promise.resolve();
  return () => {
    const task=queue.then(async()=>{
      await mkdir(dirname(file),{recursive:true});
      let locked=false;
      for(let attempt=0;attempt<40&&!locked;attempt++){try{await mkdir(file+'.lock');locked=true;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(resolve=>setTimeout(resolve,25));}}
      if(!locked)throw Error('Transit budget is busy. Retry later; do not reset the ledger.');
      try {
      let starts=[];
      try {starts=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(starts))throw Error();}
      catch(e){if(e.code!=='ENOENT')throw Error('Transit budget could not be read.');}
      const at=now();starts=starts.filter(t=>Number.isFinite(t)&&at-t<3600000);
      if(starts.length>=limit)throw Error('Transit hourly budget reached. Using available schedule data.');
      starts.push(at);await mkdir(dirname(file),{recursive:true});await writeFile(file+'.next',JSON.stringify(starts),{mode:0o600});await rename(file+'.next',file);
      } finally {await rmdir(file+'.lock');}
    });queue=task.catch(()=>{});return task;
  };
}
let budget, budgetKey;
export async function fetch511(path, params={}, format='json') {
  const key=process.env.SF511_API_KEY;
  if(!key)throw Error('511 is not configured on the server.');
  if(budgetKey!==key){budgetKey=key;budget=createRequestBudget({file:resolve('data/transit',`budget-${createHash('sha256').update(key).digest('hex').slice(0,12)}.json`)});}
  await budget();
  const url=new URL(`https://api.511.org/transit/${path}`);url.searchParams.set('api_key',key);
  for(const [k,v] of Object.entries(params))if(v!==undefined&&v!=='')url.searchParams.set(k,String(v));
  let response;try{response=await fetch(url,{signal:AbortSignal.timeout(path==='datafeeds'?60000:15000)});}catch{throw Error('Transit source could not be reached.');}
  if(!response.ok)throw Error(`Transit source returned HTTP ${response.status}.`);
  return format==='json'?response.json():new Uint8Array(await response.arrayBuffer());
}
