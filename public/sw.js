'use strict';
const CACHE='emily-jeff-meriden-v67-tidy-archive-standings-20261115';
const PREFIX='emily-jeff-meriden-';
const POSTER_IDS=new Set(['start','marathon','km-50','km-60','km-70','km-80','km-90','km-100','gold','km-110','km-120','km-123']);
const CORE=[
 './','./index.html','./style.css','./app.js','./crew.js','./support.js','./live.js','./manifest.webmanifest',
 './poster/','./poster/index.html','./poster-view.css','./poster-view.js','./poster.webmanifest',
 './assets/crow.svg','./assets/crow-app-icon.svg','./assets/crow-app-icon-180.png','./assets/crow-app-icon-192.png','./assets/crow-app-icon-512.png',
 './intro-host.js','./intro/great-escape-intro.js','./assets/emily.webp','./assets/jeff.webp','./assets/crow.webp',
 './map-first.css','./map-first.js','./competitors.css','./competitors.js','./route-distances.js','./arrival-eta.js','./catch-up.js','./race-milestones.js','./race-moments.js','./meeting-forecast.js','./toilet-hours.js','./crew-travel.js','./rival.js','./upcoming-points.js','./celebrations.js','./animations.css','./data/facilities.json',
 './assets/avatars-v5/emily.webp','./assets/avatars-v5/jeff.webp','./assets/avatars-v5/huiyan.webp','./assets/avatars-v5/graham.webp','./assets/avatars-v5/ben.webp','./assets/avatars-v5/matt.webp',
 './assets/vendor/leaflet.js','./assets/vendor/leaflet.css',
 './assets/vendor/images/layers.png','./assets/vendor/images/layers-2x.png',
 './assets/vendor/images/marker-icon.png','./assets/vendor/images/marker-icon-2x.png',
 './assets/vendor/images/marker-shadow.png',
 './data/guide-data.json','./data/crew-stops.json','./data/support-points.json','./data/poster-manifest.json','./data/meriden-final-standings-2026.json',
 './celebration.html','./replay.html','./replay.js','./replay.css','./data/emily-replay-2026.json',
 './data/route.geojson','./data/route-full-2025.geojson','./data/estimated-gold-boundary.geojson'
];
const absolute=url=>new URL(url,self.registration.scope).href;
const CORE_URLS=new Set(CORE.map(absolute));
const SHELL=CORE.filter(url=>url.endsWith('/')||/\.(?:html|js|css|json|webmanifest)$/.test(url));
const SHELL_URLS=new Set(SHELL.map(absolute));
const RELOAD_REQUIRED=['./index.html','./replay.html','./replay.js','./replay.css','./data/emily-replay-2026.json','./data/meriden-final-standings-2026.json','./celebrations.js','./animations.css','./app.js','./crew.js','./support.js','./live.js','./route-distances.js','./arrival-eta.js','./catch-up.js','./race-milestones.js','./race-moments.js','./meeting-forecast.js','./toilet-hours.js','./crew-travel.js','./rival.js','./competitors.js','./competitors.css','./map-first.js','./map-first.css','./style.css','./upcoming-points.js','./assets/vendor/leaflet.js','./assets/vendor/leaflet.css'];
const isPoster=url=>/\/assets\/(?:surprises\/[^/]+|poster-coffee)\.webp$/.test(new URL(url).pathname);
let cacheWork=Promise.resolve();

async function freshResponse(input){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetch(input,{cache:'no-store',signal:controller.signal});
  if(!response.ok)throw new Error('Unavailable guide file');
  return response;
 }finally{clearTimeout(timer);}
}

async function oldCacheNames(){return (await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE).reverse();}

async function savedResponse(url,includeOld=false){
 const cache=await caches.open(CACHE);
 const current=await cache.match(url,{ignoreSearch:true});
 if(current)return current;
 if(includeOld)for(const name of await oldCacheNames()){
  const previous=await (await caches.open(name)).match(url,{ignoreSearch:true});
  if(previous)return previous;
 }
 return null;
}

async function carryForwardGuide(){
 const cache=await caches.open(CACHE);
 for(const name of await oldCacheNames()){
  const previous=await caches.open(name);
  for(const request of await previous.keys()){
   if(!CORE_URLS.has(request.url)||await cache.match(request))continue;
   const response=await previous.match(request);
   if(response)try{await cache.put(request,response);}catch{}
  }
 }
}

async function fillCache(urls=CORE){
 const cache=await caches.open(CACHE);
 const files=await Promise.all(urls.map(async url=>{
  const key=absolute(url);
  try{
   await cache.put(key,await freshResponse(key));
   return {url,fresh:true,available:true};
  }catch{
   return {url,fresh:false,available:Boolean(await savedResponse(key,true))};
  }
 }));
 return {files,complete:files.every(file=>file.available)};
}

async function pruneOldCaches(allowedPosters){
 const cache=await caches.open(CACHE);
 for(const name of await oldCacheNames()){
  const old=await caches.open(name);
  let needed=false;
  for(const request of await old.keys()){
   if((CORE_URLS.has(request.url)||allowedPosters.has(request.url))&&!await cache.match(request)){needed=true;break;}
  }
  if(!needed)await caches.delete(name);
 }
}

