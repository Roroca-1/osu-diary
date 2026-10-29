import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDb, insertPlay, stats, playsQuery } from '../lib/db.mjs';
import { summarize, sampleExtrema, dayAtNoon } from '../lib/statistics.mjs';
const now = new Date(2026, 9, 29, 12).getTime();
const row = (id, extra={}) => ({id,played_at:now-id*1000,acc:98,pp:100,ar:9.3,bpm:180,mods:'NM',...extra});

test('zero, null and extreme metrics retain honest aggregates and summaries',()=>{
 const s=summarize([row(1,{acc:30,ar:0,bpm:650,pp:0}),row(2,{acc:0,ar:11.3,pp:700}),row(3,{acc:null,pp:null,ar:null,bpm:null})],30,{now});
 assert.equal(s.agg.totalPlays,3);assert.equal(s.agg.avgAcc,15);assert.equal(s.agg.maxPp,700);
 assert.equal(s.ppSeries.length,2);assert.equal(s.arBuckets[0].lower,0);assert.equal(s.arBuckets.at(-1).upper,11.5);
 assert.equal(s.bpmBuckets.at(-1).lower,650);assert.equal(s.series[0].minacc,0);
 assert.ok(s.ppSeries.some(p=>p.pp===0));
 for(const key of ['agg','series','arHist','bpmHist','stream','ppSeries','modCounts'])assert.ok(key in s);
});
test('all bucket counts match the exact database drilldown at each supported precision',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'osu-stats-')),db=openDb(path.join(tmp,'diary.db'));
 try{
  [0,0.1,0.3,9.249999,9.25,9.299999,9.3,9.499999,9.5,9.999999,10,11.3].forEach((ar,i)=>insertPlay(db,{playedAt:now-i*1000,scoreId:100+i,ar,bpm:[0,100,179.999,180,180.999,181,489,650][i%8],acc:i%2?null:30+i,pp:i}));
  insertPlay(db,{playedAt:now-60*86400000,scoreId:200,ar:9.3,bpm:180,acc:99,pp:999});
  for(const range of [null,7,30,90])for(const arStep of [.1,.5])for(const bpmStep of [1,10]){
   const s=stats(db,range,{now,arStep,bpmStep});
   for(const metric of ['ar','bpm'])for(const b of s[metric+'Buckets']){
    const q=playsQuery(db,{from:s.range.from,to:s.range.to,[metric+'Min']:b.lower,[metric+'Max']:b.upper});
    assert.equal(q.total,b.count,`${metric} ${b.lower}-${b.upper}`);
    const known=q.rows.filter(p=>p.acc!=null);assert.equal(known.length,b.accCount);
    if(known.length)assert.equal(b.avgAcc,known.reduce((a,p)=>a+p.acc,0)/known.length);
   }
  }
 } finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
});
test('range endpoints are inclusive/exclusive and future records are excluded',()=>{
 const from=now-7*86400000;
 const s=summarize([row(1,{played_at:from-1}),row(2,{played_at:from}),row(3,{played_at:now}),row(4,{played_at:now+1})],7,{now});
 assert.equal(s.agg.totalPlays,2);assert.deepEqual(s.ppSeries.map(p=>p.id),[2,3]);
});
test('empty and one-day data have finite domains and no fabricated values',()=>{
 const empty=summarize([],30,{now});assert.equal(empty.series.length,0);assert.equal(empty.arBuckets.length,0);assert.equal(empty.agg.avgAcc,null);assert.ok(empty.range.plotTo>empty.range.plotFrom);
 const s=summarize([row(1)],null,{now});assert.equal(s.series.length,1);assert.equal(s.series[0].t,dayAtNoon(s.series[0].d));
});
test('sampling spans the whole period and retains all extrema while aggregates use every score',()=>{
 const rows=Array.from({length:16001},(_,i)=>row(i,{played_at:now-16001000+i*1000,pp:i===8010?10000:i===9000?0:100+i%50,acc:i===5000?1:99,bpm:i===6001?999:i===6002?1:180}));
 const s=summarize(rows,null,{now});
 assert.ok(s.ppSeries.length<=6000);assert.equal(s.points.pp.total,16001);
 for(const id of [0,16000,8010,9000])assert.ok(s.ppSeries.some(p=>p.id===id),`retains ${id}`);
 assert.equal(s.agg.totalPlays,16001);assert.equal(s.agg.maxPp,10000);assert.ok(s.stream.some(p=>p.acc===1));assert.ok(s.stream.some(p=>p.bpm===999));assert.ok(s.stream.some(p=>p.bpm===1));assert.ok(s.stream.length<=6000);
 assert.deepEqual(sampleExtrema(rows,'pp'),sampleExtrema(rows,'pp'));
});
test('local day boundaries and noon remain correct across DST',()=>{
 const code=`import assert from 'node:assert/strict';import {dayRange} from './lib/db.mjs';import {dayAtNoon} from './lib/statistics.mjs';assert.equal((dayRange(null,'2026-03-08').to-dayRange(null,'2026-03-08').from)/3600000,23);assert.equal((dayRange(null,'2026-11-01').to-dayRange(null,'2026-11-01').from)/3600000,25);assert.equal(new Date(dayAtNoon('2026-11-01')).getHours(),12);`;
 const p=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,TZ:'America/Toronto'},encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
