'use strict';
const STORE_KEY='meriden-crew-2026-v1';
const START_AT=Date.parse('2026-11-13T23:59:00Z');
const END_AT=START_AT+24*60*60*1000;
const ORIGINAL_MAP='https://www.google.com/maps/d/viewer?mid=1fFhAcQkyqY84feHYgWFf6A7zw5k4A0w';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULTS={mode:'runner',selected:'start',theme:'day',focus:false,marks:{},notes:{},checks:{},unlocked:{},watchKm:0,speed:5,goldConfirmed:false};
let saved={};try{saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}')||{};}catch{}
let state={...DEFAULTS,...saved,marks:{...saved.marks},notes:{...saved.notes},checks:{...saved.checks},unlocked:{...saved.unlocked}};
for(const id of Object.keys(state.unlocked))if(!['start','marathon','km-50','km-60','km-70','km-80','km-90','km-100','gold','km-110','km-120','km-123'].includes(id)||!state.unlocked[id])delete state.unlocked[id];
if(!state.unlocked.gold)state.goldConfirmed=false;
if(!['runner','supporter'].includes(state.mode))state.mode='runner';
state.speed=Math.min(7,Math.max(3,Number(state.speed)||5));
state.watchKm=Math.min(250,Math.max(0,Number(state.watchKm)||0));
let saveWarned=false,toastTimer,guide,stops=[],route,fullRoute,goldBoundary,map,mapLayers={},markers={},locationMarker,accuracyCircle,currentTab='now',offlineRegistration,workerReloading=false;
let posterFiles={start:{preview:'assets/poster-coffee.webp',download:'assets/poster-coffee.png'}};
const hadWorkerAtBoot=Boolean(navigator.serviceWorker?.controller);
const AUTO_RELOAD_KEY='meriden-guide-auto-reloaded-v1';
let guideUpdateBusy=false;

const CHAPTERS={
 start:{poster:'coffee',short:'The send-off',title:'Meriden',cheer:'Some siblings just go for coffee.',support:'Your cheering crew is ready. ♡',note:'The beginning of the adventure. Save the coffee joke for the send-off — or the first moment they need a giggle.',tag:'THE SEND-OFF',kicker:'A VERY AMBITIOUS FAMILY OUTING'},
 marathon:{poster:'marathon',short:'Marathon',title:'A marathon together',cheer:'Emily & Jeff. A marathon! Look how far you’ve come.',support:'42.195 kilometres, powered by tofu and sibling spirit.',tag:'MARATHON · 42.195 KM',kicker:'TWO SIBLINGS. ONE VERY BIG ADVENTURE'},
 'km-50':{poster:'50',short:'50 km',title:'50 km',cheer:'Fifty kilometres. One amazing Emily!',support:'Graham is with you on foot and your whole crow crew is cheering.',tag:'50 KM · ROUTE DISTANCE',kicker:'LOOK HOW FAR YOU’VE COME'},
 'km-60':{poster:'60',short:'Towcester',title:'Towcester',cheer:'A toast to Emily and her crew!',support:'Every footstep matters, and the crow raises a slice.',tag:'60 KM · ROUTE REFERENCE',kicker:'LOOK HOW FAR YOU’VE COME'},
 'km-70':{poster:'70',short:'Potterspury',title:'Potterspury',cheer:'Properly proud of Emily and Graham!',support:'Ben is part of the mighty support crew too.',tag:'70 KM · ROUTE REFERENCE',kicker:'ONE BRILLIANT TEAM'},
 'km-80':{poster:'80',short:'Hello, MK',title:'Milton Keynes',cheer:'The great escape is still going!',support:'A little laugh from your crow crew — and a huge cheer for Emily and Graham.',tag:'80 KM · ROUTE REFERENCE',kicker:'A LITTLE LAUGH, A LOT OF LOVE'},
 'km-90':{poster:'90',short:'Beyond MK',title:'Beyond Milton Keynes',cheer:'Emily, Graham and Ben: what a team.',support:'On foot and in the support car, you’re all incredible.',tag:'90 KM · ROUTE REFERENCE',kicker:'EVERY STEP HAS BEEN YOURS'},
 'km-100':{poster:'100',short:'100 km',title:'100 km',cheer:'One hundred kilometres. Incredible Emily!',support:'Graham beside you and Ben there with the car — a team to treasure.',tag:'100 KM · ROUTE DISTANCE',kicker:'ONE EXTRAORDINARY ADVENTURE'},
 gold:{poster:'gold',short:'Dunstable',title:'Dunstable',cheer:'You’ve Dun it! Absolute legends!',support:'A celebration for Emily, Graham and Ben when the official tracker confirms gold.',tag:'GOLD PLAN · ABOUT 106 KM',kicker:'THE BIG, PROUD FAMILY MOMENT'},
 'km-110':{poster:'110',short:'110 km',title:'110 km',cheer:'110 kilometres! The escape continues!',support:'Emily, Graham and Ben — what a team.',tag:'110 KM · ROUTE DISTANCE',kicker:'THERE IS MORE TO THIS STORY'},
 'km-120':{poster:'120',short:'120 km',title:'120 km',cheer:'120 kilometres. Unbelievable Emily!',support:'The most determined runner, walker and driver crew.',tag:'120 KM · ROUTE DISTANCE',kicker:'CROW CREW NEVER STOPS CHEERING'},
 'km-123':{poster:'123',short:'123 km',title:'123 km',cheer:'123 kilometres. What a great escape!',support:'For Emily, Graham and Ben. You have our hearts.',tag:'123 KM · ROUTE DISTANCE',kicker:'AS FAR AS YOUR WINGS WILL GO'}
};
const KIT={
 supporter:[
  {id:'before',title:'Before the next hello',items:['Agree the exact meeting spot','Check parking and walking access','Charge phone and power bank','Pack water and a warm drink','Bring familiar vegan snacks','Have the right cheering poster ready']},
  {id:'meet',title:'At the meet-up',items:['Ask what would help right now','Offer a drink and familiar food','Check dry layers and spare socks','Check headtorches and batteries','Offer a seat, a hug, or quiet company','Agree the next check-in together']},
  {id:'leave',title:'Before you move on',items:['Both runners know the next plan','Crew know about any rest or route change','Meeting note is shared with the crew','Next poster and supplies are ready','Someone is keeping an eye on check-ins']}
 ],
 runner:[
  {id:'carry',title:'Before setting off',items:['Check the official mandatory kit list','Phone and power bank charged','Headtorch and spare power ready','Familiar food and drinks packed','Warm and waterproof layers ready','Tracker fitted as instructed']},
  {id:'pause',title:'At your next pause',items:['Check in with your crew','Say what you would like next','Sort food, drink and a dry layer','Check lights and phone power','Agree the next meet-up','Stay together as a pair']},
  {id:'finish',title:'When your race is done',items:['Check the official finish instructions','Check the tracker for the gold distance','Text race control if finishing early','Switch tracker off at the finish','Arrange the lift and warm clothes','Remember to return the tracker']}
 ]
};


