import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {deriveAchievements,recordAchievements,projectRoute,safeAchievements,distanceKm} from '../lib/race-milestones.ts';
import {handleCrewRequest} from '../lib/crew-room.ts';

const context={module:{exports:{}},Number,Date,Math,Map,Object};
vm.runInNewContext(readFileSync(new URL('../public/race-milestones.js',import.meta.url),'utf8'),context);
const api=context.module.exports;
const raw=readFileSync(new URL('../public/data/route.geojson',import.meta.url));
const geometry=JSON.parse(raw);
const routeCopy=JSON.parse(readFileSync(new URL('../public/data/milestone-route.json',import.meta.url),'utf8'));
const milestones=api.build(geometry);
let distance=0;
const path=routeCopy.coordinates.map(([lng,lat],i,all)=>{
  if(i)distance+=distanceKm({lat:all[i-1][1],lng:all[i-1][0]},{lat,lng});
  return {lat,lng,km:distance};
});
const atKm=km=>{
  const i=path.findIndex(p=>p.km>=km),a=path[Math.max(0,i-1)],b=path[i],t=(km-a.km)/(b.km-a.km||1);
  return {lat:a.lat+t*(b.lat-a.lat),lng:a.lng+t*(b.lng-a.lng)};
};
const START=Date.parse('2026-11-13T23:59:00Z'),AT=START+6*60*60_000;
const event={id:35950,start:new Date(START).toISOString(),active:true};
const report=(km,at)=>({...atKm(km),recordedAt:new Date(at).toISOString()});
const participant=(p,bib='247')=>({...p,bib,name:bib==='247'?'Emily Simmons':'Jeff Simmons',updatedAt:p.recordedAt});
const crossing=(milestone='marathon',bib='247',now=AT+(milestone==='gold'&&bib==='247'?4:2)*60_000)=>{
  const km=milestones.find(p=>p.id===milestone).routeKm;
  const reports=[report(km-.1,AT),report(km+.1,AT+2*60_000)];
  if(milestone==='gold'&&bib==='247')reports.push(report(km+.2,AT+4*60_000));
  return deriveAchievements(event,participant(reports.at(-1),bib),reports,now).find(p=>p.milestoneId===milestone);
};
const routeCrossing=(km,now=AT+4*60_000,bib='247')=>{
  const reports=[report(km-.1,AT),report(km+.1,AT+2*60_000),report(km+.2,AT+4*60_000)];
  return deriveAchievements(event,participant(reports.at(-1),bib),reports,now).find(p=>p.milestoneId===`km-${km}`);
};

test('official silver/gold radii and the separate route marathon are located on the supplied route',()=>{
  assert.equal(routeCopy.sourceSha256,createHash('sha256').update(raw).digest('hex'),'regenerate server projection data if the route changes');
  assert.equal(milestones.length,12);
  assert(Math.abs(milestones.find(p=>p.id==='marathon').routeKm-42.195)<1e-6);
  for(const [id,radius] of [['silver',48.28032],['gold',96.56064]]){
    const point=milestones.find(p=>p.id===id);
    assert.equal(point.radiusKm,radius);
    assert(Math.abs(point.crowKm-radius)<1e-6);
    assert(Math.abs(api.distanceKm(api.origin,point)-radius)<1e-6);
    assert.equal(point.estimated,true);
    assert(Math.abs(projectRoute(point).routeKm-point.routeKm)<1e-5);
  }
  assert(milestones.find(p=>p.id==='silver').routeKm>42.195);
  assert(Math.abs(milestones.find(p=>p.id==='gold').routeKm-105.2546)<.1);
  for(const km of [50,60,70,80,90,100,110,120,123]){
    const point=milestones.find(p=>p.id===`km-${km}`);
    assert.equal(point.basis,'route');assert.equal(point.thresholdKm,km);
    assert.equal(point.posterId,point.id);assert.equal(point.hiddenUntilReached,true);
    assert(Math.abs(point.routeKm-km)<1e-6);
    assert(Number.isFinite(point.crowKm)&&point.crowKm>0&&point.crowKm<km,'both radial and on-foot route metrics are present');
  }
  assert.equal(api.build([]).length,0);
});

