'use strict';
(() => {
  const KEY = 'meriden-meeting-points-v1';
  const q = selector => document.querySelector(selector);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = () => ({selectedId:null, statuses:{}, custom:[], addedEvPointIds:[], progressKm:null, progressAt:null, afterMetId:null, history:[]});
  let local = empty(), migrateLocalEv=true;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (stored && typeof stored === 'object') { local = {...local, ...stored}; migrateLocalEv=!Array.isArray(stored.addedEvPointIds); }
  } catch {}
  if (!local.statuses || typeof local.statuses !== 'object' || Array.isArray(local.statuses)) local.statuses = {};
  if (!Array.isArray(local.custom)) local.custom = [];
  if (!Array.isArray(local.history)) local.history = [];
  local.addedEvPointIds=Array.isArray(local.addedEvPointIds)?[...new Set(local.addedEvPointIds.filter(id=>typeof id==='string'&&/^[a-z0-9_-]{1,80}$/i.test(id)))]:[];
  if (local.progressKm === '' || local.progressKm === null || !Number.isFinite(Number(local.progressKm))) local.progressKm = null;
  else local.progressKm = Math.max(0, Math.min(250, Number(local.progressKm)));
  let data, points = [], supportMap, mainLayer, onwardLayer, markerById = {}, mapSelectionId = null, loadingError = false, saveWarned = false, trackerProgress = null, sharedMeetup = null, ownedMeetup = null, sharedRoomActive = false;
  let sharedCheckpointActive=false, sharedCheckpointStatuses={}, sharedCompletedIds=[], sharedAddedEvIds=[], sharedEvListExplicit=false, evActionBusy=false;
  const storedStatus = id => sharedCheckpointStatuses[id]?.status || (sharedCompletedIds.includes(id)?'passed':null)
    || (data?.confirmedPassedPointIds?.includes(id)&&selected()?.id!==id?'passed':null)
    || (sharedRoomActive||sharedCheckpointActive?'available':local.statuses[id]?.status||'available');
  const status = id => {
    const value=storedStatus(id);
    if(value!=='available'||!points.find(p=>p.id===id)?.optionalMeetup)return value;
    // A newly researched charger must not reopen a group the crew has already
    // completed. Older saved plans may predate this extra alternative.
    const group=data?.groups.find(g=>g.options.some(p=>p.id===id));
    return group?.options.some(p=>p.id!==id&&['met','skipped','passed'].includes(storedStatus(p.id)))?'skipped':value;
  };
  const isDone = id => ['met','skipped','passed'].includes(status(id));
  const allPoints = () => {
    const result=[...points,...(sharedRoomActive?[]:local.custom)], remote=sharedRoomActive?sharedMeetup:ownedMeetup;
    if(remote){
      const index=result.findIndex(p=>p.id===remote.id);
      if(index<0)result.push(remote);else result[index]=remote;
    }
    return result;
  };
  const point = id => allPoints().find(p => p.id === id);
  const selected = () => sharedRoomActive ? sharedMeetup : point(local.selectedId);
  const isEvAdded = id => {
    if(!point(id)?.optionalMeetup)return false;
    if(selected()?.id===id)return true;
    if(sharedCheckpointActive||sharedRoomActive)return sharedEvListExplicit?sharedAddedEvIds.includes(id):sharedCheckpointStatuses[id]?.status==='met';
    return local.addedEvPointIds.includes(id);
  };
  const inMeetingList = p => !p.optionalMeetup||isEvAdded(p.id);
  const planStatuses = () => {
    const selectedId=selected()?.id;
    const statuses=sharedRoomActive||sharedCheckpointActive?{}:Object.fromEntries(Object.entries(local.statuses).filter(([id,v])=>v&&['met','skipped'].includes(v.status)&&id!==selectedId).map(([id,v])=>[id,{status:v.status}]));
    // Crew-confirmed progress applies to every viewer, even during a tracker
    // outage. Keep the point in the full list and honour a current agreement.
    const passed=Array.isArray(data?.confirmedPassedPointIds)?data.confirmedPassedPointIds:[];
    for(const id of passed)if(id!==selectedId&&points.some(p=>p.id===id))statuses[id]={status:'passed'};
    for(const id of sharedCompletedIds)if(points.some(p=>p.id===id))statuses[id]={status:'passed'};
    for(const [id,value] of Object.entries(sharedCheckpointStatuses))if(points.some(p=>p.id===id))statuses[id]={...value};
    for(const p of points)if(p.optionalMeetup&&!statuses[p.id]&&status(p.id)==='skipped')statuses[p.id]={status:'skipped'};
    return statuses;
  };
  const title = p => {
    const label=p.kind === 'custom-meetup' ? p.name : p.label;
    return p.town&&!String(label).includes(p.town) ? label+' · '+p.town : label;
  };
  const distance = p => Number.isFinite(p.routeKm) ? `Approx. route km ${p.routeKm.toFixed(1)}` : 'Distance to agree';
  function distanceMarkup(p) {
    const crow=window.routeDistances?.crowKm?.(p);
    return '<span class="support-distance-metric">'+safe(distance(p))+' · planned on foot</span>'+
      '<span class="support-distance-metric">'+(Number.isFinite(crow)?'Crow flight from Meriden · approx. '+crow.toFixed(1)+' km':'Crow-flight distance · pin unavailable')+'</span>';
  }
  const mode = () => typeof state !== 'undefined' && state.mode === 'runner' ? 'walking' : 'driving';
  const canEditPlan = () => mode() === 'driving' && !sharedRoomActive&&!window.liveGuide?.getSnapshot?.().checkpointActionBusy;
  const canStamp = () => mode()==='driving'&&Boolean(window.liveGuide?.getSnapshot?.().room?.canManageCheckpoints);
  const canChoose = p => mode()==='driving'&&!window.liveGuide?.getSnapshot?.().checkpointActionBusy
    && (canEditPlan() || Boolean(canStamp()&&!p?.beyondPlannedFinish&&points.some(original=>original.id===p?.id)));
  function mapsUrl(p) {
    if ((p.kind === 'custom-meetup' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) && p.mapUrl) return p.mapUrl;
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.lat + ',' + p.lng) + '&travelmode=' + mode();
  }
  function validMapUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const google = /^(?:www\.|maps\.)?google\.(?:com|co\.uk)$/.test(host) && (host.startsWith('maps.') || url.pathname.startsWith('/maps'));
      return url.protocol === 'https:' && !url.username && !url.password && (host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps')) || google) ? url.href : null;
    } catch { return null; }
  }
  function normalizeMeetup(meetup) {
    if(!meetup||typeof meetup!=='object')return null;
    const lat=Number.isFinite(meetup.lat)&&Math.abs(meetup.lat)<=90?meetup.lat:null;
    const lng=Number.isFinite(meetup.lng)&&Math.abs(meetup.lng)<=180?meetup.lng:null;
    const mapUrl=validMapUrl(meetup.mapUrl||'');
    if((lat===null||lng===null)&&!mapUrl)return null;
    const id=String(meetup.id||'shared-meetup').slice(0,120);
    const original=points.find(p=>p.id===id)||local.custom.find(p=>p.id===id);
    const label=String(meetup.label||meetup.name||original?.label||'Agreed meeting place').slice(0,120);
    return {...original,id,label,name:label,detail:String(meetup.note||meetup.detail||original?.detail||label).slice(0,500),routeKm:Number.isFinite(meetup.routeKm)?meetup.routeKm:original?.routeKm??null,lat,lng,mapUrl,kind:original?.kind||(id.startsWith('custom-')?'custom-meetup':'shared-meetup')};
  }
  local.custom = local.custom.filter(p => p && typeof p.id === 'string' && p.id.startsWith('custom-') && typeof p.name === 'string' && validMapUrl(p.mapUrl)).slice(0, 50).map(p => ({...p, kind:'custom-meetup', routeKm:p.routeKm !== null && Number.isFinite(Number(p.routeKm)) ? Number(p.routeKm) : null}));
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(local)); return true; }
    catch { if (!saveWarned) { notify('This browser cannot save the meeting plan. Share the agreed spot with your crew.'); saveWarned = true; } return false; }
  }
  function snapshot() { const {history, ...rest} = local; return JSON.parse(JSON.stringify(rest)); }
  function change(label, update) {
    local.history = [...local.history.slice(-11), {label, before:snapshot()}];
    update(); save(); render(); dispatchChange();
  }
  function undo() {
    const entry = local.history.pop();
    if (!entry?.before) return;
    const history = local.history;
    local = {...empty(), ...entry.before, history};
    save(); render(); dispatchChange(); notify('Undone on this phone.');
  }
  function recentMet() {
    const at=id=>Date.parse(sharedCheckpointStatuses[id]?.at||'')||local.statuses[id]?.at||0;
    return allPoints().filter(p => status(p.id) === 'met').sort((a,b) => at(b.id)-at(a.id))[0];
  }
  function suggested() {
    const last = recentMet();
    const bases = [trackerProgress?.fresh ? trackerProgress.routeKm : null, local.progressKm, last?.routeKm].filter(v => Number.isFinite(v));
    if (!bases.length) return null;
    const base = Math.max(...bases), target = base + 10;
    const choices = allPoints().filter(p => !p.optionalMeetup && !isDone(p.id) && Number.isFinite(p.routeKm) && p.routeKm > base + .1 && p.routeKm <= data.planningEndKm);
    choices.sort((a,b) => Math.abs(a.routeKm-target)-Math.abs(b.routeKm-target) || a.routeKm-b.routeKm);
    return choices[0] ? {point:choices[0], base, gap:choices[0].routeKm-base} : null;
  }
  function closestUpcoming() {
    if (!data || !trackerProgress?.fresh) return null;
    return allPoints().filter(p => !p.optionalMeetup && !isDone(p.id) && Number.isFinite(p.routeKm) && p.routeKm >= trackerProgress.routeKm && p.routeKm <= data.planningEndKm)
      .sort((a,b) => a.routeKm-b.routeKm)[0] || null;
  }
  function dispatchChange(reason='change') {
    const p=selected();
    window.dispatchEvent(new CustomEvent('supportchange',{detail:{selected:p?{...p}:null,reason}}));
  }
  function untilMeeting(p) {
    const snapshot=window.liveGuide?.getSnapshot?.() || {};
    const km=Object.prototype.hasOwnProperty.call(snapshot,'runners')
      ? snapshot.runner ? meetingProgress(snapshot) : null
      : trackerProgress?.fresh ? trackerProgress.routeKm : null;
    if (!Number.isFinite(km) || !Number.isFinite(p.routeKm)) return '';
    const gap=p.routeKm-km;
    return `<p class="support-to-go"><strong>${Math.abs(gap)<.15?'Near this meeting point':gap>0?`About ${gap.toFixed(1)} route km to go`:`This pin is about ${Math.abs(gap).toFixed(1)} km behind`}</strong><span class="small muted"> · estimated from the latest tracker position</span></p>`;
  }
  function nearbyAfterMet() {
    const met = point(local.afterMetId);
    if (!met || !Number.isFinite(met.routeKm)) return [];
    return allPoints().filter(p => inMeetingList(p) && p.id !== met.id && !isDone(p.id) && Number.isFinite(p.routeKm) && Math.abs(p.routeKm-met.routeKm) <= 2.5)
      .sort((a,b) => a.routeKm-b.routeKm);
  }
  async function choose(id) {
    if(mode()==='walking')return;
    if(window.liveGuide?.getSnapshot?.().checkpointActionBusy){notify('The checkpoint is saving. Please wait a moment.');return;}
    const p = point(id); if (!p || isDone(id)) return;
    if(!canChoose(p)){notify('Connect your supporter phone to choose the next meet-up for everyone.');return;}
    if(canStamp()&&!p.beyondPlannedFinish&&points.some(original=>original.id===id)){
      const result=await window.liveGuide?.selectCheckpoint?.(id);
      if(!result?.ok)return;
      switchTab('now');window.raceMap?.follow();return;
    }
    change('Choose ' + title(p), () => { local.selectedId = id; local.afterMetId = null; if(p.optionalMeetup&&!local.addedEvPointIds.includes(id))local.addedEvPointIds.push(id); });
    switchTab('now');
    window.raceMap?.follow();
    notify(title(p) + ' is the next meet-up. Updates appear on the race guide.');
  }
  async function updateEvList(id,add) {
    const p=points.find(p=>p.id===id&&p.optionalMeetup&&!p.beyondPlannedFinish),live=window.liveGuide?.getSnapshot?.()||{};
    if(!p||mode()==='walking')return {ok:false};
    if(evActionBusy||live.checkpointActionBusy){notify('The meeting plan is saving. Please wait a moment.');return {ok:false};}
    if(!canChoose(p)||(live.room?.joined&&!live.room.owner&&!live.room.canManageCheckpoints)){
      notify('Connect your supporter phone to change the meeting list for everyone.');return {ok:false};
    }
    if(!add&&selected()?.id===id){notify('Choose another next meet-up before removing this one.');return {ok:false};}
    if(isEvAdded(id)===add)return {ok:true,pointId:id,action:add?'add-ev':'remove-ev'};
    const shared=sharedCheckpointActive||sharedRoomActive||live.room?.joined||canStamp();
    if(shared){
      const action=add?window.liveGuide?.addEvMeetup:window.liveGuide?.removeEvMeetup;
      if(typeof action!=='function'){notify('Meeting-list updates are still loading. Please try again.');return {ok:false};}
      evActionBusy=true;
      try{return await action(id)||{ok:false};}
      catch{notify('The meeting list could not be saved. Please try again.');return {ok:false};}
      finally{evActionBusy=false;}
    }
    change((add?'Add ':'Remove ')+title(p)+(add?' to':' from')+' meet-ups',()=>{
      local.addedEvPointIds=add?[...local.addedEvPointIds,id]:local.addedEvPointIds.filter(value=>value!==id);
    });
    notify(add?'Added to your meet-up options. Your next meet-up stays the same.':'Removed from your meet-up options.');
    return {ok:true,pointId:id,action:add?'add-ev':'remove-ev'};
  }
  function mark(id, value) {
    const p = point(id); if (!p) return;
    if(sharedCheckpointActive||sharedRoomActive){
      if(canStamp())return value==='met'?window.liveGuide.completeCheckpoint(id):window.liveGuide.skipCheckpoint(id);
      notify('Connect your supporter phone to stamp this stop for everyone.');return;
    }
    change((value === 'met' ? 'Met at ' : 'Skipped ') + title(p), () => {
      local.statuses[id] = {status:value, at:Date.now()};
      if (local.selectedId === id) local.selectedId = null;
      if (value === 'met') local.afterMetId = id;
    });
    notify(value === 'met' ? 'Meet-up marked. Choose the next hello when you’re ready. ♡' : 'Skipped on this phone. Undo is available.');
  }
  function reopen(id) {
    const p = point(id); if (!p) return;
    change('Make ' + title(p) + ' available', () => { delete local.statuses[id]; });
    notify(title(p) + ' is available again.');
  }
  function share(p) {
    const description = p.kind === 'custom-meetup' ? 'Agreed custom meeting place' : p.landmark?.meetingNote || p.detail;
    const text = `Emily & Jeff · next meet-up\n${title(p)} — ${description}\n${distance(p)}\nPlease confirm the exact spot together.\n${mapsUrl(p)}`;
    // Share the actual agreed location, not local state that other phones cannot see.
    shareText('Emily & Jeff · Next meet-up', text, '');
  }
  function actions(p, compact = false, includeShare = true) {
    const hasPin=Number.isFinite(p.lat)&&Number.isFinite(p.lng);
    const map = hasPin ? `<button class="button secondary${compact?' compact':''}" data-support-action="map" data-point-id="${safe(p.id)}">Show pin</button>` : '';
    const label = !hasPin ? 'Open agreed map pin' : mode() === 'walking' ? 'Walking directions' : 'Driving directions';
    return `<div class="support-actions"><a class="button primary${compact?' compact':''}" href="${safe(mapsUrl(p))}" target="_blank" rel="noopener">${label} ↗</a>${map}${includeShare?`<button class="button secondary${compact?' compact':''}" data-support-action="share" data-point-id="${safe(p.id)}">Share meet-up</button>`:''}</div>`;
  }
  function progressForm() {
    const value = local.progressKm === null ? '' : local.progressKm;
    return `<details class="support-progress supporter-only"><summary>${local.progressKm === null ? 'Add current watch distance' : `Watch distance: ${safe(local.progressKm)} km · manual`}</summary><p class="small muted">Optional. This suggests a meeting point around 10 km ahead.</p><form id="support-distance-form"><label class="field-label" for="support-distance-input">Current route distance (km)</label><div class="support-input-row"><input id="support-distance-input" name="distance" type="number" inputmode="decimal" min="0" max="250" step="0.1" value="${safe(value)}" placeholder="e.g. 12.5"><button id="support-distance-save" class="button secondary" type="submit">Save</button></div><p class="small muted">Leave blank to clear. Saved on this phone.</p></form></details>`;
  }
  function meetingProgress(snapshot=window.liveGuide?.getSnapshot?.() || {}) {
    const runner=snapshot.runner;
    if(!Object.prototype.hasOwnProperty.call(snapshot,'runners')){
      return Number.isFinite(runner?.routeKm)?runner.routeKm:Number.isFinite(runner?.projectedRouteKm)?runner.projectedRouteKm:trackerProgress?.routeKm??local.progressKm;
    }
    // Use the same selected tracker as the map and ETA. A delayed/missing
    // companion report does not block the freshest usable source.
    if(!snapshot.runners||typeof snapshot.runners!=='object')return null;
    if(window.arrivalEta?.selectRunner){
      const selection=window.arrivalEta.selectRunner({runners:snapshot.runners,now:Date.now()});
      return selection?.positionUsable?selection.runner.routeKm:null;
    }
    if(!runner||!Number.isFinite(runner.lat)||!Number.isFinite(runner.lng)||runner.fresh!==true||!Number.isFinite(runner.routeKm)||runner.finished||runner.retired)return null;
    if(!Number.isFinite(runner.offRouteM)||runner.offRouteM>=500)return null;
    const value=runner.recordedAt||runner.updatedAt;
    const at=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value||'');
    return Number.isFinite(at)&&at<=Date.now()+30000&&Date.now()-at<300000?runner.routeKm:null;
  }
  function runnerMeeting() {
    const km=meetingProgress();
    // Use the same route planner as the map, without writing an automatic
    // next point into the crew's explicitly selected meeting state.
    const plan=window.upcomingPoints?.plan({points:allPoints(),selected:selected(),statuses:planStatuses(),progressKm:km,planningEndKm:data?.planningEndKm,limit:1});
    return plan ? plan.points[0] || null : selected();
  }
  function forecastCard(p,snapshot=window.liveGuide?.getSnapshot?.()||{}) {
    const runner=Object.prototype.hasOwnProperty.call(snapshot,'runners')?snapshot.runners?.emily||null:snapshot.runner?.summaryRunnerId==='jeff'||snapshot.runner?.bib==='133'||snapshot.bib==='133'?null:snapshot.runner;
    const raceSnapshot={...snapshot,runner,runners:{emily:runner}};
    const forecast=!isDone(p.id)?window.meetingForecast?.estimate?.({snapshot:raceSnapshot,point:p,now:Date.now()}):null;
    if(!forecast)return '';
    if(forecast.status!=='ready')return '<p class="support-forecast">'+(forecast.status==='arrived'?'Near this stop':forecast.status==='passed'?'Passed on latest tracker':'ETA · waiting for usable pace')+'</p>';
    const range=typeof forecast.rangeText==='string'?forecast.rangeText.trim().replace(/^(?:around|about)\s+/i,''):'';
    const early=forecast.earliestFormattedTime,late=forecast.latestFormattedTime;
    const text=range||(early?(late&&late!==early?early+'–'+late:early):forecast.formattedTime||'time pending');
    return '<p class="support-forecast" title="'+safe(forecast.note||'')+'"><strong>ETA '+safe(text)+'</strong></p>';
  }
  function renderRunnerMeeting(holder) {
    const p=runnerMeeting();
    if(!p){holder.innerHTML='<h2>Your next hello</h2><p>No further meeting point is set. Check in with your support crew.</p>';return;}
    const landmark=p.landmark;
    holder.innerHTML=`<p class="card-kicker">${p.agreed?'CREW’S AGREED MEET-UP':'NEXT MEET-UP'}</p><div class="support-current-heading"><span class="support-point-badge">${safe(p.pointNumber || '♡')}</span><div><h2>${safe(title(p))}</h2><p class="support-distance">${distanceMarkup(p)}</p></div></div><p class="support-location">${landmark?`<strong>${safe(landmark.mapLabel||landmark.name)}</strong>${landmark.nearbyLabel?`<br><span>${safe(landmark.nearbyLabel)}</span>`:''}`:safe(p.detail||p.name)}</p>${untilMeeting(p)}${forecastCard(p)}${actions(p,false,false)}`;
  }
  function renderNow() {
    const holder = q('#support-now'); if (!holder) return;
    const optionsWereOpen = holder.querySelector('.support-options')?.open;
    const progressWasOpen = holder.querySelector('.support-progress')?.open;
    if (!data) { holder.innerHTML = loadingError ? '<h2>Your next hello</h2><p>Meeting points could not load. Refresh with a connection, or use the original map.</p>' : '<h2>Your next hello</h2><p>Loading meeting points…</p>'; return; }
    if(mode()==='walking'){renderRunnerMeeting(holder);return;}
    const chosen = selected();
    const p = runnerMeeting();
    const suggestion = !p ? suggested() : null;
    const upcoming = !p ? closestUpcoming() : null;
    const nearby = nearbyAfterMet();
    const last = recentMet();
    let content = `<p class="card-kicker">${p?.agreed&&sharedRoomActive?'CREW’S AGREED MEET-UP':p?'NEXT MEET-UP':'YOUR NEXT HELLO'}</p>`;
    let options = '';
    if (p) {
      content += `<div class="support-current-heading"><span class="support-point-badge">${safe(p.pointNumber || '♡')}</span><div><h2>${safe(title(p))}</h2><p class="support-distance">${distanceMarkup(p)}</p></div></div><p class="support-location">${p.landmark?`<strong>${safe(p.landmark.mapLabel)}</strong><br><span>${safe(p.landmark.nearbyLabel)}</span>`:safe(p.detail || p.name)}</p>${untilMeeting(p)}${forecastCard(p)}${p.beyondPlannedFinish?'<p class="support-caution small">This is beyond the 123 km plan.</p>':''}${actions(p,false,false)}`;
      options += `<div class="support-actions support-status-actions"><button class="button secondary" data-support-action="share" data-point-id="${safe(p.id)}">Share meet-up</button>${canStamp()?`<button class="button primary supporter-only" data-support-action="met" data-point-id="${safe(p.id)}">✓ Met here → Next stop</button><button class="button secondary supporter-only" data-support-action="skip" data-point-id="${safe(p.id)}">↷ Skip this stop</button>`:sharedRoomActive?'':`<button class="button primary supporter-only" data-support-action="met" data-point-id="${safe(p.id)}">✓ Met here</button><button class="button secondary supporter-only" data-support-action="skip" data-point-id="${safe(p.id)}">Skip this stop</button><button class="text-button supporter-only" data-support-action="browse">Choose another</button>`}</div>`;
    } else {
      content += sharedRoomActive?'<h2>Waiting for the crew’s next spot</h2><p class="small">The agreed meeting place will appear here.</p>':`<h2>${last ? 'One lovely hello down. ♡' : 'Where shall we meet next?'}</h2><button class="button primary" data-support-action="browse">Choose next meeting point →</button>`;
      if(canEditPlan()){
        if(upcoming) content += `<p class="small support-next-mapped">Next mapped option: <strong>${safe(title(upcoming))} · ${upcoming.routeKm.toFixed(1)} km</strong>. Agree the stop together.</p>`;
        else content += '<p class="small muted">Need an extra check-in? Add an agreed place in Stops.</p>';
        options += '<p class="small">Plan a catch-up about every 10 km, or sooner if they need you.</p>';
      }
      if (suggestion&&canEditPlan()) options += `<div class="support-suggestion supporter-only"><p class="small"><strong>A possible next stop</strong> · about ${suggestion.gap.toFixed(1)} km ahead of your last update</p><button class="button secondary" data-support-action="choose" data-point-id="${safe(suggestion.point.id)}">${safe(title(suggestion.point))} · ${suggestion.point.routeKm.toFixed(1)} km →</button><p class="small muted">Choose together. Other points remain available.</p></div>`;
    }
    if (nearby.length&&canEditPlan()) options += `<div class="support-nearby supporter-only"><h3>Need the nearby stop too?</h3><p class="small">You have just marked ${safe(title(point(local.afterMetId)))}. Keep nearby options, or skip them if everyone is happy.</p>${nearby.map(n=>`<button class="button secondary compact" data-support-action="skip" data-point-id="${safe(n.id)}">Skip ${safe(title(n))} · ${n.routeKm.toFixed(1)} km</button>`).join('')}<button class="text-button" data-support-action="keep-nearby">Keep them available</button></div>`;
    const latest = local.history[local.history.length-1];
    options += sharedRoomActive?'<p class="small muted support-local-note">Shared by the support crew. Updates appear on the race guide.</p>':`<p class="small muted support-local-note">Updates appear on the race guide.</p>${progressForm()}${latest?`<button class="text-button support-undo supporter-only" data-support-action="undo">↶ Undo: ${safe(latest.label)}</button>`:''}`;
    content += `<details class="support-options" ${nearby.length&&mode()==='driving'?'open':''}><summary>Meet-up options${nearby.length?' · nearby stop to review':''}</summary>${options}</details>`;
    holder.innerHTML = content;
    if(optionsWereOpen && holder.querySelector('.support-options'))holder.querySelector('.support-options').open=true;
    if(progressWasOpen && holder.querySelector('.support-progress'))holder.querySelector('.support-progress').open=true;
  }
  function optionCard(p, group, context) {
    const stateName = status(p.id), active = p.id === selected()?.id;
    const ordinaryOptions=group.options.filter(option=>!option.optionalMeetup),pair=ordinaryOptions.length>1;
    const optionName = p.optionalMeetup ? 'EV option' : pair ? (ordinaryOptions[0]?.id === p.id ? 'Earlier option' : 'Later option') : '';
    const stamp=stateName==='met'?'✓ Met':stateName==='skipped'?'↷ Skipped':stateName==='passed'?'✓ Passed':active?'Next':'';
    const snapshot=context.snapshot,eta=forecastCard(p,snapshot);
    const stampActions=canStamp()&&!isDone(p.id)&&context.nextId===p.id?`<button class="button primary compact" data-support-action="met" data-point-id="${safe(p.id)}"${snapshot.checkpointActionBusy?' disabled':''}>✓ Met here → Next stop</button><button class="text-button" data-support-action="skip" data-point-id="${safe(p.id)}"${snapshot.checkpointActionBusy?' disabled':''}>↷ Skip this stop</button>`:'';
    const ordinaryActions=!canChoose(p)?'':isDone(p.id)?sharedCheckpointActive?'':`<button class="text-button supporter-only" data-support-action="reopen" data-point-id="${safe(p.id)}">↶ Make available</button>`:`<button class="button ${active?'secondary':'primary'} compact" data-support-action="choose" data-point-id="${safe(p.id)}">${active?'Open next meet-up':'Meet here next'}</button>${sharedCheckpointActive?'':`<button class="text-button supporter-only" data-support-action="skip" data-point-id="${safe(p.id)}">Skip</button>`}`;
    return `<article class="support-option ${active?'is-selected':''} ${isDone(p.id)?'is-done':''}"><div class="support-option-heading"><span class="support-point-badge">${safe(p.pointNumber || '♡')}</span><div><h4>${safe(title(p))}${optionName?` <span class="support-option-label">${optionName}</span>`:''}</h4><p class="small muted support-distance">${distanceMarkup(p)}</p></div><span class="support-status ${stamp?'support-stamp support-stamp-'+stateName:''}">${stamp}</span></div><p class="support-location">${p.landmark?`<strong>${safe(p.landmark.mapLabel)}</strong><br><span>${safe(p.landmark.nearbyLabel)}</span>`:safe(p.detail || p.name)}</p>${eta}<div class="support-actions">${stampActions||ordinaryActions}${p.kind !== 'custom-meetup'?`<button class="text-button" data-support-action="map" data-point-id="${safe(p.id)}">See pin</button>`:`<a class="text-button" href="${safe(mapsUrl(p))}" target="_blank" rel="noopener">Open map ↗</a>`}</div></article>`;
  }
  function groupCard(g,context) {
    return `<section class="support-group" data-support-group="${safe(g.id)}">${g.options.length>1?`<h3>${safe(g.label)}${g.town?' · '+safe(g.town):''} · ${g.options.length} nearby options</h3>${canStamp()?'<p class="small muted">Meet at one option. Nearby alternatives are stamped Skipped when you move on.</p>':canEditPlan()?'<p class="small muted">Choose a convenient option. Marking one does not skip the others.</p>':''}`:''}${g.options.map(p=>optionCard(p,g,context)).join('')}</section>`;
  }
  function customForm() {
    if(!canEditPlan())return '';
    return `<details id="support-custom-details" class="support-custom supporter-only"><summary>＋ Add an agreed meeting place</summary><p class="small">For an extra check-in, a pin from your copied map, or a change of plan. Updates appear on the race guide.</p><form id="support-custom-form"><label class="field-label" for="support-custom-name">Place name</label><input id="support-custom-name" name="name" maxlength="100" placeholder="e.g. Village hall entrance" required><label class="field-label" for="support-custom-url">Google Maps link</label><input id="support-custom-url" name="url" type="url" inputmode="url" placeholder="https://maps.app.goo.gl/…" required><label class="field-label" for="support-custom-km">Approximate route km <span class="muted">· optional</span></label><input id="support-custom-km" name="km" type="number" inputmode="decimal" min="0" max="250" step="0.1"><button class="button primary" type="submit">Save as next meet-up →</button><p class="small muted" id="support-custom-error" role="status"></p></form></details>`;
  }
  function renderList() {
    const holder = q('#support-list'); if (!holder || !data) return;
    if(mode()==='walking'){holder.innerHTML='';return;}
    if(document.activeElement?.closest('#support-custom-form'))return;
    const completedOpen=holder.querySelector('.support-completed')?.open,beyondOpen=holder.querySelector('.support-beyond')?.open;
    const context={snapshot:window.liveGuide?.getSnapshot?.()||{},nextId:runnerMeeting()?.id};
    const filter = q('#support-filter')?.value || 'available';
    const customGroups = allPoints().filter(p=>!points.some(original=>original.id===p.id)).map(p => ({id:p.id,label:title(p),options:[p],routeKm:p.routeKm ?? -1,beyondPlannedFinish:p.routeKm > data.planningEndKm}));
    const groups = [...data.groups.map(g=>({...g,options:g.options.map(p=>point(p.id)||p).filter(inMeetingList)})), ...customGroups].filter(g=>g.options.length).sort((a,b)=>a.routeKm-b.routeKm);
    const complete = g => g.options.every(p => isDone(p.id));
    const ordinary = groups.filter(g => !g.beyondPlannedFinish && !complete(g));
    const completed = groups.filter(g => !g.beyondPlannedFinish && complete(g));
    const beyond = groups.filter(g => g.beyondPlannedFinish && (filter !== 'available' || !complete(g)));
    const earlyPrompts = (data.earlyCheckIns || []).filter(s=>s.status==='unconfirmed');
    const early = !canEditPlan()||!earlyPrompts.length?'':`<details class="support-early"><summary>Optional extra check-ins</summary><p class="small">Agree a location before adding one of these extra stops.</p><div class="support-early-grid">${earlyPrompts.map(s=>`<div class="support-early-card"><strong>${safe(s.label)}</strong><span class="support-unconfirmed">Location not confirmed</span><button class="button secondary compact supporter-only" data-support-action="add-early" data-route-km="${s.routeKm}">Add agreed spot →</button></div>`).join('')}</div></details>`;
    holder.innerHTML = `${filter!=='beyond'?early+customForm()+ordinary.map(g=>groupCard(g,context)).join(''):''}${filter!=='beyond'&&completed.length?`<details class="support-completed" ${filter==='all'||completedOpen?'open':''}><summary>Completed stops · ${completed.reduce((n,g)=>g.options.length+n,0)} points</summary>${completed.map(g=>groupCard(g,context)).join('')}</details>`:''}<details class="support-beyond" ${filter==='beyond'||beyondOpen?'open':''}><summary>Beyond 123 km · ${beyond.length} groups</summary><p class="small muted">Original onward points after approximately ${data.planningEndKm.toFixed(0)} route km. Use only if you agree to continue.</p>${beyond.map(g=>groupCard(g,context)).join('')}</details>`;
  }
  function render() {
    renderNow(); renderList(); updateMarkerIcons(); updateLayers();
    if (mapSelectionId) renderMapDetail();
    if (q('#support-source-note') && data) q('#support-source-note').textContent = data.sourceNote;
  }
  function icon(p) {
    return L.divIcon({className:`support-map-pin ${p.id===selected()?.id?'support-pin-selected':''} ${isDone(p.id)?'support-pin-'+status(p.id):''}`,html:`<span>${safe(p.pointNumber || '♡')}</span>`,iconSize:[38,38],iconAnchor:[19,19]});
  }
  function updateMarkerIcons() {
    if (!supportMap || !data) return;
    points.forEach(p => markerById[p.id]?.setIcon(icon(p)));
  }
  function updateLayers() {
    if (!supportMap || !mainLayer) return;
    for(const p of points.filter(p=>p.optionalMeetup)){
      const marker=markerById[p.id],layer=p.beyondPlannedFinish?onwardLayer:mainLayer;
      const show=mode()==='driving'&&isEvAdded(p.id)||selected()?.id===p.id;
      if(marker&&show&&!layer.hasLayer(marker))layer.addLayer(marker);
      else if(marker&&!show&&layer.hasLayer(marker))layer.removeLayer(marker);
    }
    const enabled = q('#show-support')?.checked !== false;
    const onward = q('#show-legacy')?.checked === true;
    [[mainLayer,enabled],[onwardLayer,enabled&&onward]].forEach(([layer,show])=>{if(show){if(!supportMap.hasLayer(layer))layer.addTo(supportMap);}else if(supportMap.hasLayer(layer))supportMap.removeLayer(layer);});
  }
  function addMarkers() {
    if (!supportMap || !data || mainLayer || !window.L) return;
    mainLayer = L.layerGroup(); onwardLayer = L.layerGroup();
    points.forEach(p => {
      const marker = L.marker([p.lat,p.lng],{icon:icon(p),title:title(p)+': '+p.detail,zIndexOffset:200}).addTo(p.beyondPlannedFinish?onwardLayer:mainLayer);
      marker.on('click',()=>{mapSelectionId=p.id;renderMapDetail();});
      markerById[p.id]=marker;
    });
    updateLayers();
  }
  function onMapReady(instance) { supportMap=instance;addMarkers(); }
  function renderMapDetail() {
    if(mode()==='walking'){
      const holder=q('#map-detail');if(!holder||!data)return false;
      renderRunnerMeeting(holder);return true;
    }
    const p=point(mapSelectionId), holder=q('#map-detail');
    if(!p || !holder) return false;
    holder.innerHTML=`<div class="map-place-info"><span class="stage-tag">${safe(title(p))}</span><h3>${safe(p.detail || p.name)}</h3><p class="support-distance">${distanceMarkup(p)}</p><p class="small muted">${p.optionalMeetup?'Optional charging meet-up. Check bay signs and the walking approach.':'Original meeting pin from the shared map. Confirm the exact meeting and parking place together.'}</p>${p.beyondPlannedFinish?'<p class="small support-caution">Beyond the 123 km plan.</p>':''}</div>${actions(p,true)}${canChoose(p)&&!isDone(p.id)?`<button class="button primary compact" data-support-action="choose" data-point-id="${safe(p.id)}">${local.selectedId===p.id?'Open next meet-up':'Use as next meet-up'} →</button>`:isDone(p.id)?`<p class="small">${status(p.id)==='met'?'✓ Met':status(p.id)==='skipped'?'↷ Skipped':'✓ Passed'}${sharedCheckpointActive?' · shared with everyone':' on this phone'}.</p>`:''}${p.originalMapLinks?.[0]?`<a class="text-button" href="${safe(p.originalMapLinks[0])}" target="_blank" rel="noopener">Original parking/place link ↗</a>`:''}`;
    return true;
  }
  function showSelectedOnMap(id=selected()?.id) {
    const p=mode()==='walking'?runnerMeeting():point(id);if(!p)return;
    if(window.raceMap&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)){window.raceMap.focusPoint(p);return;}
    if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)){notify('Use the agreed Google Maps link for this location.');return;}
    mapSelectionId=p.id;switchTab('map');
    if(!supportMap){notify('The map is loading. Try again in a moment.');return;}
    if(q('#show-support'))q('#show-support').checked=true;
    if(p.beyondPlannedFinish&&q('#show-legacy')){q('#show-legacy').checked=true;q('#show-legacy').dispatchEvent(new Event('change',{bubbles:true}));}
    updateLayers();renderMapDetail();supportMap.setView([p.lat,p.lng],15);
    q('#route-map')?.scrollIntoView({block:'center',behavior:'smooth'});
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-support-action]');if(!button)return;
    const id=button.dataset.pointId, action=button.dataset.supportAction;
    if(['met','skip'].includes(action)&&!canEditPlan()&&!canStamp())return;
    if(action==='choose'&&!canChoose(point(id)))return;
    if(['reopen','undo','keep-nearby','add-early'].includes(action)&&!canEditPlan())return;
    if(action==='choose')choose(id);
    else if(action==='add-ev')updateEvList(id,true);
    else if(action==='remove-ev')updateEvList(id,false);
    else if(action==='met')mark(id,'met');
    else if(action==='skip')mark(id,'skipped');
    else if(action==='reopen')reopen(id);
    else if(action==='map')showSelectedOnMap(id);
    else if(action==='share'){const p=point(id);if(p)share(p);}
    else if(action==='undo')undo();
    else if(action==='browse'){if(window.raceMap?.showNextPoints)window.raceMap.showNextPoints();else switchTab('now');}
    else if(action==='keep-nearby'){local.afterMetId=null;save();render();}
    else if(action==='add-early'){
      switchTab('allstops');
      const details=q('#support-custom-details');if(details)details.open=true;
      if(q('#support-custom-km'))q('#support-custom-km').value=button.dataset.routeKm;
      q('#support-custom-name')?.focus();details?.scrollIntoView({block:'start',behavior:'smooth'});
    }
  });
  document.addEventListener('submit',event=>{
    if(['support-distance-form','support-custom-form'].includes(event.target.id)&&!canEditPlan()){event.preventDefault();return;}
    if(event.target.id==='support-distance-form'){
      event.preventDefault();const raw=q('#support-distance-input').value.trim(), value=raw===''?null:Number(raw);
      if(value!==null&&(!Number.isFinite(value)||value<0||value>250)){notify('Enter a route distance between 0 and 250 km.');return;}
      change('Watch distance update',()=>{local.progressKm=value;local.progressAt=value===null?null:Date.now();});
      notify(value===null?'Manual distance cleared.':'Distance saved on this phone.');
    } else if(event.target.id==='support-custom-form'){
      if(sharedRoomActive){event.preventDefault();notify('Ask the support crew to update the agreed meeting place.');return;}
      event.preventDefault();const name=q('#support-custom-name').value.trim(), url=validMapUrl(q('#support-custom-url').value.trim()), raw=q('#support-custom-km').value.trim(), km=raw===''?null:Number(raw);
      if(!name||!url||(km!==null&&(!Number.isFinite(km)||km<0||km>250))){q('#support-custom-error').textContent='Add a place name, a valid HTTPS Google Maps link, and an optional distance from 0 to 250 km.';return;}
      if(local.custom.length>=50){q('#support-custom-error').textContent='This phone already has 50 custom places. Use one of your saved places.';return;}
      const id='custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
      change('Add '+name,()=>{local.custom.push({id,name,mapUrl:url,routeKm:km,kind:'custom-meetup',beyondPlannedFinish:km!==null&&km>data.planningEndKm});local.selectedId=id;local.afterMetId=null;});
      switchTab('now');notify('Meeting place saved. Updates appear on the race guide.');
    }
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='support-filter')renderList();
    if(event.target.id==='show-support'||event.target.id==='show-legacy')updateLayers();
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-mode]'))queueMicrotask(()=>{renderNow();renderList();updateLayers();if(mapSelectionId)renderMapDetail();});});
  window.addEventListener('viewchange',event=>{if(event.detail?.tab==='meetup')renderNow();if(event.detail?.tab==='allstops')renderList();});
  window.addEventListener('liveupdate',()=>{if(!document.hidden&&!q('#panel-allstops')?.hidden)renderList();});
  window.supportGuide={
    onMapReady,render,showSelectedOnMap,renderMapDetail,isEvAdded,
    addEvMeetup(id){return updateEvList(id,true);},removeEvMeetup(id){return updateEvList(id,false);},
    getSelected(){const p=selected();return p?{...p}:null;},
    getClosestUpcoming(){const p=closestUpcoming();return p?{...p}:null;},
    getPoint(id){const p=point(id);return p?{...p}:null;},
    getMapPlanData(){
      const p=selected();
      return {
        points:allPoints().filter(option=>inMeetingList(option)&&(mode()==='driving'||!option.optionalMeetup||option.id===p?.id)).map(p=>({...p})),
        selected:p?{...p}:null,
        statuses:planStatuses(),
        progressKm:local.progressKm,
        planningEndKm:data?.planningEndKm
      };
    },
    select:choose,
    setSharedCheckpointState(value){
      const statuses={};
      if(value?.checkpointStatuses&&typeof value.checkpointStatuses==='object')for(const [id,item] of Object.entries(value.checkpointStatuses)){
        if(/^[a-z0-9_-]{1,80}$/i.test(id)&&item&&['met','skipped'].includes(item.status))statuses[id]={status:item.status,at:item.at};
      }
      const ids=Array.isArray(value?.completedPointIds)?value.completedPointIds.filter(id=>typeof id==='string'&&/^[a-z0-9_-]{1,80}$/i.test(id)):[];
      const explicit=Array.isArray(value?.addedEvPointIds),added=explicit?[...new Set(value.addedEvPointIds.filter(id=>typeof id==='string'&&/^[a-z0-9_-]{1,80}$/i.test(id)))]:[];
      if(sharedCheckpointActive&&JSON.stringify(statuses)===JSON.stringify(sharedCheckpointStatuses)&&JSON.stringify(ids)===JSON.stringify(sharedCompletedIds)&&explicit===sharedEvListExplicit&&JSON.stringify(added)===JSON.stringify(sharedAddedEvIds))return;
      sharedCheckpointActive=true;sharedCheckpointStatuses=statuses;sharedCompletedIds=ids;sharedAddedEvIds=added;sharedEvListExplicit=explicit;
      render();dispatchChange('server');
    },
    setSharedMeetup(meetup){
      const active=meetup!==undefined, next=normalizeMeetup(meetup);
      if(sharedRoomActive===active&&JSON.stringify(sharedMeetup)===JSON.stringify(next))return;
      sharedRoomActive=active;sharedMeetup=next;
      if(active)ownedMeetup=null;
      render();dispatchChange('shared');
    },
    setOwnedMeetup(meetup){
      const next=normalizeMeetup(meetup), nextId=next?.id||null;
      if(!sharedRoomActive&&JSON.stringify(ownedMeetup)===JSON.stringify(next)&&local.selectedId===nextId)return;
      sharedRoomActive=false;sharedMeetup=null;ownedMeetup=next;local.selectedId=nextId;
      // The server's current agreement wins over stale local completion flags.
      if(nextId)delete local.statuses[nextId];
      render();dispatchChange('owned-load');
    },
    setTrackerProgress(progress){
      trackerProgress=progress&&Number.isFinite(Number(progress.routeKm))&&progress.routeKm!==null?{routeKm:Number(progress.routeKm),updatedAt:progress.updatedAt||null,fresh:progress.fresh===true}:null;
      if(!document.activeElement?.closest('#support-distance-form'))renderNow();
    },
    clearMapSelection(){mapSelectionId=null;},
    reset(){local=empty();mapSelectionId=null;save();render();dispatchChange();}
  };
  if(typeof map!=='undefined'&&map)onMapReady(map);
  renderNow();
  fetch('data/support-points.json').then(response=>{if(!response.ok)throw new Error('Meeting points unavailable');return response.json();}).then(loaded=>{
    if(!Array.isArray(loaded.groups))throw new Error('Meeting points invalid');data=loaded;points=data.groups.flatMap(g=>g.options);
    if(migrateLocalEv){local.addedEvPointIds=points.filter(p=>p.optionalMeetup&&(local.selectedId===p.id||local.statuses[p.id]?.status==='met')).map(p=>p.id);migrateLocalEv=false;}
    local.addedEvPointIds=local.addedEvPointIds.filter(id=>points.some(p=>p.id===id&&p.optionalMeetup));
    if(ownedMeetup)ownedMeetup=normalizeMeetup(ownedMeetup);
    if(sharedMeetup)sharedMeetup=normalizeMeetup(sharedMeetup);
    if(local.selectedId&&(!point(local.selectedId)||isDone(local.selectedId)))local.selectedId=null;
    render();addMarkers();dispatchChange('load');
  }).catch(error=>{loadingError=true;console.warn('Support points could not load:',error);renderNow();if(q('#support-list'))q('#support-list').innerHTML='<p>Meeting points could not load. Refresh with a connection or open the original Google map.</p>';});
})();
