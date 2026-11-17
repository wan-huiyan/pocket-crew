import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/crew-travel.js',import.meta.url),'utf8');
function setup(){
 let now=Date.parse('2026-11-14T08:00:00Z');const calls=[],events=[];
 class Clock extends Date{static now(){return now;}}
 const context={module:{exports:{}},Date:Clock,Number,Math,Intl,AbortSignal,setTimeout:(fn,ms)=>{now+=ms;queueMicrotask(fn);return 1;},document:{hidden:false},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},dispatchEvent:e=>events.push(e),fetch:async(u,o)=>{calls.push({u,o});const b=JSON.parse(o.body);return {ok:true,json:async()=>({status:'ready',computedAt:new Date(now).toISOString(),origin:b.origin,destinations:b.ids.map(id=>({id,durationSeconds:600,distanceMetres:4000}))})};}};
 vm.runInNewContext(source,context);const api=context.module.exports;
 const crew=()=>({crew:{lat:52.3,lng:-1.2,fresh:true,sharing:true,recordedAt:new Date(now-30000).toISOString()}});
 const pois=[{id:'one',kinds:['toilet']}];return {context,api,calls,events,crew,pois,now:()=>now,advance:ms=>now+=ms};
}
test('road travel is requested only explicitly, then provides a drive-now range',async()=>{
 const f=setup();assert.equal(f.calls.length,0);
 await f.api.refresh({pois:f.pois,snapshot:f.crew()});assert.equal(f.calls.length,1);
 const e=f.api.estimate({poi:f.pois[0],snapshot:f.crew(),now:f.now()});
 assert.equal(e.status,'ready');assert.equal(e.earliestArrivalTime,f.now()+600000);assert.equal(e.arrivalTime,f.now()+900000);assert.match(e.note,/no live traffic/);assert.equal(f.events.at(-1).type,'crewtravelupdate');
});
test('before any shared plan is chosen the existing Huiyan road origin stays unchanged',async()=>{
 const f=setup(),huiyan=f.crew().crew,graham={...huiyan,lat:52.4,lng:-1.4};
 const snapshot={crew:graham,supporters:{huiyan,graham}};
 await f.api.refresh({pois:f.pois,snapshot});
 const sent=JSON.parse(f.calls[0].o.body);
 assert.equal(sent.origin.lat,huiyan.lat);assert.equal(sent.origin.lng,huiyan.lng);
 assert.match(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).note,/Huiyan/);
 const missing={crew:graham,supporters:{huiyan:null,graham}};
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot:missing,now:f.now()}).status,'unavailable');
 await f.api.refresh({pois:f.pois,snapshot:missing});
 assert.equal(f.calls.length,1,'Graham’s walking position cannot stand in for Huiyan’s driving origin');
});
test('Huiyan can walk while Jeff takes over the meet-up road origin without borrowing GPS',async()=>{
 const f=setup(),huiyan=f.crew().crew,jeff={...huiyan,lat:52.4,lng:-1.4};
 const snapshot={supporters:{huiyan,jeff,graham:null},supporterPlans:{huiyan:{mode:'walking'},jeff:{mode:'meeting'}},sharing:{personId:'huiyan'}};
 await f.api.refresh({pois:f.pois,snapshot});
 assert.equal(JSON.parse(f.calls[0].o.body).origin.lat,jeff.lat);
 assert.equal(f.api.driver(snapshot,f.now()).id,'jeff');
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).driverId,'jeff');
 assert.match(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).note,/Jeff leaves now/);
 snapshot.supporters.jeff=null;
 assert.equal(f.api.driver(snapshot,f.now()),null);
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).status,'unavailable');
 await f.api.refresh({pois:f.pois,snapshot});assert.equal(f.calls.length,1,'a walking supporter cannot replace the missing road origin');
});
test('Ben can drive to the meet-up when his own phone and plan are fresh',async()=>{
 const f=setup(),huiyan=f.crew().crew,ben={...huiyan,lat:52.41,lng:-1.31};
 const snapshot={supporters:{huiyan,ben},supporterPlans:{huiyan:{mode:'walking'},ben:{mode:'meeting'}},sharing:{personId:'ben'}};
 await f.api.refresh({pois:f.pois,snapshot});
 assert.equal(f.api.driver(snapshot,f.now()).id,'ben');
 assert.equal(JSON.parse(f.calls[0].o.body).origin.lat,ben.lat);
 snapshot.supporters.ben=null;
 assert.equal(f.api.driver(snapshot,f.now()),null,'Ben never borrows Huiyan’s walking position');
});
test('changing the meet-up supporter invalidates old travel even at the same position',async()=>{
 const f=setup(),position=f.crew().crew,snapshot={supporters:{huiyan:position,graham:{...position}},supporterPlans:{huiyan:{mode:'meeting'},graham:{mode:'walking'}}};
 await f.api.refresh({pois:f.pois,snapshot});
 snapshot.supporterPlans={huiyan:{mode:'walking'},graham:{mode:'meeting'}};
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).status,'unavailable');
 await f.api.refresh({pois:f.pois,snapshot});assert.equal(f.calls.length,2);
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot,now:f.now()}).driverName,'Graham');
 snapshot.supporterPlans.graham.mode='walking';
 assert.equal(f.api.driver(snapshot,f.now()),null);
});
test('stale crew, hidden pages, stopped sharing and absent routes never guess travel',async()=>{
 const f=setup();const stale=f.crew();stale.crew.recordedAt=new Date(f.now()-6*60000).toISOString();
 await f.api.refresh({pois:f.pois,snapshot:stale});assert.equal(f.calls.length,0);
 f.context.document.hidden=true;await f.api.refresh({pois:f.pois,snapshot:f.crew()});assert.equal(f.calls.length,0);
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot:stale,now:f.now()}).status,'unavailable');
});
test('unchanged source is cached and rapid movement is throttled with unavailable ETA',async()=>{
 const f=setup();await f.api.refresh({pois:f.pois,snapshot:f.crew()});
 await f.api.refresh({pois:f.pois,snapshot:f.crew()});assert.equal(f.calls.length,1);
 const moved=f.crew();moved.crew.lat+=.02;
 await f.api.refresh({pois:f.pois,snapshot:moved});assert.equal(f.calls.length,1);
 assert.equal(f.api.estimate({poi:f.pois[0],snapshot:moved,now:f.now()}).status,'unavailable');
 f.advance(2*60000);moved.crew.recordedAt=new Date(f.now()).toISOString();
 await f.api.refresh({pois:f.pois,snapshot:moved});assert.equal(f.calls.length,2);
});
test('cache and fresh GPS expire without re-stamping old travel results',async()=>{
 const f=setup();await f.api.refresh({pois:f.pois,snapshot:f.crew()});const checked=f.api.getSnapshot().checkedAt;
 f.advance(6*60000);assert.equal(f.api.estimate({poi:f.pois[0],snapshot:f.crew(),now:f.now()}).status,'unavailable');assert.equal(f.api.getSnapshot().checkedAt,checked);
});
test('a synchronous or asynchronous failure releases in-flight state for a later retry',async()=>{
 const f=setup();f.context.fetch=()=>{throw Error('offline');};
 await f.api.refresh({pois:f.pois,snapshot:f.crew()});assert.equal(f.api.getSnapshot().status,'unavailable');
 f.advance(2*60000);let count=0;f.context.fetch=async()=>{count++;throw Error('offline');};
 await f.api.refresh({pois:f.pois,snapshot:f.crew()});assert.equal(count,1);
});
test('café candidates after the first forty receive bounded batches in upcoming route order',async()=>{
 const f=setup();
 const candidates=Array.from({length:85},(_,i)=>({id:'cafe-'+i,kinds:['cafe'],possibleToilet:true,routeKm:85-i}));
 await f.api.refresh({pois:[{id:'ordinary-cafe',kinds:['cafe']},...candidates],snapshot:f.crew()});
 const batches=f.calls.map(call=>JSON.parse(call.o.body).ids);
 assert.deepEqual(batches.map(ids=>ids.length),[40,40,5]);assert.equal(batches[0][0],'cafe-84');assert.equal(batches[2].at(-1),'cafe-0');
 assert.equal(f.api.getSnapshot().destinations.length,85);assert.equal(f.api.getSnapshot().complete,true);
 assert.equal(f.api.estimate({poi:candidates[0],snapshot:f.crew(),now:f.now()}).status,'ready');
 await f.api.refresh({pois:candidates,snapshot:f.crew()});assert.equal(f.calls.length,3);
});
test('a failed later batch keeps early estimates usable and permits a bounded later retry',async()=>{
 const f=setup(),fetch=f.context.fetch;let attempts=0;
 const candidates=Array.from({length:41},(_,i)=>({id:'cafe-'+i,kinds:['cafe'],possibleToilet:true,routeKm:i}));
 f.context.fetch=async(...args)=>{if(++attempts===2)throw Error('offline');return fetch(...args);};
 await f.api.refresh({pois:candidates,snapshot:f.crew()});
 assert.equal(f.api.getSnapshot().complete,false);assert.equal(f.api.getSnapshot().destinations.length,40);
 assert.equal(f.api.estimate({poi:candidates[0],snapshot:f.crew(),now:f.now()}).status,'ready');
 assert.match(f.api.estimate({poi:candidates[40],snapshot:f.crew(),now:f.now()}).note,/pending/);
 f.advance(2*60000);f.context.fetch=fetch;
 await f.api.refresh({pois:candidates,snapshot:f.crew()});assert.equal(f.api.getSnapshot().complete,true);
 assert.equal(f.api.estimate({poi:candidates[40],snapshot:f.crew(),now:f.now()}).status,'ready');
});
test('hidden pages stop subsequent café batches without discarding completed estimates',async()=>{
 const f=setup(),fetch=f.context.fetch;
 const candidates=Array.from({length:41},(_,i)=>({id:'cafe-'+i,kinds:['cafe'],possibleToilet:true,routeKm:i}));
 f.context.fetch=async(...args)=>{const response=await fetch(...args);f.context.document.hidden=true;return response;};
 await f.api.refresh({pois:candidates,snapshot:f.crew()});
 assert.equal(f.calls.length,1);assert.equal(f.api.getSnapshot().complete,false);assert.equal(f.api.getSnapshot().destinations.length,40);
});