test('each runner gets their own bracketed approximate crossing and stable event/milestone ID',()=>{
  for(const bib of ['247','133'])for(const id of ['marathon','silver','gold']){
    const record=crossing(id,bib);
    assert(record);
    assert.equal(record.runnerId,bib==='247'?'emily':'jeff');
    assert.equal(record.id,`35950:${record.runnerId}:${id}`);
    assert.equal(record.estimated,true);
    assert.equal(record.backfilled,false);
    assert(Date.parse(record.crossedAt)>AT&&Date.parse(record.crossedAt)<AT+2*60_000);
    if(id==='marathon')assert(Math.abs(Date.parse(record.crossedAt)-(AT+60_000))<1000);
    assert.equal(record.evidence.beforeAt,new Date(AT).toISOString());
    assert.equal(record.firstSeenBeyondAt,new Date(AT+2*60_000).toISOString());
    assert(!JSON.stringify(record).includes('lat'));
  }
});

test('backfill distinguishes estimated crossing times from a first observed report beyond the boundary',()=>{
  const bracketed=crossing('marathon','247',AT+60*60_000);
  assert.equal(bracketed.backfilled,true);
  assert(bracketed.crossedAt);
  const reports=[report(43,AT),report(43.1,AT+2*60_000)];
  const observed=deriveAchievements(event,participant(reports.at(-1)),reports,AT+3*60_000).find(p=>p.milestoneId==='marathon');
  assert.equal(observed.crossedAt,null);
  assert.equal(observed.firstSeenBeyondAt,reports[0].recordedAt);
  assert.equal(observed.evidence.beforeAt,null);
  assert.equal(observed.backfilled,true);
});

test('wrong identities, wrong events, invalid times, isolated jumps and off-route marathon reports cannot earn a crossing',()=>{
  const reports=[report(42.1,AT),report(42.3,AT+2*60_000)],p=participant(reports.at(-1));
  for(const badEvent of [{...event,id:35951},{...event,active:false},{...event,start:'2025-11-13T23:59:00Z'}])assert.deepEqual(deriveAchievements(badEvent,p,reports,AT+3*60_000),[]);
  for(const bad of [{...p,bib:'210',name:'Matt Leese'},{...p,name:'Another Runner'}])assert.deepEqual(deriveAchievements(event,bad,reports,AT+3*60_000),[]);
  assert.deepEqual(deriveAchievements(event,p,reports,START-1),[]);
  const jumped=[report(42,AT),report(100,AT+60_000)];
  assert.deepEqual(deriveAchievements(event,participant(jumped.at(-1)),jumped,AT+2*60_000),[]);
  const detached=reports.map(r=>({...r,lat:r.lat+.02}));
  assert(!deriveAchievements(event,participant(detached.at(-1)),detached,AT+3*60_000).some(r=>r.milestoneId==='marathon'));
  const late=reports.map((r,i)=>({...r,recordedAt:new Date(START+25*60*60_000+i*60_000).toISOString()}));
  assert.deepEqual(deriveAchievements(event,participant(late.at(-1)),late,START+26*60*60_000),[]);
});

function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_flimsy_betty_ross.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){const result=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(result.changes)}};}};},async batch(queries){return queries.map(q=>/^SELECT\b/i.test(q.sql)?{results:sqlite.prepare(q.sql).all(...q.args),meta:{changes:0}}:{results:[],meta:{changes:Number(sqlite.prepare(q.sql).run(...q.args).changes)}});}};
  const token='A'.repeat(43),config={viewHash:'b'.repeat(64),publishHash:createHash('sha256').update(token).digest('hex'),expiresAt:START+48*60*60_000};
  const metadata={meetup:{id:'keep-me'},celebrations:{'km-60':AT},addedEvPointIds:['ev-test'],completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'met',at:new Date(AT).toISOString()}}};
  sqlite.prepare('INSERT INTO crew_rooms (view_hash,publish_hash,created_at,expires_at,updated_at,sharing,lat,lng,accuracy,position_recorded_at,position_updated_at,bib,meetup_json,google_maps_url) VALUES (?,?,?,?,?,1,52.1,-1.1,10,?,?,?, ?,?)')
    .run(config.viewHash,config.publishHash,START,config.expiresAt,AT,AT,AT,'247 / 133',JSON.stringify(metadata),'https://maps.app.goo.gl/example');
  return {db,sqlite,config,metadata,token};
}