async function syncPosters(revealed){
 const cache=await caches.open(CACHE);
 const manifestResponse=await savedResponse(absolute('./data/poster-manifest.json'),true);
 if(!manifestResponse)throw new Error('Poster list unavailable');
 const manifest=await manifestResponse.json();
 const requested=new Set(Array.isArray(revealed)?revealed.filter(id=>POSTER_IDS.has(id)):[]);
 const allowed=new Set();
 for(const id of requested){
  const path=manifest[id]?.preview;
  if(typeof path!=='string'||!/^assets\/(?:surprises\/[a-zA-Z0-9_-]+|poster-coffee)\.webp$/.test(path))continue;
  allowed.add(new URL(path,self.registration.scope).href);
 }
 // Relocking also removes saved milestone images on this browser.
 for(const name of [CACHE,...await oldCacheNames()]){
  const saved=await caches.open(name);
  for(const request of await saved.keys()){
   if(isPoster(request.url)&&!allowed.has(request.url))await saved.delete(request);
  }
 }
 await Promise.all([...allowed].map(async url=>{
  if(await cache.match(url))return;
  const response=await savedResponse(url,true)||await freshResponse(url);
  await cache.put(url,response);
 }));
 await pruneOldCaches(allowed);
}

function queueCacheWork(work){
 const result=cacheWork.then(work);
 cacheWork=result.catch(()=>{});
 return result;
}

self.addEventListener('install',event=>{
 // A missing illustration must not strand every viewer on the previous app.
 // Existing route files are retained; explicit offline saving reports gaps.
 event.waitUntil((async()=>{
  try{await carryForwardGuide();await fillCache();}catch{}
  await self.skipWaiting();
 })());
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  await self.clients.claim();
  // The page owns its one bounded reload. A second client.navigate here used
  // to race controllerchange and could reload the newly loaded page again.
  // Old caches stay until revealed images and any missing route files migrate.
 })());
});

self.addEventListener('message',event=>{
 const type=event.data?.type;
 if(type==='CACHE_GUIDE'){
  event.waitUntil(queueCacheWork(async()=>{const result=await fillCache();await syncPosters(event.data.revealed);if(!result.complete)throw new Error('Guide incomplete');})
   .then(()=>event.ports[0]?.postMessage({ok:true}))
   .catch(()=>event.ports[0]?.postMessage({ok:false,error:'Some guide files or revealed posters are not available offline yet.'})));
 }else if(type==='UPDATE_GUIDE'){
  event.waitUntil(queueCacheWork(async()=>{
   const result=await fillCache(SHELL);
   const required=[...RELOAD_REQUIRED];
   if(String(event.data.pathname||'').includes('/poster'))required.push('./poster/index.html','./poster-view.js','./poster-view.css');
   const ready=required.every(url=>result.files.some(file=>file.url===url&&file.fresh));
   if(!ready)throw new Error('Fresh guide incomplete');
  }).then(()=>event.ports[0]?.postMessage({ok:true}))
   .catch(()=>event.ports[0]?.postMessage({ok:false,error:'The latest guide files could not all load. Your saved guide is still available; try updating again with a connection.'})));
 }else if(type==='SET_REVEALED_POSTERS'){
  event.waitUntil(queueCacheWork(()=>syncPosters(event.data.revealed)).catch(()=>{}));
 }
});

async function networkFirst(request,key){
 try{
  const response=await freshResponse(request);
  try{await (await caches.open(CACHE)).put(key,response.clone());}catch{}
  return response;
 }catch(error){
  const saved=await savedResponse(key,true);
  if(saved)return saved;
  throw error;
 }
}

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 // Live data and shared crew positions always use the network.
 if(url.pathname.startsWith('/api/')||url.pathname==='/crew-location'||url.pathname.startsWith('/crew-location/'))return;
 // Large original print files always use the network.
 if(/\/assets\/(?:poster-[^/]+|surprises\/[^/]+)\.png$/.test(url.pathname))return;
 if(request.mode==='navigate'){
  const rootPath=new URL(self.registration.scope).pathname;
  if([rootPath+'poster',rootPath+'poster/',rootPath+'poster/index.html'].includes(url.pathname)){
   event.respondWith(networkFirst(request,absolute('./poster/index.html')));return;
  }
  if(url.pathname===rootPath||url.pathname===rootPath+'index.html')event.respondWith(networkFirst(request,absolute('./index.html')));
  return;
 }
 const key=url.origin+url.pathname;
 if(SHELL_URLS.has(key)){event.respondWith(networkFirst(request,key));return;}
 if(!CORE_URLS.has(key)&&!isPoster(key))return;
 event.respondWith((async()=>{
  const saved=await savedResponse(key,CORE_URLS.has(key));
  if(saved)return saved;
  // Only CORE and explicitly revealed posters are saved. Opening the gallery
  // does not fetch or precache sealed poster designs.
  const response=await fetch(request);
  if(response.ok&&CORE_URLS.has(key))try{await (await caches.open(CACHE)).put(key,response.clone());}catch{}
  return response;
 })());
});
