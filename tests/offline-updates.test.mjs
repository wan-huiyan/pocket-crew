import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const origin='https://crew.example';
const scope=origin+'/';
const swSource=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const appSource=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\nboot\(\);\s*$/,'\n');
const manifest={
  'km-60':{preview:'assets/surprises/sixty.webp'},
  'km-70':{preview:'assets/surprises/seventy.webp'}
};

function workerFixture({old={},fail=[],hang=[]}={}){
  const stores=new Map(),listeners=new Map(),fetches=[],deleted=[],messages=[];
  const unavailable=new Set(fail),pending=new Set(hang);
  const state={online:true,claimed:0,skipped:0};
  const url=value=>new URL(typeof value==='string'?value:value.url,scope).href;
  const clean=value=>{const valueUrl=new URL(url(value));valueUrl.search='';return valueUrl.href;};
  class Cache{
    constructor(){this.entries=new Map();}
    async match(key,options={}){
      const entry=options.ignoreSearch?[...this.entries].find(([saved])=>clean(saved)===clean(key))?.[1]:this.entries.get(url(key));
      return entry?.clone();
    }
    async put(key,response){this.entries.set(url(key),response.clone());}
    async keys(){return [...this.entries.keys()].map(key=>({url:key}));}
    async delete(key){return this.entries.delete(url(key));}
  }
  if(Object.keys(old).length){const cache=new Cache();for(const [key,value] of Object.entries(old))cache.entries.set(url(key),new Response(value));stores.set('emily-jeff-meriden-v17-old',cache);}
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,new Cache());return stores.get(name);},
    async keys(){return [...stores.keys()];},
    async delete(name){deleted.push(name);return stores.delete(name);}
  };
  const context={URL,Set,Promise,Response,AbortController,caches,console,
    setTimeout:(fn,ms)=>setTimeout(fn,ms===6000?8:ms),clearTimeout,
    fetch:async(input,options={})=>{
      const requestUrl=url(input),path=new URL(requestUrl).pathname;
      fetches.push({url:requestUrl,cache:options.cache});
      if(!state.online||unavailable.has(path))throw new Error('Unavailable fixture');
      if(pending.has(path))return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Timed out')),{once:true}));
      if(path==='/data/poster-manifest.json')return Response.json(manifest);
      return new Response('fresh:'+path);
    },
    self:{registration:{scope},location:{origin},addEventListener(type,handler){listeners.set(type,handler);},
      async skipWaiting(){state.skipped++;},clients:{async claim(){state.claimed++;},async matchAll(){throw new Error('Activation must not navigate clients');}}}
  };
  vm.runInNewContext(swSource+'\nglobalThis.testCacheName=CACHE;',context,{filename:'sw.js'});
  const cacheName=context.testCacheName;
  async function event(type,data){let work;listeners.get(type)({data,ports:[{postMessage(value){messages.push(value);}}],waitUntil(value){work=value;}});await work;}
  return {state,stores,fetches,deleted,messages,cacheName,unavailable,event,
    async saved(path){return (await (await caches.open(cacheName)).match(path))?.text();},
    async request(path,{mode='cors',method='GET'}={}){
      let response;listeners.get('fetch')({request:{url:url(path),mode,method},respondWith(value){response=value;}});
      return response?{handled:true,response:await response}:{handled:false};
    }
  };
}

test('an unavailable optional asset does not block activation or remove the saved offline route',async()=>{
  const f=workerFixture({old:{'/index.html':'old page','/data/route.geojson':'saved route'},fail:['/assets/crow.webp','/data/route.geojson']});
  await f.event('install');await f.event('activate');
  assert.equal(f.state.skipped,1);assert.equal(f.state.claimed,1);
  assert.equal(await f.saved('/data/route.geojson'),'saved route');
  assert.equal(f.deleted.length,0,'activation keeps the previous cache until the page can migrate its revealed images');
  assert.ok(f.fetches.every(call=>!call.url.includes('/surprises/')),'installation never fetches sealed posters');
  f.state.online=false;
  const route=await f.request('/data/route.geojson');
  assert.equal(await route.response.text(),'saved route');
  await f.event('message',{type:'CACHE_GUIDE',revealed:[]});
  assert.equal(f.messages.at(-1).ok,false,'the optional-file gap is honestly reported by explicit offline saving');
});