test('durable records deduplicate concurrent polls and preserve all GPS, checkpoint, EV and poster fields',async()=>{
  const f=database(),before=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  const emily=crossing(),jeff=crossing('marathon','133');
  await Promise.all([recordAchievements(f.db,f.config,[emily],AT+3*60_000),recordAchievements(f.db,f.config,[jeff],AT+3*60_000)]);
  const repeated=await recordAchievements(f.db,f.config,[{...emily,recordedAt:new Date(AT+5*60_000).toISOString()}],AT+5*60_000);
  assert.equal(repeated.persisted,true);assert.equal(repeated.records.length,2);
  assert.equal(repeated.records.find(r=>r.runnerId==='emily').recordedAt,emily.recordedAt);
  const after=f.sqlite.prepare('SELECT * FROM crew_rooms').get(),{raceAchievements,...metadata}=JSON.parse(after.meetup_json);
  assert.deepEqual(metadata,{...f.metadata,celebrations:{...f.metadata.celebrations,marathon:AT+3*60_000}});
  assert.equal(raceAchievements.length,2);
  assert(after.updated_at>before.updated_at,'the changed ledger has a new snapshot version');
  for(const key of ['lat','lng','accuracy','position_recorded_at','position_updated_at','sharing','expires_at','google_maps_url'])assert.equal(after[key],before[key]);
});

test('the shared marathon poster waits for both recorded crossings in either arrival order',async()=>{
  for(const firstBib of ['247','133']){
    const f=database(),first=crossing('marathon',firstBib),secondBib=firstBib==='247'?'133':'247';
    const second=crossing('marathon',secondBib),now=AT+5*60_000;
    await recordAchievements(f.db,f.config,[first],now);
    await recordAchievements(f.db,f.config,[],now+1000);
    let metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
    assert.deepEqual(metadata.raceAchievements,[first]);
    assert.equal(metadata.celebrations.marathon,undefined,'neither runner alone reveals the shared poster');
    await recordAchievements(f.db,f.config,[{...second,recordedAt:new Date(now+60_000).toISOString()}],now+2000);
    metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
    assert.equal(metadata.celebrations.marathon,undefined,'a future second record does not satisfy the gate');
    const result=await recordAchievements(f.db,f.config,[second],now+3000);
    metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
    assert.equal(result.persisted,true);
    assert.deepEqual(result.records,safeAchievements([first,second]));
    assert.equal(metadata.celebrations.marathon,now+3000);
    assert.deepEqual(metadata.raceAchievements,result.records,'release and both original crossing records are committed together');
    const version=f.sqlite.prepare('SELECT updated_at FROM crew_rooms').get().updated_at;
    await recordAchievements(f.db,f.config,[second],now+4000);
    assert.equal(f.sqlite.prepare('SELECT updated_at FROM crew_rooms').get().updated_at,version,'repeated polls do not replay or rewrite the release');
  }
});

test('ingestion repairs a missing shared marathon release from both historical records and archives it without locations',async()=>{
  const f=database(),now=AT+20*60_000;
  const reports=[report(43,AT),report(43.1,AT+2*60_000)];
  const jeff=deriveAchievements(event,participant(reports.at(-1),'133'),reports,AT+3*60_000).find(p=>p.milestoneId==='marathon');
  assert.equal(jeff.crossedAt,null,'historical evidence does not invent an exact crossing time');
  const records=safeAchievements([crossing(),jeff]);
  f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = json_set(meetup_json, '$.raceAchievements', json(?))").run(JSON.stringify(records));
  const before=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  const result=await recordAchievements(f.db,f.config,[],now);
  assert.equal(result.persisted,true);assert.deepEqual(result.records,records);
  const after=f.sqlite.prepare('SELECT * FROM crew_rooms').get(),metadata=JSON.parse(after.meetup_json);
  assert.deepEqual(metadata.raceAchievements,records,'retired Jeff’s historical record and all estimated times remain unchanged');
  assert.equal(metadata.celebrations.marathon,now,'repair records detection time separately from historical crossing evidence');
  for(const key of ['lat','lng','accuracy','position_recorded_at','position_updated_at','sharing','expires_at','google_maps_url'])assert.equal(after[key],before[key]);
  const read=async at=>(await handleCrewRequest(new Request('https://crew.example.test/api/crew?public=1'),f.db,at,f.config)).json();
  const active=await read(now+1000);
  assert.deepEqual(active.room.releases,[{id:'km-60',releasedAt:new Date(AT).toISOString()},{id:'marathon',releasedAt:new Date(now).toISOString()}]);
  const ended=await read(f.config.expiresAt);
  assert.equal(ended.room,null);assert.deepEqual(ended.releases,active.room.releases);assert.deepEqual(ended.achievements.records,records);
  const scrubbed=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for(const key of ['lat','lng','accuracy','position_recorded_at','position_updated_at','google_maps_url'])assert.equal(scrubbed[key],null);
  assert.deepEqual(JSON.parse(scrubbed.meetup_json),{raceAchievements:records,celebrations:metadata.celebrations});
  assert(!JSON.stringify(ended).includes('maps.app.goo.gl'));
  assert(!JSON.stringify(ended).includes(f.config.publishHash));
});

