'use strict';
(() => {
 const CREW_KEY='meriden-support-crew-v1';
 const TRACKER_URL='https://track.trail.live/event/escapefrommeriden';
 // Emily continues the race. Jeff now shares his own phone location as crew.
 const REGISTERED_RUNNERS=Object.freeze([
  Object.freeze({id:'emily',name:'Emily Simmons',shortName:'Emily',bib:'247'})
 ]);
 const PARK_PLANS={tentative:'Decide on the morning',going:'Planning to go',skipping:'Skipping this time'};
 const READY_CHECKS=[
  ['positions','Check Emily’s live tracker'],
  ['agree','Agree their next meet-up and our return plan'],
  ['event','Check event news and cancellations'],
  ['time','Allow time to park, reach the start and return']
 ];
 let stored={};
 try{stored=JSON.parse(localStorage.getItem(CREW_KEY)||'{}')||{};}catch{}
 const crewState={bib:'',parkrun:'tentative',crewNote:'',...stored,ready:{...stored.ready}};
 if(!Object.hasOwn(PARK_PLANS,crewState.parkrun))crewState.parkrun='tentative';
 let crewData,crewMap,crewLayer,crewMarkers={},saveStatus='';
 const q=s=>document.querySelector(s);
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const driveUrl=query=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(query)+'&travelmode=driving';
 const currentBib=()=>REGISTERED_RUNNERS.map(person=>person.bib).join(',');
 const setText=(selector,text)=>{const el=q(selector);if(el)el.textContent=text;};
 function save(){
  try{
   localStorage.setItem(CREW_KEY,JSON.stringify(crewState));
   saveStatus='Saved on this phone. Share changes with the crew.';
   return true;
  }catch{
   saveStatus='This change is for this visit only; your browser could not save it.';
   notify('This browser could not save the crew plan. Changes will last for this visit only.');
   return false;
  }
 }
 function refreshStatus(){
  const bib=currentBib();
  setText('#bib-header','Emily 247');
  const parkStatus={tentative:'09:00 · decide later',going:'09:00 · planning to go',skipping:'Skipping this time'};
  setText('#parkrun-now-status',parkStatus[crewState.parkrun]);
 }
 function renderTracker(){
  const bib=currentBib();
  const live=window.liveGuide?.getSnapshot?.();
  setText('#race-number-status','Emily #247');
  if(q('#race-number-controls'))q('#race-number-controls').hidden=true;
  if(q('#race-number-input')&&document.activeElement!==q('#race-number-input'))q('#race-number-input').value=bib;
  if(q('#copy-race-number'))q('#copy-race-number').disabled=!bib;
  setText('#race-number-help','Emily’s official tracker supplies race progress and arrival estimates. Huiyan, Graham, Jeff and Ben share their own phone locations as the support crew.');
  refreshStatus();
 }
 function sourceLinks(stop,limit=99){
  return (stop.sources||[]).slice(0,limit).map(source=>`<a href="${safe(source.url)}" target="_blank" rel="noopener">${safe(source.label)} →</a>`).join('');
 }
 function renderCrew(){
  if(!crewData)return;
  const park=crewData.stops.find(stop=>stop.kind==='parkrun');
  const parkCard=q('#parkrun-card');
  if(park&&parkCard)parkCard.innerHTML=`
   <div class="parkrun-top"><span class="crew-badge parkrun-badge" aria-hidden="true">5K</span><div><p class="card-kicker">OPTIONAL CREW ADVENTURE</p><h3>${safe(park.title)}</h3></div></div>
   <p class="parkrun-time-hero">${safe(park.startTimeLabel||'09:00')} <span>${safe(park.dayLabel||park.timeLabel)}</span></p>
   <p class="crew-access-status"><strong>${safe(park.eventStatus)}</strong></p>
   <p>Decide together around Emily’s next support stop.</p>
   <div class="parkrun-plan"><p class="field-label" id="parkrun-plan-label">Our plan <span class="muted">· on this phone</span></p>
    <div class="parkrun-plan-options" role="group" aria-labelledby="parkrun-plan-label" aria-describedby="parkrun-plan-note">
     <button class="button secondary parkrun-plan-option" type="button" data-parkrun-plan="tentative" aria-pressed="false">Decide later</button>
     <button class="button secondary parkrun-plan-option" type="button" data-parkrun-plan="going" aria-pressed="false">Plan to go</button>
     <button class="button secondary parkrun-plan-option" type="button" data-parkrun-plan="skipping" aria-pressed="false">Skip</button>
    </div><p id="parkrun-plan-note"></p>
   </div>
   <div class="crew-actions crew-primary-actions">
    <a class="button primary" href="${driveUrl(park.parkingQuery)}" target="_blank" rel="noopener">Parking directions →</a>
    <button class="button secondary" type="button" data-crew-map="${safe(park.id)}">Show on map</button>
   </div>
   <details class="crew-details parkrun-ready"><summary>Before we go <span id="parkrun-ready-count"></span></summary><div class="crew-checks">${READY_CHECKS.map(([key,label])=>`<label><input type="checkbox" data-crew-check="${key}" ${crewState.ready[key]?'checked':''}><span>${label}</span></label>`).join('')}</div></details>
   <details class="crew-details crew-sources"><summary>Event updates, parking & sources</summary><div class="crew-details-body">
    <p>${safe(park.hoursDetail)}</p><p><strong>Parking:</strong> ${safe(park.parking)}</p>
    <a class="button secondary" href="${safe(park.operatorUrl)}" target="_blank" rel="noopener">Official event →</a>
    <div class="crew-source-links">${sourceLinks(park)}</div>
    <p class="muted crew-pin-note">Event pin near route km ${park.routeKm.toFixed(1)} on the old plan. This does not predict the runners’ position at 09:00.</p>
   </div></details>
   <p class="crew-local-note muted" id="parkrun-save-status" role="status"></p>`;
  updateParkPlan();
  const note=q('#crew-meeting-note');if(note)note.value=crewState.crewNote||'';
 }
 function updateParkPlan(){
  const notes={
   tentative:'Keep it flexible. Check their tracker and next meet-up before deciding.',
   going:'A little run for the crew too. Confirm support is covered before leaving.',
   skipping:'Staying with the support plan today. Another parkrun can wait.'
  };
  setText('#parkrun-plan-note',notes[crewState.parkrun]);
  document.querySelectorAll('[data-parkrun-plan]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.parkrunPlan===crewState.parkrun)));
  setText('#parkrun-ready-count','· '+READY_CHECKS.filter(([key])=>crewState.ready[key]).length+'/'+READY_CHECKS.length+' ready');
  setText('#parkrun-save-status',saveStatus||'Your plan is for this phone. Share it with the crew.');
  refreshStatus();
 }
 function renderCrewMapDetail(stop){
  window.supportGuide?.clearMapSelection();
  const detail=q('#map-detail');if(!detail)return;
  const park=stop.kind==='parkrun';
  detail.innerHTML=`<div class="map-place-info"><span class="stage-tag">${park?'OPTIONAL 09:00 PARKRUN':'CREW CHARGING'}</span><h3>${safe(stop.title)}</h3><p>${safe(stop.address)}</p><p><strong>${safe(park?stop.timeLabel+' · tentative':stop.hours)}</strong></p></div><p class="muted">~${stop.routeKm.toFixed(1)} km along the planned route</p><a class="button primary" href="${driveUrl(park?stop.parkingQuery:stop.mapQuery)}" target="_blank" rel="noopener">${park?'Parking directions':'Directions'} →</a><button class="button secondary" type="button" data-tab-target="${park?'parkrun':'charging'}">${park?'Open parkrun plan':'Charging details'}</button><p class="crew-pin-note muted">${safe(stop.pinNote)}</p>`;
 }
 function addCrewMarkers(){
  if(!crewMap||!crewData||crewLayer||typeof L==='undefined')return;
  crewLayer=L.layerGroup();
  crewData.stops.forEach(stop=>{
   const park=stop.kind==='parkrun';
   const icon=L.divIcon({className:'crew-map-pin '+(park?'parkrun-pin':''),html:'<span>'+(park?'5K':'EV')+'</span>',iconSize:[34,34],iconAnchor:[17,17]});
   const marker=L.marker([stop.lat,stop.lng],{icon,title:stop.title,zIndexOffset:150}).addTo(crewLayer);
   const detail=park?stop.timeLabel+' · tentative':stop.hours;
   marker.bindPopup(`<strong>${safe(stop.title)}</strong><br>${safe(detail)}<br><button type="button" data-open-crew="${safe(stop.id)}">${park?'Parkrun plan':'Charging details'}</button>`);
   marker.on('click',()=>renderCrewMapDetail(stop));
   marker.on('popupopen',event=>event.popup.getElement()?.querySelector('[data-open-crew]')?.addEventListener('click',()=>{
    switchTab(park?'parkrun':'charging');
    q(park?'#parkrun-card':'#crew-stop-'+stop.id)?.scrollIntoView({block:'start',behavior:'smooth'});
   }));
   crewMarkers[stop.id]=marker;
  });
  if(q('#show-crew')?.checked)crewLayer.addTo(crewMap);
 }
 function onMapReady(mapInstance){
  if(crewMap&&crewMap!==mapInstance){crewLayer=null;crewMarkers={};}
  crewMap=mapInstance;addCrewMarkers();
 }
 function showCrewPin(id){
  const primaryStop=crewData?.stops.find(item=>item.id===id);if(primaryStop&&window.raceMap){window.raceMap.focusPoint({...primaryStop,name:primaryStop.title});return;}
  switchTab('map');
  if(!crewMap||!crewData){notify('The map is still getting ready. Try again in a moment.');return;}
  const stop=crewData.stops.find(item=>item.id===id);if(!stop)return;
  if(q('#show-crew'))q('#show-crew').checked=true;
  if(crewLayer&&!crewMap.hasLayer(crewLayer))crewLayer.addTo(crewMap);
  renderCrewMapDetail(stop);crewMap.setView([stop.lat,stop.lng],15);crewMarkers[id]?.openPopup();
  q('#route-map')?.scrollIntoView({block:'start',behavior:'smooth'});
 }
 window.crewGuide={
  onMapReady,refreshStatus,
  getBib:currentBib,
  getRunners:()=>REGISTERED_RUNNERS.map(person=>({...person})),
  setSharedBib(bib){crewState.bib=String(bib||'').slice(0,24);save();renderTracker();},
  reset(){
   crewState.bib='';crewState.parkrun='tentative';crewState.crewNote='';crewState.ready={};
   const saved=save();
   if(q('#crew-meeting-note'))q('#crew-meeting-note').value='';
   setText('#crew-note-status',saved?'Saved on this phone only.':'Not saved in this browser.');
   renderTracker();renderCrew();
  }
 };
 if(typeof map!=='undefined'&&map)onMapReady(map);
 q('#save-race-number')?.addEventListener('click',()=>{
  if(window.liveGuide?.getSnapshot?.().room?.owner!==true){notify('The supporters set the race number for everyone.');return;}
  const bib=q('#race-number-input')?.value.trim()||'';
  if(!/^[a-z0-9 ,/-]{0,24}$/i.test(bib)){notify('Use the race number shown in the tracker.');return;}
  crewState.bib=bib;const saved=save();renderTracker();window.dispatchEvent(new CustomEvent('racebibchange',{detail:{bib}}));
  if(saved)notify(bib?'Race number saved. Sharing the update with everyone…':'Race number cleared. Sharing the update…');
 });
 q('#copy-race-number')?.addEventListener('click',async()=>{
  const bib='Emily Simmons: 247';
  notify(await copyText(bib)?'Emily’s race number copied.':'Emily is 247.');
 });
 q('#show-crew')?.addEventListener('change',event=>{
  if(!crewMap||!crewLayer)return;
  if(event.target.checked)crewLayer.addTo(crewMap);
  else{
   crewMap.removeLayer(crewLayer);
   if(window.supportGuide?.renderMapDetail)window.supportGuide.renderMapDetail();
   else if(typeof renderMapDetail==='function')renderMapDetail();
  }
 });
 document.addEventListener('click',event=>{
  const copyRunner=event.target.closest('[data-copy-runner]');
  if(copyRunner){const person=REGISTERED_RUNNERS.find(p=>p.id===copyRunner.dataset.copyRunner);if(person)copyText(person.bib).then(copied=>notify(copied?person.shortName+'’s number copied: '+person.bib:person.shortName+'’s number is '+person.bib));return;}
  const mapButton=event.target.closest('[data-crew-map]');if(mapButton)showCrewPin(mapButton.dataset.crewMap);
  const planButton=event.target.closest('[data-parkrun-plan]');
  if(planButton&&Object.hasOwn(PARK_PLANS,planButton.dataset.parkrunPlan)){
   crewState.parkrun=planButton.dataset.parkrunPlan;save();updateParkPlan();
  }
 });
 document.addEventListener('change',event=>{
  const input=event.target.closest('[data-crew-check]');if(!input)return;
  crewState.ready[input.dataset.crewCheck]=input.checked;save();updateParkPlan();
 });
 q('#crew-meeting-note')?.addEventListener('input',event=>{
  crewState.crewNote=event.target.value;
  setText('#crew-note-status',save()?'Saved on this phone.':'Not saved in this browser.');
 });
 q('#share-crew-plan')?.addEventListener('click',()=>{
  const bib=currentBib();
  const text=`Emily & Jeff’s support crew — Graham & the family crew\nWatermeadows parkrun at 09:00: ${PARK_PLANS[crewState.parkrun]}\nCrew note: ${crewState.crewNote||'Next meeting point and return plan still to be agreed.'}${bib?'\nRace number: '+bib:''}\nTracker: ${TRACKER_URL}`;
  const url=new URL(location.href);url.search='';url.hash='parkrun';
  shareText('Emily & Jeff · Crew plan',text,url.href);
 });
 window.addEventListener('liveupdate',()=>renderTracker());
 renderTracker();
 fetch('data/crew-stops.json').then(response=>{if(!response.ok)throw new Error('Crew data unavailable');return response.json();}).then(data=>{
  crewData=data;renderTracker();renderCrew();addCrewMarkers();
 }).catch(()=>{
  const park=q('#parkrun-card');if(park)park.innerHTML='<h3>Watermeadows parkrun</h3><p class="parkrun-time-hero">09:00 <span>Saturday · tentative</span></p><p>Check the event’s updates and the runners’ next support needs before leaving.</p><a class="button primary" href="https://www.parkrun.org.uk/watermeadows/" target="_blank" rel="noopener">Official event →</a>';
  refreshStatus();
 });
})();
