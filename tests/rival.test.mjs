import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/rival.js',import.meta.url),'utf8');
const arrivalSource=readFileSync(new URL('../public/arrival-eta.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-14T03:00:00Z');
const report=(change={})=>({bib:'210',name:'Matt Leese',lat:52.37,lng:-1.37,updatedAt:new Date(NOW-60000).toISOString(),crowKm:20.1,finished:false,retired:false,...change});
const live=p=>({status:'live',event:{active:true},participants:[p]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function load(initial=live(report())){
  let next=initial,now=NOW;
  const events=[],requests=[],timers=[],listeners=new Map(),documentListeners=new Map();
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context={Date:ClockDate,AbortController,console,Promise,setTimeout,clearTimeout,
    setInterval(callback,ms){timers.push({callback,ms});return timers.length;},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    document:{hidden:false,addEventListener(type,callback){documentListeners.set(type,callback);}},
    window:{dispatchEvent(event){events.push(event);},addEventListener(type,callback){listeners.set(type,callback);}},
    fetch:async(path,options)=>{if(path==='/data/route.geojson')return Response.json({type:'LineString',coordinates:[[-2,52.37],[-1,52.37]]});requests.push({path,options});if(next instanceof Error)throw next;if(typeof next==='function')return next();return Response.json(next);}
  };
  vm.runInNewContext(arrivalSource,context,{filename:'arrival-eta.js'});
  vm.runInNewContext(source,context,{filename:'rival.js'});
  await tick();await tick();
  return {api:context.window.rivalGuide,events,requests,timers,context,
    setResponse(value){next=value;},advance(ms){now+=ms;},
    async visible(value){context.document.hidden=!value;documentListeners.get('visibilitychange')?.();await tick();},
    async online(){listeners.get('online')?.();await tick();}
  };
}

test('bib 210 is a separate read-only feed with true GPS and official crow distance',async()=>{
  const f=await load();
  const s=f.api.getSnapshot();
  assert.equal(s.id,'madlis');assert.equal(s.bib,'210');assert.equal(s.name,'Matt Leese');assert.equal(s.shortName,'Matt');assert.equal(s.icon,'😈');
  assert.equal(s.position.lat,52.37);assert.equal(s.position.lng,-1.37);assert.equal(s.position.fresh,true);assert.equal(s.crowKm,20.1);
  assert(Number.isFinite(s.routeKm));assert.equal(s.speedKmh,null);assert.equal(s.paceMinPerKm,null);assert.equal(s.avatar,'/assets/avatars-v5/matt.webp');
  assert(f.requests.every(r=>r.path==='/api/tracker?bib=210'&&!r.options.method));
  assert(f.events.every(e=>e.type==='rivalupdate'));
  s.position.lat=1;assert.equal(f.api.getSnapshot().position.lat,52.37,'snapshots cannot mutate retained reports');
});

const history=(endAt=NOW-60000,endLng=-1.37)=>Array.from({length:6},(_,i)=>({lat:52.37,lng:endLng-(5-i)*.004,recordedAt:new Date(endAt-(5-i)*120000).toISOString()}));

test('preserves tracker history and estimates pace from route progress rather than crow-flight distance',async()=>{
  const reports=history(),f=await load(live(report({crowKm:1,recentReports:reports,paceReports:reports})));
  const s=f.api.getSnapshot();
  assert.equal(s.recentReports.length,6);assert.equal(s.paceReports.length,6);
  assert.equal(s.paceSource,'recent-tracker-route');assert.equal(s.position.paceSource,'recent-tracker-route');
  assert(s.speedKmh>8&&s.speedKmh<8.3);assert(s.paceMinPerKm>7&&s.paceMinPerKm<8);assert.equal(s.paceWindowMinutes,10);
  assert.equal(s.position.speedKmh,s.speedKmh);assert.equal(s.position.offRouteM,0);
  s.recentReports[0].lat=1;assert.equal(f.api.getSnapshot().recentReports[0].lat,52.37);
});

test('history survives a sparse poll and failed response but never makes an old report fresh',async()=>{
  const reports=history(),f=await load(live(report({recentReports:reports,paceReports:reports})));
  f.advance(120000);f.setResponse(live(report({lng:-1.366,updatedAt:new Date(NOW+60000).toISOString(),recentReports:[],paceReports:[]})));await f.api.refresh();
  let s=f.api.getSnapshot();assert.equal(s.paceReports.length,7);assert.equal(s.paceWindowMinutes,12);assert(s.speedKmh>8);
  f.setResponse(new Error('offline'));await f.api.refresh();s=f.api.getSnapshot();assert.equal(s.cached,true);assert(s.speedKmh>8);
  f.advance(300000);s=f.api.getSnapshot();assert.equal(s.speedKmh,null);assert.equal(s.position.paceSource,null);assert.match(s.paceMessage,/fresh/);
});

test('filters invalid, future and over-old history, and never substitutes plausible crow-flight pace',async()=>{
  const reports=history();
  const f=await load(live(report({recentReports:[...reports,{lat:52.37,lng:-1.3,recordedAt:new Date(NOW+60000).toISOString()},{lat:null,lng:-1.37,recordedAt:new Date(NOW-30000).toISOString()}],paceReports:[{lat:52.37,lng:-1.5,recordedAt:new Date(NOW-121*60000-60000).toISOString()}]})));
  assert.equal(f.api.getSnapshot().paceReports.length,6);
  const off=await load(live(report({lat:52.39,recentReports:reports,crowKm:30,speedKmh:10,paceMinPerKm:6})));
  assert.equal(off.api.getSnapshot().speedKmh,null);assert.equal(off.api.getSnapshot().position.routeKm,null);assert.match(off.api.getSnapshot().paceMessage,/away/);
  const sparse=await load(live(report({recentReports:reports.slice(-2),speedKmh:10,paceMinPerKm:6})));
  assert.equal(sparse.api.getSnapshot().speedKmh,null);
});

test('failure retains the original report time, then ages it rather than pretending it is live',async()=>{
  const f=await load(),original=f.api.getSnapshot().position.recordedAt;
  f.setResponse(new Error('Network failed'));f.advance(120000);await f.api.refresh();
  let s=f.api.getSnapshot();assert.equal(s.status,'unavailable');assert.equal(s.cached,true);assert.equal(s.position.recordedAt,original);assert.equal(s.fresh,true);
  f.advance(180000);s=f.api.getSnapshot();assert.equal(s.fresh,false);assert.equal(s.position.fresh,false);assert.equal(s.position.recordedAt,original);assert.equal(s.ageMs,360000);
});

test('a delayed provider report cannot move the marker or official distance backwards',async()=>{
  const f=await load();f.setResponse(live(report({lat:50,crowKm:1,updatedAt:new Date(NOW-120000).toISOString()})));await f.api.refresh();
  const s=f.api.getSnapshot();assert.equal(s.position.lat,52.37);assert.equal(s.crowKm,20.1);assert.equal(s.cached,true);assert.equal(s.position.recordedAt,new Date(NOW-60000).toISOString());
});

test('never borrows another runner or invents a point for missing, ambiguous, invalid or future reports',async()=>{
  for(const feed of [
    live(report({bib:'133'})),live(report({lat:null})),live(report({updatedAt:new Date(NOW+60000).toISOString()})),
    {status:'live',event:{active:true},participants:[report(),report()]},
    {status:'waiting',event:{active:false},participants:[report()]},
    {status:'wrong-event',participants:[report()]}
  ]){const f=await load(feed);assert.equal(f.api.getSnapshot().position,null);assert.equal(f.api.getSnapshot().fresh,false);}
});

test('refresh polls every 30 seconds only while visible and retries immediately on return',async()=>{
  const f=await load();assert.equal(f.timers[0].ms,30000);assert.equal(f.requests.length,1);
  f.timers[0].callback();await tick();assert.equal(f.requests.length,2);
  await f.visible(false);f.timers[0].callback();await f.api.refresh();assert.equal(f.requests.length,2);
  await f.visible(true);assert.equal(f.requests.length,3);
  await f.online();assert.equal(f.requests.length,4);
});

test('concurrent refreshes share a request and retired runners are not presented as moving live',async()=>{
  const f=await load();let resolve;f.setResponse(()=>new Promise(r=>{resolve=r;}));
  const first=f.api.refresh(),second=f.api.refresh();assert.equal(first,second);assert.equal(f.requests.length,2);
  resolve(Response.json(live(report({retired:true}))));await first;
  assert.equal(f.api.getSnapshot().retired,true);assert.equal(f.api.getSnapshot().fresh,false);assert.match(f.api.getSnapshot().message,/retired/);
});