function persist(){try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch{if(!saveWarned){notify('This browser cannot save your notes. The guide still works.');saveWarned=true;}}}
function notify(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3800);}
function activeStop(){return stops.find(s=>s.id===state.selected)||stops[0];}
function chapter(stop){return CHAPTERS[stop.id];}
function isUnlocked(stop){return stop.id==='start'||Boolean(state.unlocked[stop.id]);}
function posterPath(stop,kind){if(!isUnlocked(stop))return '';const path=posterFiles[stop.id]?.[kind];const extension=kind==='preview'?'webp':'png';return typeof path==='string'&&new RegExp('^assets/(?:poster-coffee|surprises/[a-zA-Z0-9_-]+)\\.'+extension+'$').test(path)?path:'';}
function revealedPosterIds(){return Object.keys(state.unlocked).filter(id=>state.unlocked[id]);}
function posterImageStatus(message,retry=false){const status=$('#poster-image-status');if(!status)return;status.hidden=!message;status.textContent=message||'';if(retry){const button=document.createElement('button');button.className='text-button';button.textContent='Try loading the poster again →';button.addEventListener('click',()=>{const id=$('#poster-dialog').dataset.posterId;if(id)showPoster(id);});status.append(document.createTextNode(' '),button);}}
function clearPosterDialog(){const dialog=$('#poster-dialog');if(dialog.open)dialog.close();dialog.removeAttribute('data-poster-id');$('#dialog-poster').removeAttribute('src');$('#dialog-poster').alt='';$('#download-poster').removeAttribute('href');$('#download-poster').removeAttribute('download');posterImageStatus('');}
function syncRevealedCache(){const worker=navigator.serviceWorker?.controller;if(worker)worker.postMessage({type:'SET_REVEALED_POSTERS',revealed:revealedPosterIds()});}
function confirmReveal(id){if(state.mode!=='supporter')return;window.crowCelebrations?.release(id);}
function relockPoster(id){if(id==='start')return;delete state.unlocked[id];if(id==='gold')state.goldConfirmed=false;clearPosterDialog();persist();renderPosters();syncRevealedCache();notify('Sealed again on this phone.');}
function mapsSearch(query){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);}
function markerUrl(stop){return mapsSearch(stop.lat+','+stop.lng);}
function roundDistance(km){return km===0?'Start':Number.isInteger(km)?km+' km':'About '+Math.round(km)+' km';}
function showPoster(id){const s=stops.find(s=>s.id===id);if(!s)return;if(!isUnlocked(s)){notify('This moment is not available yet.');return;}const c=chapter(s),preview=posterPath(s,'preview'),download=posterPath(s,'download');if(!preview||!download){notify('This poster needs a connection. Refresh the guide and try again.');return;}$('#dialog-title').textContent=(s.id==='start'?'The coffee joke':s.id==='marathon'?'Emily & Jeff · a marathon!':(roundDistance(s.routeKm)===c.title?c.title:roundDistance(s.routeKm)+' · '+c.title));posterImageStatus(navigator.onLine?'Opening the poster…':'Opening the saved poster… A first reveal needs a connection.');$('#dialog-poster').src=preview;$('#dialog-poster').alt=c.cheer+' Illustrated celebration for '+(s.id==='marathon'?'Emily and Jeff':'Emily and her crow crew')+'.';$('#download-poster').href=download;$('#download-poster').download='Emily-and-Jeff-'+c.poster+'-'+(posterFiles[id]?.width||1200)+'x'+(posterFiles[id]?.height||1800)+'.png';const dialog=$('#poster-dialog');dialog.dataset.posterId=id;if(!dialog.open)dialog.showModal();}
function mapStatus(message){$('#map-status').hidden=false;$('#map-status').textContent=message;}
function crowDistance(lat,lng){const rad=x=>x*Math.PI/180;const p=guide.crowDistanceOrigin;const dlat=rad(lat-p.lat),dlng=rad(lng-p.lng);const a=Math.sin(dlat/2)**2+Math.cos(rad(p.lat))*Math.cos(rad(lat))*Math.sin(dlng/2)**2;return 6371.0088*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function locate(forHelp=false){if(!forHelp&&(!guide||!stops.length)){mapStatus('Route data is not ready. Refresh with a connection, or open the original map.');return;}if(!navigator.geolocation){notify('Location is unavailable in this browser. Use your phone’s map app.');return;}const btn=forHelp?$('#help-location'):$('#locate-me');const original=btn.textContent;btn.disabled=true;btn.textContent='Finding you…';navigator.geolocation.getCurrentPosition(position=>{btn.disabled=false;btn.textContent=original;const {latitude:lat,longitude:lng,accuracy}=position.coords;const coordinates=lat.toFixed(5)+', '+lng.toFixed(5);if(forHelp){$('#help-coordinates').textContent='Your coordinates: '+coordinates+' · accuracy about '+Math.round(accuracy)+' m. Share these with the emergency service if asked.';}else{initMap();if(map){if(locationMarker)map.removeLayer(locationMarker);if(accuracyCircle)map.removeLayer(accuracyCircle);accuracyCircle=L.circle([lat,lng],{radius:accuracy,color:'#397aaa',weight:1,fillOpacity:.08}).addTo(map);locationMarker=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#367bb2',fillOpacity:1}).addTo(map).bindPopup('This device’s position<br><small>Not shared with the crew</small>');map.setView([lat,lng],13);}mapStatus('This device: '+coordinates+' · accuracy about '+Math.round(accuracy)+' m. Approximately '+(crowDistance(lat,lng)/1.609344).toFixed(1)+' miles from Meriden; use the official tracker for gold.');}notify('Your position is shown only on this phone.');},error=>{btn.disabled=false;btn.textContent=original;const msg=error.code===1?'Location permission was not granted. You can still use the original map.':'Could not get your position. Try your phone’s map app.';if(forHelp)$('#help-coordinates').textContent=msg;else mapStatus(msg);},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});}
async function copyText(text){try{await navigator.clipboard.writeText(text);return true;}catch{const box=document.createElement('textarea');box.value=text;box.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(box);box.focus();box.select();let ok=false;try{ok=document.execCommand('copy');}catch{}box.remove();return ok;}}
async function shareText(title,text,url){if(navigator.share){try{await navigator.share({title,text,url});return;}catch(e){if(e.name==='AbortError')return;}}const ok=await copyText(text+(url?'\n'+url:''));notify(ok?'Copied — ready to paste into your crew chat.':'Sharing is unavailable here. Copy the page link from your browser.');}
function updateClock(){const now=Date.now();let label,text;if(now<START_AT){label='STARTS IN';const mins=Math.ceil((START_AT-now)/60000);text=Math.floor(mins/60)+'h '+mins%60+'m';}else if(now<END_AT){label='RACE WINDOW · APPROX.';const mins=Math.max(0,Math.floor((END_AT-now)/60000));text=Math.floor(mins/60)+'h '+mins%60+'m remaining';}else{label='THE RACE WINDOW';text='13–14 Nov 2026';}$('#clock-caption').textContent=label;$('#race-clock').textContent=text;}
function updateConnection(){const offline=!navigator.onLine;$('#connection-status').innerHTML='<span class="tiny-dot" style="background:'+(offline?'#d69b38':'#7a9e68')+'"></span>'+(offline?'Offline':'On this phone');if(offline&&map)mapStatus('You’re offline. The saved route line and markers still work; street-map tiles may be missing.');}
async function refreshExistingOfflineGuide(){if(!('serviceWorker'in navigator)||!window.isSecureContext)return;try{const existing=await navigator.serviceWorker.getRegistration('./');if(!existing)return;offlineRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await offlineRegistration.update();}catch(error){console.info('Saved guide will update when a connection is available.');}}
function withGuideTimeout(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The update took too long. Your saved guide is still available; try again with a connection.')),ms);})]).finally(()=>clearTimeout(timer));}
async function activeOfflineWorker(registration,timeout=45000){const pending=registration.installing||registration.waiting;if(pending&&pending.state!=='activated'){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.removeEventListener('statechange',check);reject(new Error('Worker activation timed out'));},timeout);function check(){if(pending.state==='activated'){clearTimeout(timer);pending.removeEventListener('statechange',check);resolve();}else if(pending.state==='redundant'){clearTimeout(timer);pending.removeEventListener('statechange',check);reject(new Error('Worker installation failed'));}}pending.addEventListener('statechange',check);check();});}const worker=registration.active||navigator.serviceWorker.controller||(await withGuideTimeout(navigator.serviceWorker.ready,timeout)).active;if(!worker)throw new Error('No active worker');return worker;}
function requestGuideWorker(worker,message,timeout=45000){return new Promise((resolve,reject)=>{const channel=new MessageChannel();const finish=(error,data)=>{clearTimeout(timer);channel.port1.close();error?reject(error):resolve(data);};const timer=setTimeout(()=>finish(new Error('The update took too long. Your saved guide is still available; try again with a connection.')),timeout);channel.port1.onmessage=event=>finish(event.data?.ok?null:new Error(event.data?.error||'Cache incomplete'),event.data);try{worker.postMessage(message,[channel.port2]);}catch(error){finish(error);}});}
function guideUpdateMessage(message){const status=$('#guide-update-status');if(status)status.textContent=message;}
function reloadGuideOnce(manual=false){
 if(workerReloading)return false;
 try{
  if(!manual&&sessionStorage.getItem(AUTO_RELOAD_KEY)){guideUpdateMessage('An update is ready. Tap Update / reload guide when you’re ready.');return false;}
  sessionStorage.setItem(AUTO_RELOAD_KEY,'1');
 }catch{if(!manual){guideUpdateMessage('An update is ready. Tap Update / reload guide when you’re ready.');return false;}}
 workerReloading=true;
 setTimeout(()=>location.reload(),250);
 return true;
}
function handleGuideControllerChange(){if(!hadWorkerAtBoot||guideUpdateBusy)return;reloadGuideOnce();}
async function updateAndReloadGuide(){
 if(guideUpdateBusy||workerReloading)return;
 const button=$('#update-guide');
 if(navigator.onLine===false){guideUpdateMessage('You’re offline. Keep using the saved guide and update when you have a connection.');return;}
 guideUpdateBusy=true;if(button){button.disabled=true;button.textContent='Updating guide…';}
 guideUpdateMessage('Getting the latest guide. Your saved settings stay on this phone.');
 try{
  const existing='serviceWorker'in navigator&&window.isSecureContext?await withGuideTimeout(navigator.serviceWorker.getRegistration('./'),12000):null;
  if(existing){
   offlineRegistration=await withGuideTimeout(navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}),12000);
   await withGuideTimeout(offlineRegistration.update(),12000);
   const worker=await activeOfflineWorker(offlineRegistration,15000);
   await requestGuideWorker(worker,{type:'UPDATE_GUIDE',pathname:location.pathname},20000);
  }else{
   const response=await withGuideTimeout(fetch(location.href,{cache:'no-store'}),12000);
   if(!response.ok)throw new Error('The latest guide could not load. Please try again with a connection.');
  }
  guideUpdateMessage('Guide updated. Reloading…');reloadGuideOnce(true);
 }catch(error){guideUpdateMessage(error.message||'The guide could not update. Your saved guide is still available.');}
 finally{guideUpdateBusy=false;if(button){button.disabled=false;button.textContent='Update / reload guide';}}
}
function mountGuideUpdateControl(){
 const save=$('#save-offline');if(!save||$('#update-guide'))return;
 const button=document.createElement('button');button.id='update-guide';button.type='button';button.className='button secondary full';button.textContent='Update / reload guide';button.addEventListener('click',updateAndReloadGuide);
 const status=document.createElement('p');status.id='guide-update-status';status.className='small muted';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Get the latest guide while keeping your saved settings.';
 save.insertAdjacentElement('afterend',button);button.insertAdjacentElement('afterend',status);
}
async function saveOffline(){const button=$('#save-offline');if(!('serviceWorker'in navigator)||!window.isSecureContext){$('#offline-status').textContent='Offline saving is not available in this browser. Keep the guide open, or save screenshots before leaving signal.';return;}button.disabled=true;button.textContent='Saving…';try{offlineRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});const worker=await activeOfflineWorker(offlineRegistration);await requestGuideWorker(worker,{type:'CACHE_GUIDE',revealed:revealedPosterIds()});$('#offline-status').textContent='Saved on this phone: guide, route line and available pictures.';button.textContent='✓ Saved on this phone';notify('Guide saved. Live updates still need a connection.');}catch{$('#offline-status').textContent='The offline save did not complete. Try again with a connection before you set off.';button.textContent='Try offline save again';}finally{button.disabled=false;}}
function applyPreferences(){
 document.body.classList.toggle('night',state.theme==='night');
 document.body.classList.toggle('runner-mode',state.mode==='runner');
 $('#theme-toggle').textContent=state.theme==='night'?'☀ Day mode':'☾ Night mode';
 $('#theme-toggle').setAttribute('aria-label',state.theme==='night'?'Switch to day mode':'Switch to night mode');
 $$('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));
 $('meta[name="theme-color"]').content=state.theme==='night'?'#142b2a':'#fff8e9';
 window.dispatchEvent(new CustomEvent('modechange',{detail:{mode:state.mode,theme:state.theme}}));
}
function renderChecklists(){
 $('#checklists').innerHTML=KIT[state.mode].map((group,g)=>`<details class="paper-card checklist-card" ${g===0?'open':''}><summary>${esc(group.title)}</summary><div>${group.items.map((text,i)=>{const key=state.mode+':'+group.id+':'+i;return `<label><input type="checkbox" data-check="${key}" ${state.checks[key]?'checked':''}><span>${esc(text)}</span></label>`;}).join('')}</div><p class="small muted">Ticks stay on this phone.</p></details>`).join('');
 $$('[data-check]').forEach(input=>input.addEventListener('change',()=>{state.checks[input.dataset.check]=input.checked;persist();}));
}
function posterMomentText(id){
 const snapshot=window.liveGuide?.getSnapshot?.()||{};
 if(id==='marathon'){
  const records=window.raceMilestones?.mergeRecords?.(snapshot.achievements?.records)?.filter(item=>item.milestoneId==='marathon')||[];
  if(records.length&&window.raceMoments?.recordText)return records.map(record=>(record.runnerId==='emily'?'Emily':'Jeff')+' · '+window.raceMoments.recordText(record)).join(' · ');
 }
 const record=window.raceMilestones?.mergeRecords?.(snapshot.achievements?.records)?.find(item=>item.runnerId==='emily'&&item.milestoneId===id);
 if(record&&window.raceMoments?.recordText)return 'Emily · '+window.raceMoments.recordText(record);
 const at=state.unlocked[id];
 const shared=(snapshot.releases||[]).some(release=>release.id===id);
 return at?(shared?'Shared '+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at)+' · saved for everyone':'Saved on this phone'):'Automatically opens when Emily reaches it';
}
function renderPosters(){
 const crew=state.mode==='supporter'&&window.liveGuide?.getSnapshot?.().room?.owner===true;
 const snapshot=window.liveGuide?.getSnapshot?.()||{};
 const records=window.raceMilestones?.mergeRecords?.(snapshot.achievements?.records)||[];
 // Earned milestone posters live with their crossing records. The send-off and
 // manually released moments without a shared crossing still remain available.
 const visible=stops.filter(s=>{
  if(!state.unlocked[s.id])return false;
  if(s.id==='start')return true;
  const shared=(snapshot.releases||[]).some(release=>release.id===s.id);
  const inLedger=['marathon','gold'].includes(s.id)||snapshot.achievements?.persisted===true&&records.some(r=>r.runnerId==='emily'&&r.milestoneId===s.id);
  return !shared||!inLedger;
 });
 $$('#panel-milestones .crew-controls-only').forEach(el=>{el.hidden=!crew;});
 const link=$('#revealed-moments-link');if(link)link.hidden=false;
 if($('#moments-title'))$('#moments-title').textContent='Moments & milestones';
 const tile=s=>{
  const c=chapter(s),opened=Boolean(state.unlocked[s.id]),preview=opened?posterPath(s,'preview'):'';
  const tag=crew||opened?(s.id==='start'?'THE SEND-OFF':s.id==='marathon'?'MARATHON · 42.195 KM':s.id==='gold'?'GOLD CELEBRATION':s.routeKm+' KM'):'A LITTLE LOVE FROM YOUR CREW';
  return `<article class="poster-tile ${opened?'poster-revealed':'poster-tile-sealed'}"><div class="poster-summary">${opened&&preview?`<button class="poster-thumb" data-poster="${esc(s.id)}" aria-label="Open ${esc(c.title)} poster"><img src="${esc(preview)}" alt="${esc(c.cheer)}" width="80" height="120" loading="lazy"></button>`:'<span class="poster-seal" aria-hidden="true">♡</span>'}<div><p class="card-kicker">${tag}</p><h2>${esc(c.title)}</h2><p class="small muted">${esc(opened?posterMomentText(s.id):s.id==='start'?'Crew eyes only until released':s.id==='marathon'?'Opens after both marathon crossings are recorded':'Automatically opens when Emily reaches it')}</p></div></div>${opened?`<button class="button secondary full" data-replay-cheer="${esc(s.id)}">Enjoy this moment again ♡</button>`:`<button class="button secondary full" data-reveal="${esc(s.id)}">${s.id==='start'?'Release the send-off':s.id==='gold'?'Confirm gold & release':s.id==='marathon'?'Both reached a marathon? Release':'Reached '+s.routeKm+' km? Release'}</button>`}</article>`;
 };
 $('#poster-grid').innerHTML=visible.map(tile).join('');
 $('#poster-grid').hidden=!visible.length;
 const crewGrid=$('#crew-poster-grid');if(crewGrid)crewGrid.innerHTML=crew?stops.filter(s=>!state.unlocked[s.id]).map(tile).join(''):'';
 window.raceMoments?.refresh?.(snapshot);
}
let lastDrawerFocus=null;
function switchTab(tab,updateHash=true){
 const aliases={journey:'milestones',posters:'milestones',moments:'milestones',crew:'charging',map:'now',stops:'now'};tab=aliases[tab]||tab;
 if(!['now','allstops','more','charging','parkrun','kit','settings','live','meetup','point','facilities','person','milestones','leaderboard'].includes(tab))tab='now';
 if(state.mode==='runner' && ['charging','parkrun','allstops'].includes(tab))tab='now';
 if(tab==='charging'&&window.raceMap?.showAmenities){window.raceMap.showAmenities('charger');return;}
 const previous=currentTab, changed=currentTab!==tab;currentTab=tab;
 if(previous==='now'&&tab!=='now')lastDrawerFocus=document.activeElement;
 $$('.tab-panel').forEach(el=>{
  el.hidden=el.id!=='panel-now'&&el.id!=='panel-'+tab;
  if(el.id==='panel-now'){el.inert=tab!=='now';return;}
  if(!el.hidden){el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.tabIndex=-1;}
  else {el.removeAttribute('role');el.removeAttribute('aria-modal');}
 });
 $('#sheet-backdrop').hidden=tab==='now';
 if(updateHash)history.replaceState(null,'',location.pathname+location.search+'#'+tab);
 if(changed&&tab!=='now'){const panel=$('#panel-'+tab);panel.scrollTop=0;requestAnimationFrame(()=>panel.focus({preventScroll:true}));}
 if(changed&&tab==='now'&&lastDrawerFocus?.isConnected&&!lastDrawerFocus.closest('[hidden]'))lastDrawerFocus.focus({preventScroll:true});
 if(tab==='now')window.crewGuide?.refreshStatus();
 window.dispatchEvent(new CustomEvent('viewchange',{detail:{tab}}));
}
function markerIcon(stop){const label=stop.id==='start'?'GO':stop.id==='gold'?'GOLD':stop.routeKm;return L.divIcon({className:'route-pin milestone-pin',html:'<span>'+label+'</span>',iconSize:[42,36],iconAnchor:[21,18]});}
function initMap(){
 if(map||!guide)return;
 if(!window.L){$('#route-map').innerHTML='<div class="map-failure"><h2>Map unavailable</h2><p>Your stops still work.</p><a href="'+ORIGINAL_MAP+'" target="_blank" rel="noopener">Open Google route ↗</a></div>';return;}
 map=L.map('route-map',{scrollWheelZoom:false,zoomControl:true}).setView([guide.start.lat,guide.start.lng],9);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
 let tileErrors=0;tiles.on('tileerror',()=>{if(++tileErrors>=3)mapStatus('Street-map tiles are unavailable. The saved route and pins still work.');});
 if(fullRoute){mapLayers.legacy=L.geoJSON(fullRoute,{style:{color:'#8b9c98',weight:4,dashArray:'6 8',opacity:.7}});if($('#show-legacy').checked)mapLayers.legacy.addTo(map);}
 mapLayers.routeHalo=L.geoJSON(route,{style:{color:'#fff9ee',weight:9,opacity:.95}}).addTo(map);
 mapLayers.route=L.geoJSON(route,{style:{color:'#197b66',weight:4.5,opacity:1}}).addTo(map);
 mapLayers.gold=L.geoJSON(goldBoundary,{style:{color:'#b78317',weight:2,dashArray:'7 7',fill:false,opacity:.9}});
 L.circleMarker([guide.goldCrossing.lat,guide.goldCrossing.lng],{radius:6,color:'#9c6f10',fillColor:'#f6ce6a',fillOpacity:1,weight:2}).bindPopup('<strong>Estimated gold crossing</strong><br>About 105.3 route km.<br>Confirm using the official tracker.').addTo(mapLayers.gold);
 if($('#show-gold').checked)mapLayers.gold.addTo(map);
 mapLayers.milestones=L.layerGroup();
 for(const s of stops){
  const marker=L.marker([s.lat,s.lng],{icon:markerIcon(s),title:roundDistance(s.routeKm)+' · '+chapter(s).title,keyboard:true}).addTo(mapLayers.milestones);
  marker.on('click',()=>{window.supportGuide?.clearMapSelection();renderMilestoneMapDetail(s);});markers[s.id]=marker;
 }
 if($('#show-milestones').checked)mapLayers.milestones.addTo(map);
 map.fitBounds(mapLayers.route.getBounds(),{padding:[20,20]});renderMapDetail();
 window.crewGuide?.onMapReady(map);window.supportGuide?.onMapReady(map);window.liveGuide?.onMapReady(map);
}
function renderMilestoneMapDetail(s){$('#map-detail').innerHTML=`<span class="stage-tag">${esc(roundDistance(s.routeKm))} · poster reference</span><h2>${esc(chapter(s).title)}</h2><p class="small muted">${esc(s.locationNote||'The send-off in Meriden.')}</p><button class="button secondary full" data-tab-target="posters">Open sealed surprises →</button>`;}
function renderMapDetail(){if(window.supportGuide?.renderMapDetail())return;$('#map-detail').innerHTML='<p class="card-kicker">PICK OUR NEXT HELLO</p><h2>Tap a numbered pin</h2><p class="small muted">See its original meeting place and open directions.</p><button class="button secondary full" data-tab-target="stops">Choose from the stop list →</button>';}
function wireStaticControls(){
 document.addEventListener('keydown',event=>{if(event.defaultPrevented||window.guideIntro?.isBlocking?.())return;if(currentTab==='now'||document.querySelector('dialog[open]'))return;if(event.key==='Escape'){event.preventDefault();switchTab('now');return;}if(event.key!=='Tab')return;const panel=$('#panel-'+currentTab);const controls=$$('button:not([disabled]),a[href],input:not([disabled]),select,textarea,summary,[tabindex="0"]',panel).filter(el=>el.getClientRects().length);if(!controls.length){event.preventDefault();return;}const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
 $('#theme-toggle').addEventListener('click',()=>{state.theme=state.theme==='night'?'day':'night';persist();applyPreferences();});
 $$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.mode=b.dataset.mode;persist();applyPreferences();renderChecklists();renderPosters();window.supportGuide?.render();window.crewGuide?.refreshStatus();switchTab('now');}));
 document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-tab]');if(tab)switchTab(tab.dataset.tab);
  const target=event.target.closest('[data-tab-target]');if(target)switchTab(target.dataset.tabTarget);
  const poster=event.target.closest('[data-poster]');if(poster)showPoster(poster.dataset.poster);
  const reveal=event.target.closest('[data-reveal]');if(reveal)confirmReveal(reveal.dataset.reveal);
  const relock=event.target.closest('[data-relock]');if(relock)relockPoster(relock.dataset.relock);
 });
 window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#crew='))switchTab(location.hash.slice(1),false);});
 $('#share-guide').addEventListener('click',()=>shareText('Emily & Jeff’s Great Escape','Our pocket race guide — route, meet-ups & a very supportive crow.',location.origin+'/'));
 $('#fit-route').addEventListener('click',()=>{initMap();if(map)map.fitBounds(($('#show-legacy').checked&&mapLayers.legacy?mapLayers.legacy:mapLayers.route).getBounds(),{padding:[20,20]});});
 for(const [id,key] of [['show-gold','gold'],['show-milestones','milestones']])$('#'+id).addEventListener('change',event=>{if(!map||!mapLayers[key])return;event.target.checked?mapLayers[key].addTo(map):map.removeLayer(mapLayers[key]);});
 $('#show-legacy').addEventListener('change',event=>{if(!map||!mapLayers.legacy)return;if(event.target.checked){mapLayers.legacy.addTo(map);mapLayers.route.bringToFront();map.fitBounds(mapLayers.legacy.getBounds(),{padding:[20,20]});}else{map.removeLayer(mapLayers.legacy);map.fitBounds(mapLayers.route.getBounds(),{padding:[20,20]});}});
 $('#locate-me').addEventListener('click',()=>locate(false));$('#help-location').addEventListener('click',()=>locate(true));
 $('#close-poster').addEventListener('click',clearPosterDialog);
 $('#poster-dialog').addEventListener('click',event=>{if(event.target===$('#poster-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)clearPosterDialog();}});
 $('#fullscreen-poster').addEventListener('click',async()=>{try{if($('#poster-dialog').requestFullscreen)await $('#poster-dialog').requestFullscreen();else window.open($('#dialog-poster').src,'_blank','noopener');}catch{notify('Download the image for a larger view.');}});
 $('#poster-dialog').addEventListener('close',()=>{if(document.fullscreenElement===$('#poster-dialog'))document.exitFullscreen().catch(()=>{});$('#poster-dialog').removeAttribute('data-poster-id');$('#dialog-poster').removeAttribute('src');$('#dialog-poster').alt='';$('#download-poster').removeAttribute('href');$('#download-poster').removeAttribute('download');posterImageStatus('');});
 $('#dialog-poster').addEventListener('load',()=>posterImageStatus(''));
 $('#dialog-poster').addEventListener('error',()=>{if($('#dialog-poster').getAttribute('src'))posterImageStatus('This poster needs a connection the first time. Try again when you have signal.',true);});
 $('#save-offline').addEventListener('click',saveOffline);
 mountGuideUpdateControl();
 $('#reset-device').addEventListener('click',()=>{if(!confirm('Clear this phone’s saved notes, checklists and pictures? The shared crew plan will stay available.'))return;state={...DEFAULTS,theme:state.theme,mode:state.mode,marks:{},notes:{},checks:{},unlocked:{}};clearPosterDialog();persist();applyPreferences();renderChecklists();renderPosters();window.supportGuide?.reset();window.crewGuide?.reset();renderMapDetail();syncRevealedCache();notify('Saved notes cleared on this phone.');});
 navigator.serviceWorker?.addEventListener('controllerchange',handleGuideControllerChange);
 window.addEventListener('online',()=>{updateConnection();refreshExistingOfflineGuide();});window.addEventListener('offline',updateConnection);
}
async function boot(){
 applyPreferences();wireStaticControls();renderChecklists();updateClock();updateConnection();refreshExistingOfflineGuide();
 setInterval(()=>{if(!document.hidden)updateClock();},30000);
 try{
  const read=async name=>{const r=await fetch('data/'+name);if(!r.ok)throw new Error('Guide file unavailable');return r.json();};
  const loaded=await Promise.all([read('guide-data.json'),read('route.geojson'),read('estimated-gold-boundary.geojson'),read('route-full-2025.geojson').catch(()=>null),read('poster-manifest.json').catch(()=>null)]);
  [guide,route,goldBoundary,fullRoute]=loaded;if(loaded[4])posterFiles={...posterFiles,...loaded[4]};
  if(!fullRoute){$('#show-legacy').checked=false;$('#show-legacy').disabled=true;}
  stops=[{id:'start',routeKm:0,lat:guide.start.lat,lng:guide.start.lng,place:'Meriden'},...guide.stops];
  renderPosters();syncRevealedCache();window.dispatchEvent(new Event('guideready'));switchTab(location.hash.slice(1)||'now',false);
  if(navigator.serviceWorker?.controller){$('#offline-status').textContent='A guide is saved on this phone. Refresh it while you have a connection.';$('#save-offline').textContent='Refresh saved guide';}
 }catch(error){console.error('Guide load failed:',error);$('#poster-grid').innerHTML=state.mode==='supporter'?'<p>Pictures need a connection to load. Please refresh when you have signal.</p>':'';switchTab(location.hash.slice(1)||'now',false);}
}
boot();