test('HTML and code prefer current network content, then serve the saved copy during an outage',async()=>{
  const f=workerFixture({old:{'/index.html':'old page','/app.js':'old code'}});
  await f.event('install');
  const page=await f.request('/?phone=1',{mode:'navigate'});
  assert.equal(await page.response.text(),'fresh:/');
  const code=await f.request('/app.js?v=new');
  assert.equal(await code.response.text(),'fresh:/app.js');
  assert.equal(f.fetches.at(-1).cache,'no-store','browser HTTP cache must not pin the old code');
  f.state.online=false;
  const offlinePage=await f.request('/',{mode:'navigate'});
  const offlineCode=await f.request('/app.js');
  assert.equal(await offlinePage.response.text(),'fresh:/');
  assert.equal(await offlineCode.response.text(),'fresh:/app.js');
});

test('slow shell requests fall back after their deadline and live links never enter service-worker handling',async()=>{
  const f=workerFixture({old:{'/index.html':'saved page'},hang:['/','/index.html']});
  await f.event('install');
  const page=await f.request('/',{mode:'navigate'});
  assert.equal(await page.response.text(),'saved page');
  for(const path of ['/api/crew/public','/api/tracker?bib=247','/crew-location','/crew-location?from=guide']){
    const result=await f.request(path,{mode:'navigate'});
    assert.equal(result.handled,false,path);
  }
});

test('only explicitly revealed posters migrate, and relocking removes cached copies from previous versions',async()=>{
  const f=workerFixture({old:{
    '/data/route.geojson':'saved route',
    '/assets/surprises/sixty.webp':'already revealed sixty',
    '/assets/surprises/seventy.webp':'old seventy'
  }});
  await f.event('install');
  assert.equal(await f.saved('/assets/surprises/sixty.webp'),undefined,'install cannot decide which designs to reveal');
  await f.event('message',{type:'SET_REVEALED_POSTERS',revealed:['km-60']});
  assert.equal(await f.saved('/assets/surprises/sixty.webp'),'already revealed sixty');
  assert.equal(await f.saved('/assets/surprises/seventy.webp'),undefined);
  assert.ok(f.fetches.every(call=>!call.url.includes('/surprises/')),'previously revealed images migrate without fetching sealed ones');
  await f.event('message',{type:'SET_REVEALED_POSTERS',revealed:[]});
  assert.equal(await f.saved('/assets/surprises/sixty.webp'),undefined);
  assert.deepEqual([...f.stores.keys()],[f.cacheName]);
});

test('explicit shell recovery ignores optional artwork gaps but never claims old cached code is a fresh update',async()=>{
  const f=workerFixture({fail:['/assets/crow.webp','/intro/great-escape-intro.js']});
  await f.event('install');
  await f.event('message',{type:'UPDATE_GUIDE',pathname:'/'});
  assert.equal(f.messages.at(-1).ok,true);
  f.unavailable.add('/live.js');
  await f.event('message',{type:'UPDATE_GUIDE',pathname:'/'});
  assert.equal(f.messages.at(-1).ok,false,'old live.js must not count as a successful fresh update');
  assert.match(f.messages.at(-1).error,/saved guide is still available/);
});