test('an authorised manual marathon release retains its original timestamp when both crossings arrive',async()=>{
  const f=database(),releasedAt=AT+3*60_000,now=AT+10*60_000;
  const response=await handleCrewRequest(new Request('https://crew.example.test/api/crew',{method:'PATCH',headers:{Origin:'https://crew.example.test',Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify({celebration:'marathon'})}),f.db,releasedAt,f.config);
  assert.equal(response.status,200);
  assert.equal((await response.json()).releases.find(p=>p.id==='marathon').releasedAt,new Date(releasedAt).toISOString());
  await recordAchievements(f.db,f.config,[crossing(),crossing('marathon','133')],now);
  const before=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  assert.equal(JSON.parse(before.meetup_json).celebrations.marathon,releasedAt);
  await recordAchievements(f.db,f.config,[],now+1000);
  const after=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  assert.equal(after.meetup_json,before.meetup_json);assert.equal(after.updated_at,before.updated_at);
});

test('public history survives sharing expiry with only safe achievement facts and explicit revocation removes it',async()=>{
  const f=database();
  const record=crossing();
  await recordAchievements(f.db,f.config,[{...record,lat:52,lng:-1,private:'secret'}],AT+3*60_000);
  const read=at=>handleCrewRequest(new Request('https://crew.example.test/api/crew?public=1'),f.db,at,f.config);
  const active=await (await read(AT+4*60_000)).json();
  assert.equal(active.room.achievements.records.length,1);
  const ended=await (await read(f.config.expiresAt)).json();
  assert.equal(ended.status,'ended');assert.equal(ended.room,null);assert.equal(ended.achievements.records.length,1);
  const row=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for(const key of ['lat','lng','accuracy','position_recorded_at','position_updated_at','google_maps_url'])assert.equal(row[key],null);
  assert.equal(row.sharing,0);
  assert.deepEqual(Object.keys(JSON.parse(row.meetup_json)),['raceAchievements','celebrations']);
  assert.deepEqual(ended.releases,[{id:'km-60',releasedAt:new Date(AT).toISOString()}],'released posters remain replayable after GPS sharing ends');
  assert(!row.meetup_json.includes('secret'));assert(!row.meetup_json.includes('lat'));
  await read(f.config.expiresAt+1000);
  assert.equal(f.sqlite.prepare('SELECT updated_at FROM crew_rooms').get().updated_at,row.updated_at);
  const stopped=await recordAchievements(f.db,f.config,[crossing('silver')],f.config.expiresAt+1000);
  assert.equal(stopped.records.length,1);
  const revoked=await handleCrewRequest(new Request('https://crew.example.test/api/crew',{method:'DELETE',headers:{Origin:'https://crew.example.test',Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:'{}'}),f.db,f.config.expiresAt+2000,f.config);
  assert.equal(revoked.status,200);
  assert.equal(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json,null);
});

test('50 through 123 km are Emily-only route crossings, independent of crow-flight medals',()=>{
  for(const km of [50,60,70,80,90,100,110,120,123]){
    const record=routeCrossing(km);
    assert(record);assert.equal(record.id,`35950:emily:km-${km}`);
    assert.equal(record.bib,'247');assert.equal(record.backfilled,false);
    assert(Math.abs(Date.parse(record.crossedAt)-(AT+60_000))<1000);
    assert.equal(record.firstSeenBeyondAt,new Date(AT+2*60_000).toISOString());
    assert.equal(routeCrossing(km,AT+4*60_000,'133'),undefined,'Jeff’s retired tracker cannot reveal Emily’s milestones');
    assert.deepEqual(safeAchievements([{...record,id:`35950:jeff:km-${km}`,runnerId:'jeff',bib:'133'}]),[]);
  }
  assert(crossing('gold','133'),'historical Jeff crow-flight achievements remain readable');
});

test('new route posters require two plausible beyond-boundary fixes and reject isolated, future or reordered noisy points',()=>{
  const isolated=[report(49.9,AT),report(50.1,AT+2*60_000),report(49.9,AT+4*60_000)];
  const has50=(reports,now=AT+4*60_000)=>deriveAchievements(event,participant(reports.at(-1)),reports,now).some(p=>p.milestoneId==='km-50');
  assert.equal(has50(isolated),false);
  assert.equal(has50(isolated.slice(0,2)),false,'a latest position is not a second independent observation');
  assert.equal(has50([isolated[1]],AT+60*60_000),false,'an old isolated report does not become credible with age');
  assert.equal(has50([isolated[2],isolated[1],isolated[0]]),false,'reverse arrival order cannot turn an outlier into a crossing');
  const confirmed=[report(49.9,AT),report(50.1,AT+2*60_000),report(50.2,AT+4*60_000)];
  assert.equal(has50(confirmed),true);
  assert.equal(has50([...confirmed].reverse()),true,'valid historical reports are ordered by observation time');
  assert.equal(has50(confirmed,AT+60_000),false,'future observations are never used');
  const jumped=[report(49.9,AT),report(50.1,AT+2*60_000),report(80,AT+3*60_000)];
  assert.equal(has50(jumped),false,'a second impossible route jump does not corroborate the first point');
});

test('confirmed Emily crossing atomically records and reveals its poster to unauthenticated viewers exactly once',async()=>{
  const f=database();
  f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = json_set(meetup_json, '$.celebrations', json('{}'))").run();
  const record=routeCrossing(50),observed=AT+5*60_000;
  const result=await recordAchievements(f.db,f.config,[record],observed);
  assert.equal(result.persisted,true);assert.deepEqual(result.records,[record]);
  const read=async at=>(await (await handleCrewRequest(new Request('https://crew.example.test/api/crew?public=1'),f.db,at,f.config)).json());
  const publicRoom=(await read(observed+1000)).room;
  assert.deepEqual(publicRoom.releases,[{id:'km-50',releasedAt:new Date(observed).toISOString()}]);
  assert.deepEqual(publicRoom.achievements.records,[record]);
  assert(!JSON.stringify(publicRoom).includes('km-60'),'future posters are absent from the public release queue');
  assert.notEqual(publicRoom.releases[0].releasedAt,record.crossedAt,'release time is detection time, not an invented on-time announcement');
  const version=f.sqlite.prepare('SELECT updated_at FROM crew_rooms').get().updated_at;
  await recordAchievements(f.db,f.config,[{...record,recordedAt:new Date(observed+2000).toISOString()}],observed+3000);
  assert.deepEqual((await read(observed+4000)).room.releases,publicRoom.releases);
  assert.equal(f.sqlite.prepare('SELECT updated_at FROM crew_rooms').get().updated_at,version,'retry is an idempotent read');
  const ended=await read(f.config.expiresAt);
  assert.equal(ended.room,null);assert.deepEqual(ended.releases,publicRoom.releases);
  assert.deepEqual(ended.achievements.records,[record]);
});

test('historical evidence backfills reached milestones without fabricating exact crossing times or revealing later ones',async()=>{
  const f=database(),reports=[report(70.1,AT),report(70.2,AT+2*60_000)],now=AT+60*60_000;
  f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = json('{}')").run();
  const records=deriveAchievements(event,participant(reports.at(-1)),reports,now);
  const routeRecords=records.filter(p=>p.milestoneId.startsWith('km-'));
  assert.deepEqual(routeRecords.map(p=>p.milestoneId),['km-50','km-60','km-70']);
  for(const record of routeRecords){assert.equal(record.crossedAt,null);assert.equal(record.backfilled,true);assert.equal(record.firstSeenBeyondAt,reports[0].recordedAt);}
  await recordAchievements(f.db,f.config,records,now);
  const metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
  assert.deepEqual(metadata.celebrations,{'km-50':now,'km-60':now,'km-70':now});
  assert(!Object.hasOwn(metadata.celebrations,'km-80'));
  assert(!Object.hasOwn(metadata.celebrations,'gold'));
});

test('upgrade reconciliation releases existing confirmed records and preserves prior manual release timestamps',async()=>{
  const f=database(),record=routeCrossing(50),now=AT+10*60_000;
  f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = json_set(meetup_json, '$.raceAchievements', json(?))").run(JSON.stringify([record]));
  const reconciled=await recordAchievements(f.db,f.config,[],now);
  assert.deepEqual(reconciled.records,[record]);
  let metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
  assert.equal(metadata.celebrations['km-50'],now);
  assert.equal(metadata.celebrations['km-60'],AT,'existing manual release time remains untouched');
  await recordAchievements(f.db,f.config,[routeCrossing(60)],now+1000);
  metadata=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
  assert.equal(metadata.celebrations['km-60'],AT);
  const future={...routeCrossing(70),firstSeenBeyondAt:new Date(now+60_000).toISOString(),recordedAt:new Date(now+60_000).toISOString(),evidence:{beforeAt:null,afterAt:new Date(now+60_000).toISOString()}};
  await recordAchievements(f.db,f.config,[future],now+2000);
  assert(!Object.hasOwn(JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json).celebrations,'km-70'));
});

test('only Emily’s validated gold crossing automatically reveals the gold poster',async()=>{
  const f=database(),now=AT+10*60_000;
  const km=milestones.find(p=>p.id==='gold').routeKm;
  const isolated=[report(km-.1,AT),report(km+.1,AT+2*60_000),report(km-.1,AT+4*60_000)];
  assert(!deriveAchievements(event,participant(isolated.at(-1)),isolated,now).some(p=>p.milestoneId==='gold'),'a lone noisy gold-ring point cannot reveal its poster');
  await recordAchievements(f.db,f.config,[crossing('gold','133')],now);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json).celebrations.gold,undefined);
  await recordAchievements(f.db,f.config,[crossing('gold')],now+1000);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json).celebrations.gold,now+1000);
});

