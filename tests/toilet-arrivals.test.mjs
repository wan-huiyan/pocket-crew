import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const url=new URL('../lib/toilet-routing.ts',import.meta.url);let count=0;
function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../drizzle/0001_shiny_ravenous.sql',import.meta.url),'utf8'));
 return {sqlite,db:{prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async run(){const result=sqlite.prepare(sql).run(...this.args);return {meta:{changes:Number(result.changes)}};}};}}};
}
const origin=()=>({lat:52.338791,lng:-1.293227,recordedAt:new Date(Date.now()-30000).toISOString()});
const body=()=>({origin:origin(),ids:['esso-dunchurch-toilet','mfg-coventry']});
const payload=()=>({code:'Ok',sources:[{distance:2}],destinations:[{distance:2},{distance:10}],durations:[[300,1800]],distances:[[2000,12000]]});
async function scenario(value=payload(),storage=database()){
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(u,options)=>{calls.push({url:String(u),options});if(value instanceof Error)throw value;return Response.json(value);};
 const {handleToiletArrivals}=await import(url.href+'?scenario='+count++);
 const request=(data,headers)=>new Request('https://guide.test/api/toilet-arrivals',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 return {calls,storage,async read(data=body(),headers={}){const r=await handleToiletArrivals(request(data,headers),storage.db);return {http:r.status,...await r.json()};},async otherIsolate(data=body()){const isolated=await import(url.href+'?scenario='+count++);const r=await isolated.handleToiletArrivals(request(data,{}),storage.db);return {http:r.status,...await r.json()};},restore(){globalThis.fetch=saved;storage.sqlite?.close();}};
}
test('road durations are batched to a fixed provider and use only known toilet IDs',async()=>{
 const f=await scenario();try{
  const result=await f.read();assert.equal(result.status,'ready');assert.equal(f.calls.length,1);
  assert.match(f.calls[0].url,/^https:\/\/routing\.openstreetmap\.de\/routed-car\/table\/v1\/driving\//);
  assert.match(f.calls[0].url,/sources=0&destinations=1;2&annotations=duration,distance$/);
  assert(!f.calls[0].url.includes('fallback_speed'));
  assert.deepEqual(result.destinations.map(p=>p.id),['esso-dunchurch-toilet','mfg-coventry']);
  assert.equal(result.traffic,false);assert.equal(f.calls[0].options.redirect,'manual');
 }finally{f.restore();}
});
test('old or invalid supporter GPS and arbitrary destinations are rejected before fetch',async()=>{
 const f=await scenario();try{
  for(const data of [{...body(),origin:{...origin(),recordedAt:new Date(Date.now()-6*60000).toISOString()}},{...body(),origin:{...origin(),lat:null}},{...body(),ids:['https://evil.test']},{...body(),ids:['mfg-coventry','mfg-coventry']},{...body(),origin:{...origin(),lng:40}}])assert.equal((await f.read(data)).http,400);
  assert.equal(f.calls.length,0);
 }finally{f.restore();}
});
test('possible café WC gets a road ETA using its fixed catalogue pin, never supplied coordinates',async()=>{
 const f=await scenario();try{
  const request={...body(),ids:['coffee1-daventry','mfg-coventry'],destinations:[{id:'coffee1-daventry',lat:1,lng:1}],url:'https://evil.test'};
  const result=await f.read(request);
  assert.equal(result.status,'ready');assert.deepEqual(result.destinations.map(p=>p.id),['coffee1-daventry','mfg-coventry']);
  assert.match(f.calls[0].url,/-1\.16162,52\.25727/);assert(!f.calls[0].url.includes('evil.test'));
  assert.equal((await f.read({...request,ids:[{id:'coffee1-daventry',lat:1,lng:1}]})).http,400);
  assert.equal((await f.read({...request,ids:['unlisted-cafe']})).http,400);assert.equal(f.calls.length,1);
 }finally{f.restore();}
});
test('same request reuses cache and concurrent requests share a provider call',async()=>{
 const f=await scenario();try{
  const [a,b]=await Promise.all([f.read(),f.read()]);assert.equal(a.status,'ready');assert.equal(b.status,'ready');
  assert.equal((await f.read()).cached,true);assert.equal(f.calls.length,1);
 }finally{f.restore();}
});
test('provider failure does not return a crow-flight substitute or internal detail',async()=>{
 const f=await scenario(Error('private upstream detail'));try{
  const result=await f.read();assert.equal(result.http,503);assert.equal(result.status,'unavailable');assert.equal(result.destinations,undefined);assert(!JSON.stringify(result).includes('private'));
 }finally{f.restore();}
});
test('no road route and excessive destination snap distance stay null',async()=>{
 const value=payload();value.durations[0][0]=null;value.destinations[1].distance=600;
 const f=await scenario(value);try{const r=await f.read();assert(r.destinations.every(p=>p.durationSeconds===null));}finally{f.restore();}
});
test('an origin far from roads is not silently snapped to a distant road',async()=>{
 const value=payload();value.sources[0].distance=1000;
 const f=await scenario(value);try{assert.equal((await f.read()).http,503);}finally{f.restore();}
});
test('malformed provider shapes and implausible travel values cannot yield usable ETAs',async()=>{
 let f=await scenario({...payload(),durations:[[1]]});try{assert.equal((await f.read()).http,503);}finally{f.restore();}
 const value=payload();value.durations[0]=[-1,Infinity];f=await scenario(value);try{const r=await f.read();assert(r.destinations.every(p=>p.durationSeconds===null));}finally{f.restore();}
});
test('cross-origin callers cannot trigger routing and bursts are bounded',async()=>{
 const f=await scenario();try{
  assert.equal((await f.read(body(),{Origin:'https://other.test'})).http,403);assert.equal(f.calls.length,0);
  await f.read();assert.equal((await f.read({...body(),origin:{...origin(),lat:52.4}})).http,429);
  assert.equal(f.calls.length,1);
 }finally{f.restore();}
});
test('separate Worker isolates share the rate lease and positive cache',async()=>{
 const f=await scenario();try{
  assert.equal((await f.read()).status,'ready');
  assert.equal((await f.otherIsolate()).cached,true);
  assert.equal((await f.otherIsolate({...body(),origin:{...origin(),lat:52.4}})).http,429);
  assert.equal(f.calls.length,1);
  const row=f.storage.sqlite.prepare('SELECT * FROM toilet_routing_cache').get();
  assert.equal(row.id,1);assert.equal(row.lease_token,null);
 }finally{f.restore();}
});
test('an active shared lease prevents a cold isolate from requesting the provider',async()=>{
 const f=await scenario();try{
  f.storage.sqlite.prepare('INSERT INTO toilet_routing_cache (id,lease_until,lease_token) VALUES (1,?,?)').run(Date.now()+15000,'another-worker');
  assert.equal((await f.otherIsolate()).http,429);assert.equal(f.calls.length,0);
 }finally{f.restore();}
});
test('missing or unavailable shared storage never falls back to unthrottled calls',async()=>{
 const f=await scenario(payload(),{db:undefined});try{assert.equal((await f.read()).http,503);assert.equal(f.calls.length,0);}finally{f.restore();}
 const broken=await scenario(payload(),{db:{prepare(){throw Error('DB down');}}});try{assert.equal((await broken.read()).http,503);assert.equal(broken.calls.length,0);}finally{broken.restore();}
});