function appFixture({session=new Map(),workerReply={ok:true},online=true,hasWorker=true}={}){
  const elements=new Map(),scheduled=[],messages=[],localWrites=[],registrations=[];
  const state={reloads:0,geoCalls:0,permissionCalls:0,fetches:0};
  const local=new Map([['meriden-crew-2026-v1','{"mode":"supporter","notes":{"start":"keep me"}}'],['crew-token','keep-crew-controls']]);
  function element(){return {id:'',textContent:'',disabled:false,attributes:{},listeners:{},
    setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,handler){this.listeners[type]=handler;},
    insertAdjacentElement(_where,next){elements.set('#'+next.id,next);}};}
  for(const id of ['save-offline','offline-status']){const e=element();e.id=id;elements.set('#'+id,e);}
  class Channel{
    constructor(){this.port1={onmessage:null,close(){}};this.port2={respond:data=>this.port1.onmessage?.({data})};}
  }
  const worker={postMessage(message,ports){messages.push(message);queueMicrotask(()=>ports[0].respond(workerReply));}};
  const registration={active:worker,async update(){registrations.push('update');}};
  const serviceWorker={controller:hasWorker?worker:null,ready:Promise.resolve(registration),
    async getRegistration(){return hasWorker?registration:null;},async register(path,options){registrations.push({path,options});return registration;},
    async unregister(){throw new Error('Recovery must not unregister the saved guide');}};
  const context={console,Date,Set,Number,Promise,URL,MessageChannel:Channel,
    setTimeout(fn,ms){if(ms===250){scheduled.push(fn);return -scheduled.length;}return setTimeout(fn,ms);},
    clearTimeout(id){if(id>=0)clearTimeout(id);},
    localStorage:{getItem:key=>local.get(key)||null,setItem(key,value){localWrites.push(key);local.set(key,value);},clear(){throw new Error('Must retain local settings');}},
    sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value)},
    navigator:{onLine:online,serviceWorker,geolocation:{getCurrentPosition(){state.geoCalls++;},watchPosition(){state.geoCalls++;}},permissions:{query(){state.permissionCalls++;}}},
    location:{href:scope+'?keep=1#live',pathname:'/',reload(){state.reloads++;}},
    document:{querySelector:selector=>elements.get(selector)||null,querySelectorAll:()=>[],createElement:element},
    window:{isSecureContext:true},fetch:async()=>{state.fetches++;return new Response('current page');}
  };
  vm.runInNewContext(appSource+'\nglobalThis.offlineTest={mountGuideUpdateControl,handleGuideControllerChange,updateAndReloadGuide};',context,{filename:'app.js'});
  context.offlineTest.mountGuideUpdateControl();
  return {api:context.offlineTest,state,session,local,localWrites,messages,registrations,scheduled,
    q:selector=>elements.get(selector),flush(){for(const fn of scheduled.splice(0))fn();}};
}

test('automatic service-worker reload is bounded across page reloads in the same tab',()=>{
  const first=appFixture();
  first.api.handleGuideControllerChange();first.api.handleGuideControllerChange();
  assert.equal(first.scheduled.length,1);first.flush();assert.equal(first.state.reloads,1);
  const nextPage=appFixture({session:first.session});
  nextPage.api.handleGuideControllerChange();
  assert.equal(nextPage.scheduled.length,0);
  assert.match(nextPage.q('#guide-update-status').textContent,/Tap Update \/ reload guide/);
});

test('explicit recovery refreshes once without touching saved settings, permission grants or GPS',async()=>{
  const f=appFixture({session:new Map([['meriden-guide-auto-reloaded-v1','1']])});
  assert.equal(f.q('#update-guide').textContent,'Update / reload guide');
  assert.equal(f.q('#guide-update-status').attributes['role'],'status');
  await f.api.updateAndReloadGuide();await f.api.updateAndReloadGuide();
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].type,'UPDATE_GUIDE');
  assert.equal(f.scheduled.length,1);f.flush();assert.equal(f.state.reloads,1);
  assert.equal(f.local.get('crew-token'),'keep-crew-controls');assert.deepEqual(f.localWrites,[]);
  assert.equal(f.state.geoCalls,0);assert.equal(f.state.permissionCalls,0);
});

test('failed or offline recovery keeps the current guide open and makes retry available',async()=>{
  const failed=appFixture({workerReply:{ok:false,error:'The latest guide files could not all load. Your saved guide is still available.'}});
  await failed.api.updateAndReloadGuide();
  assert.equal(failed.scheduled.length,0);assert.equal(failed.q('#update-guide').disabled,false);
  assert.match(failed.q('#guide-update-status').textContent,/saved guide is still available/);
  const offline=appFixture({online:false});await offline.api.updateAndReloadGuide();
  assert.equal(offline.messages.length,0);assert.equal(offline.registrations.length,0);
  assert.equal(offline.scheduled.length,0);assert.match(offline.q('#guide-update-status').textContent,/You’re offline/);
});