test('achievement CAS retry preserves intervening walking plans, phone reports, checkpoints and manually released posters',async()=>{
  const f=database(),now=AT+10*60_000,prepare=f.db.prepare.bind(f.db);let injected=false;
  const patch=async(body,at)=>{
    const response=await handleCrewRequest(new Request('https://crew.example.test/api/crew',{method:'PATCH',headers:{Origin:'https://crew.example.test',Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify(body)}),f.db,at,f.config);
    assert.equal(response.status,200);return response.json();
  };
  f.db.prepare=sql=>{
    const query=prepare(sql),run=query.run.bind(query);
    query.run=async()=>{
      if(!injected&&sql.startsWith('UPDATE crew_rooms SET meetup_json = ?')){
        injected=true;
        await patch({supporterPlan:{personId:'huiyan',mode:'walking'}},now+1000);
        await patch({supporterPlan:{personId:'graham',mode:'meeting'}},now+1001);
        await patch({personId:'jeff',sharing:true,position:{lat:52.2,lng:-1.1,accuracy:8,recordedAt:now+1002}},now+1002);
        await patch({celebration:'km-50'},now+1003);
        await patch({checkpoint:{action:'complete',pointId:'point-2'}},now+1004);
      }
      return run();
    };
    return query;
  };
  const result=await recordAchievements(f.db,f.config,[routeCrossing(50)],now);
  assert(injected);assert.equal(result.persisted,true);
  const row=f.sqlite.prepare('SELECT * FROM crew_rooms').get(),metadata=JSON.parse(row.meetup_json);
  assert.equal(metadata.raceAchievements[0].milestoneId,'km-50');
  assert.equal(metadata.supporterPlans.huiyan.mode,'walking');
  assert.equal(metadata.supporterPlans.graham.mode,'meeting');
  assert.equal(metadata.supporters.jeff.position.recordedAt,now+1002);
  assert.equal(metadata.supporters.jeff.position.updatedAt,now+1002);
  assert.equal(metadata.celebrations['km-50'],now+1003,'concurrent explicit release wins over retry time');
  assert.equal(metadata.celebrations['km-60'],AT);
  assert.equal(metadata.checkpointStatuses['point-2'].status,'met');
  assert(row.updated_at>now+1004,'the committed release/ledger snapshot orders after intervening updates');
  assert.equal(row.position_updated_at,AT,'unchanged phone coordinates never appear freshly observed');
});

test('unavailable durable storage is honestly reported and malformed records never reach the public history',async()=>{
  const record=crossing();
  assert.equal((await recordAchievements(undefined,undefined,[record],AT)).persisted,false);
  assert.deepEqual(safeAchievements([{...record,eventId:1},{...record,id:'fake'},{...record,bib:'210'},{...record,crossedAt:'tomorrow'}]),[]);
  const f=database();
  const response=await handleCrewRequest(new Request('https://crew.example.test/api/crew',{method:'PATCH',headers:{Origin:'https://crew.example.test',Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify({raceAchievements:[record]})}),f.db,AT,f.config);
  assert.equal(response.status,400);
});
