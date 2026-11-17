'use strict';
(() => {
  const PRIVATE_KEY='meriden-private-crew-v1';
  const PUBLIC_KEY='meriden-public-crew-v1';
  const LOCATION_KEY='meriden-public-location-v1';
  const LOCATION_PERSON_KEY='meriden-location-person-v1';
  const SUPPORTERS={huiyan:'Huiyan',graham:'Graham',jeff:'Jeff',ben:'Ben'};
  const MAPS_MAX_AGE=60*60*1000;
  const LOCATION_INTERVAL_MS=30000;
  const TRACKER_URL='https://track.trail.live/event/escapefrommeriden';
  const registeredRunners=(window.crewGuide?.getRunners?.()||[]).filter(person=>person&&['emily','jeff'].includes(person.id)&&/^\d{1,24}$/.test(person.bib));
  const activeRunnerNames=registeredRunners.map(person=>person.shortName||person.name).join(' & ')||'Runner';
  const runnerFeeds=Object.fromEntries(registeredRunners.map(person=>[person.id,{tracker:{status:'waiting'},participant:null,lastEventActive:null}]));
  const q=selector=>document.querySelector(selector);
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{40,200}$/.test(value);
  const validLocationToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{40,128}$/.test(value);
  const time=value=>typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value||'');
  const age=value=>{const t=time(value);return Number.isFinite(t)?Math.max(0,Date.now()-t):Infinity;};
  const ageText=value=>{const ms=age(value);return !Number.isFinite(ms)?'report time unavailable':ms<60000?'just now':ms<3600000?`${Math.floor(ms/60000)} min ago`:`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m ago`;};
  const coordinates=p=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
  const positionTime=p=>p?.recordedAt||p?.updatedAt;
  const fresh=p=>coordinates(p)&&age(positionTime(p))<300000&&time(positionTime(p))<Date.now()+30000;
  function validMapsUrl(value){try{const u=new URL(value);const host=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&(host==='maps.app.goo.gl'||(host==='goo.gl'&&u.pathname.startsWith('/maps'))||(/^(www\.|maps\.)?google\.(com|co\.uk)$/.test(host)&&(host.startsWith('maps.')||u.pathname.startsWith('/maps'))))?u.href:null;}catch{return null;}}
  const invitation=location.hash.match(/^#crew=([A-Za-z0-9_-]{40,200})$/);
  const supportInvitation=location.hash.match(/^#support=([A-Za-z0-9_-]{40,200})$/);
  const locationInvitation=location.hash.match(/^#locate=([A-Za-z0-9_-]{40,128})$/);
  // A normal visit always follows the public race feed. Saved legacy rooms
  // cannot intercept it or leave a viewer stuck behind an expired invitation.
  const publicMode=!invitation;
  let privateRoom={viewToken:null,publishToken:null,expiresAt:null};
  let locationGrant={token:null,expiresAt:null};
  let locationPersonId='huiyan';
  try{const saved=localStorage.getItem(LOCATION_PERSON_KEY);if(Object.hasOwn(SUPPORTERS,saved))locationPersonId=saved;}catch{}
  if(publicMode){try{const saved=JSON.parse(localStorage.getItem(LOCATION_KEY)||'{}');if(validLocationToken(saved.token))locationGrant={token:saved.token,expiresAt:saved.expiresAt||null};}catch{}}
  try{
    const stored=JSON.parse(localStorage.getItem(publicMode?PUBLIC_KEY:PRIVATE_KEY)||'{}');
    if(publicMode){if(validToken(stored.publishToken))privateRoom={viewToken:null,publishToken:stored.publishToken,expiresAt:stored.expiresAt||null};}
    else if(validToken(stored.viewToken))privateRoom={viewToken:stored.viewToken,publishToken:validToken(stored.publishToken)?stored.publishToken:null,expiresAt:stored.expiresAt||null};
  }catch{}
  let joinedByLink=false;
  if(invitation){
    if(invitation[1]!==privateRoom.viewToken)privateRoom={viewToken:invitation[1],publishToken:null,expiresAt:null};
    joinedByLink=true;history.replaceState(null,'',location.pathname+location.search+'#now');
    try{localStorage.setItem(PRIVATE_KEY,JSON.stringify(privateRoom));}catch{}
    if(!privateRoom.publishToken){try{const preferences=JSON.parse(localStorage.getItem(typeof STORE_KEY!=='undefined'?STORE_KEY:'meriden-crew-2026-v1')||'{}');if(!preferences.mode&&typeof state!=='undefined'){state.mode='runner';if(typeof applyPreferences==='function')applyPreferences();if(typeof persist==='function')persist();}}catch{}}
  }
  if(supportInvitation){
    privateRoom={viewToken:null,publishToken:supportInvitation[1],expiresAt:null};
    history.replaceState(null,'',location.pathname+location.search+'#live');
    try{localStorage.setItem(PUBLIC_KEY,JSON.stringify({publishToken:privateRoom.publishToken,expiresAt:null}));}catch{}
    if(typeof state!=='undefined'){state.mode='supporter';if(typeof applyPreferences==='function')applyPreferences();if(typeof persist==='function')persist();}
  }
  if(locationInvitation){
    locationGrant={token:locationInvitation[1],expiresAt:null};
    history.replaceState(null,'',location.pathname+location.search+'#live');
    try{localStorage.setItem(LOCATION_KEY,JSON.stringify(locationGrant));}catch{}
  }
  let publicStatus='waiting',publicControlReady=false,publicControlBusy=false,controlError='';
  let locationControlReady=false,locationControlBusy=false,locationControlError='',locationFormError='',oneShotBusy=false;
  let savedMapsLink=null,roomVerifiedAt=0,crewIssue=null,roomDisplayError=false,retryBusy=false;
  let routeCoords=[],routeCumulative=[],tracker={status:'need-number'},participant=null,projection=null;
  const projectedReports=new WeakMap();
  let trackerBusy=false,crewBusy=false,room=null,roomError='',gpsStatus='stopped',gpsDetail='',gpsTimer=null,sharingRequested=false,roomLoaded=false,lastMeetingSignature='',lastBibSignature='',sessionEpoch=0,crewWriteGeneration=0,controlQueue=Promise.resolve();
  let liveMap,runnerMarker;
  const supporterMarkers={},supporterAccuracy={};
  let desiredMeetup,desiredBib,planBusy=false,planError=false,checkpointActionBusy=false,checkpointActionError='';
  const supporterPlanBusy=new Set(),supporterPlanErrors={};
  const owner=()=>validToken(privateRoom.publishToken)&&(!publicMode||publicControlReady);
  const canShareLocation=()=>owner()||Boolean(publicMode&&locationControlReady&&validLocationToken(locationGrant.token));
  const canManageCheckpoints=()=>canShareLocation()&&roomLoaded&&roomError!=='expired'&&publicStatus!=='ended';
  const bib=()=>registeredRunners.length?registeredRunners.map(person=>person.bib).join(','):publicMode&&!roomLoaded?'':String(window.crewGuide?.getBib?.()||'').trim();
  const mapsCacheKey=()=>publicMode?'meriden-public-maps-link-v1':'meriden-private-maps-link-v1';
  const mapsCacheScope=()=>publicMode?'public':privateRoom.viewToken;
  function clearSavedMaps(){savedMapsLink=null;try{localStorage.removeItem(mapsCacheKey());}catch{}}
  function savedMapsValid(value){
    return value&&value.scope===mapsCacheScope()&&validMapsUrl(value.url)&&Number.isFinite(value.verifiedAt)&&value.verifiedAt<=Date.now()+30000&&Date.now()-value.verifiedAt<MAPS_MAX_AGE&&Number.isFinite(time(value.expiresAt))&&time(value.expiresAt)>Date.now();
  }
  function restoreSavedMaps(){
    try{savedMapsLink=JSON.parse(localStorage.getItem(mapsCacheKey())||'null');}catch{savedMapsLink=null;}
    if(!savedMapsValid(savedMapsLink))clearSavedMaps();
  }
  function rememberMaps(next){
    const url=validMapsUrl(next.googleMapsUrl);
    if(!url||!Number.isFinite(time(next.expiresAt))||time(next.expiresAt)<=Date.now()){clearSavedMaps();return;}
    savedMapsLink={scope:mapsCacheScope(),url,verifiedAt:roomVerifiedAt,expiresAt:next.expiresAt};
    try{localStorage.setItem(mapsCacheKey(),JSON.stringify(savedMapsLink));}catch{}
  }
  function mapsLink(){
    if(roomError==='expired'||publicMode&&publicStatus==='ended'){clearSavedMaps();return null;}
    if(!savedMapsValid(savedMapsLink)){clearSavedMaps();return null;}
    const current=roomLoaded&&!roomError&&validMapsUrl(room?.googleMapsUrl)===savedMapsLink.url;
    return {url:savedMapsLink.url,source:current?'current':'saved',checkedAt:new Date(savedMapsLink.verifiedAt).toISOString()};
  }
  function issueFor(error,phase){
    return {phase,name:String(error?.name||'Error').replace(/[^A-Za-z0-9_-]/g,'').slice(0,48)||'Error',code:['invalid_response','timeout','offline'].includes(error?.code)?error.code:'unavailable',status:Number.isInteger(error?.status)?error.status:null,at:new Date().toISOString()};
  }
  function connectionText(){
    if(crewIssue?.code==='offline')return 'This phone is offline. Reconnect, then tap Retry live updates.';
    if(crewIssue?.code==='timeout')return 'The update took too long to arrive. Tap Retry live updates.';
    if(crewIssue?.code==='invalid_response')return 'The server replied, but its update could not be read. Tap Retry live updates.';
    return 'The latest crew update could not be loaded. Tap Retry live updates.';
  }
  function recoveryControls(){
    const details=crewIssue?`<details class="live-fallback"><summary>Connection details</summary><p class="small">${safe(crewIssue.phase)} · ${safe(crewIssue.name)}${crewIssue.status?' · HTTP '+crewIssue.status:''}. Last attempt ${safe(new Date(crewIssue.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}.</p></details>`:'';
    return `<div class="live-actions"><button class="button secondary" data-live-action="retry"${retryBusy?' disabled':''}>${retryBusy?'Checking updates…':'Retry live updates'}</button></div>${details}`;
  }
  function displayFailure(error){
    roomDisplayError=true;crewIssue=issueFor(error,'Crew display');
    console.warn('Crew display could not refresh:',crewIssue.name);
    emitSnapshot();try{renderSharing();}catch{}
  }
  function applyCrewUpdate(next,isPublic=false){
    roomDisplayError=false;
    try{if(isPublic)acceptPublicFeed(next);else updateRoom(next);}catch(error){displayFailure(error);}
  }
  const CELEBRATION_IDS=new Set(['start','marathon','km-50','km-60','km-70','km-80','km-90','km-100','gold','km-110','km-120','km-123']);
  const SEEN_KEY='meriden-celebration-seen-v1';
  let seenReleases={},archivedReleases=[];
  try{const value=JSON.parse(localStorage.getItem(SEEN_KEY)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))seenReleases=value;}catch{}
  const dispatchedReleases=new Set();
  let liveUpdateQueued=false;
  // Only actual, successfully derived GPS route pace is retained. Keep this
  // per runner and bib; do not persist coordinates or let an event average
  // masquerade as live pace if the provider's path briefly disappears.
  const lastMeasuredRoutePace={};
  const VERIFIED_PACE_KEY='meriden-verified-route-pace-event-35950-v1';
  try{
    const saved=JSON.parse(localStorage.getItem(VERIFIED_PACE_KEY)||'{}');
    for(const person of registeredRunners){
      const item=saved?.[person.id],at=Date.parse(item?.pace?.recordedAt);
      if(item?.bib===person.bib&&item.pace?.paceSource==='recent-tracker-route'&&Number.isFinite(at)&&
        at<=Date.now()&&Date.now()-at<15*60000&&Number.isFinite(item.pace.routeKm)&&Number.isFinite(item.pace.speedKmh))
        lastMeasuredRoutePace[person.id]=item;
    }
  }catch{}
  function rememberMeasuredRoutePace(person,pace){
    lastMeasuredRoutePace[person.id]={bib:person.bib,pace};
    // Only speed, route progress and timestamp: never save a GPS coordinate.
    try{localStorage.setItem(VERIFIED_PACE_KEY,JSON.stringify(lastMeasuredRoutePace));}catch{}
  }
  function releases(){
    if(!roomLoaded)return [];
    return (Array.isArray(room?.releases)?room.releases:archivedReleases).filter(r=>r&&CELEBRATION_IDS.has(r.id)&&Number.isFinite(time(r.releasedAt)))
      .map(r=>({id:r.id,releasedAt:new Date(time(r.releasedAt)).toISOString()}))
      .sort((a,b)=>a.releasedAt.localeCompare(b.releasedAt)||a.id.localeCompare(b.id));
  }
  const releaseKey=release=>`${publicMode?'public:':''}${privateRoom.expiresAt||''}:${release.id}:${release.releasedAt}`;
  function pendingReleases(){return releases().filter(release=>!seenReleases[releaseKey(release)]);}
  function acknowledgeCelebration(id,releasedAt){
    const release=releases().find(r=>r.id===id&&r.releasedAt===releasedAt);if(!release)return false;
    seenReleases[releaseKey(release)]=Date.now();
    const recent=Object.entries(seenReleases).filter(([,at])=>Number.isFinite(at)).sort((a,b)=>b[1]-a[1]).slice(0,100);
    seenReleases=Object.fromEntries(recent);
    try{localStorage.setItem(SEEN_KEY,JSON.stringify(seenReleases));}catch{}
    return true;
  }
  function runnerSnapshot(person,feed){
    const p=coordinates(feed?.participant)?feed.participant:null;if(!p)return null;
    const projected=p?project(p):null;
    const currentFeed=feed.tracker.status==='live'&&feed.tracker.event?.active!==false;
    const recentCachedFeed=feed.tracker.status==='unavailable'&&feed.lastEventActive===true;
    const runnerFresh=Boolean((currentFeed||recentCachedFeed)&&fresh(p));
    const usable=runnerFresh&&!p.finished&&!p.retired&&projected&&projected.offRouteM<500;
    const runner={id:person.id,lat:p.lat,lng:p.lng,name:String(p.name||person.name),bib:String(person.bib),recordedAt:positionTime(p)||null,updatedAt:p.updatedAt||null,fresh:runnerFresh,reportCached:feed.tracker.status==='unavailable',routeKm:usable?projected.routeKm:null,projectedRouteKm:projected?.routeKm??null,offRouteM:projected?.offRouteM??null,finished:Boolean(p.finished),retired:Boolean(p.retired)};
    // This event's leaderboard distance is crow-flight distance. Estimate pace
    // only from this runner's timed GPS samples projected onto our planned line.
    // Never use the other runner, a phone's planning speed or the crow distance.
    const reports=(Array.isArray(p.recentReports)?p.recentReports:[]).filter(coordinates).map(report=>{
      const point=project(report);
      return {lat:report.lat,lng:report.lng,recordedAt:positionTime(report)||null,routeKm:point?.routeKm??null,offRouteM:point?.offRouteM??null};
    });
    const paceReports=(Array.isArray(p.paceReports)?p.paceReports:[]).filter(coordinates).map(report=>{
      const point=project(report);
      return {lat:report.lat,lng:report.lng,recordedAt:positionTime(report)||null,routeKm:point?.routeKm??null,offRouteM:point?.offRouteM??null};
    });
    const now=Date.now(),measured=window.arrivalEta?.derivePace?.({runner,reports,now});
    const prior=lastMeasuredRoutePace[person.id]?.bib===person.bib?lastMeasuredRoutePace[person.id].pace:null;
    const pace=measured||window.arrivalEta?.carryPace?.({runner,reports:[...paceReports,...reports],previous:prior,now});
    if(measured){
      const seen=lastMeasuredRoutePace[person.id]?.pace?.recordedAt;
      if(!seen||Date.parse(seen)<Date.parse(runner.recordedAt))
        rememberMeasuredRoutePace(person,{...measured,routeKm:runner.routeKm,recordedAt:runner.recordedAt});
    }
    return {...runner,speedKmh:pace?.speedKmh??null,paceMinPerKm:pace?.paceMinPerKm??null,paceSource:pace?.paceSource??null,
      paceMeasuredAt:pace?.paceMeasuredAt??(measured?runner.recordedAt:null),paceWindowMinutes:pace?.paceWindowMinutes??null,
      paceExcludesStops:pace?.paceExcludesStops===true,paceResetAfterGap:pace?.paceResetAfterGap===true,paceReports};
  }
  function individualRunners(){
    return Object.fromEntries(registeredRunners.map(person=>[person.id,runnerSnapshot(person,runnerFeeds[person.id])]));
  }
  function summaryRunner(runners){
    const selected=window.arrivalEta?.selectRunner?.({runners,now:Date.now()});
    if(!selected)return null;
    return {...selected.runner,routeKm:selected.positionUsable?selected.runner.routeKm:null,
      summaryRunnerId:selected.id,summaryRunnerName:selected.name,summarySelectionReason:selected.reason};
  }
  let achievementLedger={eventId:35950,records:[],persisted:false};
  const savedAchievementIds=new Set();
  function acceptAchievements(value){
    if(!value||value.eventId!==35950||!Array.isArray(value.records))return;
    const records=new Map(achievementLedger.records.map(record=>[record.id,record]));
    for(const record of value.records){
      if(record?.eventId!==35950||!['emily','jeff'].includes(record.runnerId)||!['marathon','silver','gold','km-50','km-60','km-70','km-80','km-90','km-100','km-110','km-120','km-123'].includes(record.milestoneId)||typeof record.id!=='string'||(record.milestoneId.startsWith('km-')&&record.runnerId!=='emily'))continue;
      const previous=records.get(record.id),saved=savedAchievementIds.has(record.id);
      if(value.persisted===true){
        // The shared ledger is first-write immutable. Confirmed server data
        // wins over a newer temporary inference that failed to save.
        if(!saved||!previous)records.set(record.id,record);
        savedAchievementIds.add(record.id);
      }else if(!saved&&(!previous||time(record.recordedAt)>=time(previous.recordedAt)))records.set(record.id,record);
    }
    achievementLedger={eventId:35950,records:[...records.values()],persisted:records.size?[...records.keys()].every(id=>savedAchievementIds.has(id)):value.persisted===true};
  }
  function supporterPlans(){
    return Object.fromEntries(Object.keys(SUPPORTERS).flatMap(id=>{
      const plan=room?.supporterPlans?.[id];
      return plan&&['walking','meeting'].includes(plan.mode)&&Number.isFinite(time(plan.updatedAt))?[[id,{mode:plan.mode,updatedAt:new Date(time(plan.updatedAt)).toISOString()}]]:[];
    }));
  }
  function getSnapshot(){
    const runners=registeredRunners.length?individualRunners():null;
    const legacyRunner=registeredRunners.length?null:runnerSnapshot({id:'runner',name:activeRunnerNames,bib:String(participant?.bib||bib())},{tracker,participant});
    const runner=runners?summaryRunner(runners):legacyRunner;
    const supporters=Object.fromEntries(Object.keys(SUPPORTERS).map(id=>[id,supporterSnapshot(id)])),maps=mapsLink();
    return {
      tracker:{status:tracker.status||'unavailable',checkedAt:tracker.checkedAt||null},
      runner,
      ...(runners?{runners,runnerTracking:Object.fromEntries(registeredRunners.map(person=>[person.id,{...person,status:runnerFeeds[person.id].tracker.status||'waiting',checkedAt:runnerFeeds[person.id].tracker.checkedAt||null}]))}:{}),
      supporters,
      supporterPlans:supporterPlans(),supporterPlanBusy:[...supporterPlanBusy],supporterPlanErrors:{...supporterPlanErrors},
      crew:supporters.huiyan,
      room:{joined:publicMode||validToken(privateRoom.viewToken),public:publicMode,status:publicMode?publicStatus:null,loaded:roomLoaded,owner:owner(),canShareLocation:canShareLocation(),canManageCheckpoints:canManageCheckpoints(),expiresAt:privateRoom.expiresAt||null,error:roomError||null},
      completedPointIds:roomError==='expired'?[]:room?.completedPointIds||[],
      checkpointStatuses:roomError==='expired'?{}:room?.checkpointStatuses||{},
      addedEvPointIds:roomError==='expired'||!room?[]:Array.isArray(room.addedEvPointIds)?[...room.addedEvPointIds]:undefined,
      lastCheckpointAction:roomError==='expired'?null:room?.lastCheckpointAction||null,
      checkpointActionBusy,checkpointActionError,
      sharing:{personId:locationPersonId,requested:sharingRequested,automatic:sharingRequested,intervalSeconds:30,gpsStatus,active:supporterSharingActive(locationPersonId),updating:oneShotBusy},
      meetup:roomError==='expired'?null:room?.meetup||null,
      bib:bib(),googleMapsUrl:maps?.url||null,googleMapsSource:maps?.source||null,googleMapsCheckedAt:maps?.checkedAt||null,
      releases:releases(),
      achievements:achievementLedger
    };
  }
  function emitSnapshot(){
    if(liveUpdateQueued)return;liveUpdateQueued=true;
    queueMicrotask(()=>{
      liveUpdateQueued=false;
      window.dispatchEvent(new CustomEvent('liveupdate',{detail:getSnapshot()}));
      for(const release of pendingReleases()){
        const key=releaseKey(release);if(dispatchedReleases.has(key))continue;
        dispatchedReleases.add(key);
        window.dispatchEvent(new CustomEvent('celebrationrelease',{detail:{...release}}));
      }
    });
  }
  async function releaseCelebration(id){
    if(!CELEBRATION_IDS.has(id)||!owner()||!roomLoaded||roomError==='expired')return {ok:false};
    const ok=await patchCrew({celebration:id});
    const release=releases().find(r=>r.id===id);
    return {ok:ok&&Boolean(release),...(release?{release}:{} )};
  }
  function storePrivate(){
    try{
      if(publicMode){if(validToken(privateRoom.publishToken))localStorage.setItem(PUBLIC_KEY,JSON.stringify({publishToken:privateRoom.publishToken,expiresAt:privateRoom.expiresAt}));else localStorage.removeItem(PUBLIC_KEY);}
      else if(validToken(privateRoom.viewToken))localStorage.setItem(PRIVATE_KEY,JSON.stringify(privateRoom));else localStorage.removeItem(PRIVATE_KEY);
    }catch{notify(publicMode?'This browser cannot remember supporter controls. Keep your supporter setup link.':'Keep this private crew link safe. This browser cannot remember it.');}
  }
  function storeLocationGrant(){
    try{if(publicMode&&validLocationToken(locationGrant.token))localStorage.setItem(LOCATION_KEY,JSON.stringify(locationGrant));else localStorage.removeItem(LOCATION_KEY);}catch{}
  }
  async function api(path,{method='GET',token,body,keepalive=false}={}){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(path,{method,cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body!==undefined?JSON.stringify(body):undefined,signal:controller.signal,keepalive});
      let result;try{result=await response.json();}catch{
        const error=new Error('Unreadable update');error.code='invalid_response';error.status=response.status;throw error;
      }
      if(!response.ok){const error=new Error('Request failed');error.status=response.status;error.code=typeof result?.code==='string'?result.code:null;throw error;}
      const invalid=()=>{const error=new Error('Unexpected update');error.code='invalid_response';error.status=response.status;throw error;};
      const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
      const validRoom=value=>object(value)&&Number.isFinite(time(value.expiresAt))&&Number.isFinite(time(value.updatedAt))&&typeof value.sharing==='boolean'&&(value.position===null||coordinates(value.position))&&(value.googleMapsUrl===null||Boolean(validMapsUrl(value.googleMapsUrl)));
      if(!object(result)||!(response.headers.get('content-type')||'').toLowerCase().includes('application/json'))invalid();
      if(path.startsWith('/api/crew')){
        if(path.includes('public=1')||body?.action==='activate-public'||body?.action==='activate-location'){
          if(result.public!==true||!['waiting','active','ended'].includes(result.status)||(result.status==='active'?!validRoom(result.room):result.room!==null))invalid();
          if(body?.action==='activate-location'&&(result.status!=='active'||result.capability!=='location'))invalid();
        }else if(method==='GET'||method==='PATCH'){if(!validRoom(result.room||result))invalid();}
        else if(method==='DELETE'&&result.revoked!==true)invalid();
      }else if(path.startsWith('/api/tracker')){
        if(!['waiting','live','not-found','unavailable','wrong-event','ambiguous','need-number'].includes(result.status)||(result.status==='live'&&!Array.isArray(result.participants)))invalid();
      }
      return result;
    }catch(error){
      if(error.name==='AbortError'||navigator.onLine===false&&!error.status){
        const failure=new Error('Connection interrupted');failure.name=error.name||'Error';failure.code=error.name==='AbortError'?'timeout':'offline';throw failure;
      }
      throw error;
    }finally{clearTimeout(timer);}
  }
  function haversine(a,b){const rad=Math.PI/180,dy=(b[1]-a[1])*rad,dx=(b[0]-a[0])*rad,s=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
  function project(p){
    if(!coordinates(p)||routeCoords.length<2)return null;
    const cached=projectedReports.get(p);if(cached?.route===routeCoords)return cached.value;
    let best=null;const scale=Math.cos(p.lat*Math.PI/180);
    for(let i=0;i<routeCoords.length-1;i++){
      const a=routeCoords[i],b=routeCoords[i+1],x=(a[0]-p.lng)*scale,y=a[1]-p.lat,dx=(b[0]-a[0])*scale,dy=b[1]-a[1],den=dx*dx+dy*dy;
      const fraction=den?Math.max(0,Math.min(1,-(x*dx+y*dy)/den)):0;
      const projected=[a[0]+fraction*(b[0]-a[0]),a[1]+fraction*(b[1]-a[1])];
      const offset=haversine([p.lng,p.lat],projected);
      if(!best||offset<best.offRouteM)best={routeKm:(routeCumulative[i]+fraction*(routeCumulative[i+1]-routeCumulative[i]))/1000,offRouteM:offset};
    }
    projectedReports.set(p,{route:routeCoords,value:best});return best;
  }
  function updateProgress(){
    if(registeredRunners.length){
      const summary=summaryRunner(individualRunners());participant=summary;projection=summary?project(summary):null;
      const usable=Boolean(summary?.fresh&&Number.isFinite(summary.routeKm));
      window.supportGuide?.setTrackerProgress(usable?{routeKm:summary.routeKm,updatedAt:summary.recordedAt,fresh:true}:null);
      return usable;
    }
    projection=participant?project(participant):null;
    const recent=participant&&age(participant.updatedAt)<300000&&time(participant.updatedAt)<Date.now()+30000;
    const usable=tracker.status==='live'&&tracker.event?.active!==false&&!participant?.finished&&!participant?.retired&&recent&&projection&&projection.offRouteM<500;
    window.supportGuide?.setTrackerProgress(usable?{routeKm:projection.routeKm,updatedAt:participant.updatedAt,fresh:true}:null);
    return Boolean(usable);
  }
  async function pollTracker(){
    if(document.hidden||trackerBusy)return;
    if(registeredRunners.length){
      trackerBusy=true;
      try{
        await Promise.all(registeredRunners.map(async person=>{
          const feed=runnerFeeds[person.id];
          try{
            const result=await api('/api/tracker?bib='+encodeURIComponent(person.bib));
            acceptAchievements(result?.achievements);
            feed.tracker=result&&typeof result==='object'?result:{status:'unavailable'};
            if(feed.tracker.status==='live'&&typeof feed.tracker.event?.active==='boolean')feed.lastEventActive=feed.tracker.event.active;
            const matches=(Array.isArray(feed.tracker.participants)?feed.tracker.participants:[]).filter(p=>String(p?.bib||'').replace(/^0+(?=\d)/,'')===person.bib);
            if(matches.length>1){feed.tracker={...feed.tracker,status:'ambiguous'};feed.participant=null;}
            else if(feed.tracker.status==='live'&&matches.length===1){
              const next=coordinates(matches[0])?matches[0]:null,previous=feed.participant;
              // A delayed provider response cannot move a known GPS fix back
              // in time. Preserve its timestamp and history, but honour status.
              const previousAt=time(positionTime(previous)),nextAt=time(positionTime(next));
              if(next&&coordinates(previous)&&nextAt<previousAt){
                feed.participant={...previous,finished:next.finished,retired:next.retired};
              }else if(next&&coordinates(previous)&&Number.isFinite(nextAt)&&nextAt===previousAt&&next.lat===previous.lat&&next.lng===previous.lng&&
                Array.isArray(previous.recentReports)&&previous.recentReports.length&&(!Array.isArray(next.recentReports)||!next.recentReports.length)){
                // A path download failure must not erase timed history for an
                // unchanged GPS fix. Its original report age still expires.
                feed.participant={...next,recentReports:previous.recentReports,paceReports:Array.isArray(next.paceReports)&&next.paceReports.length?next.paceReports:previous.paceReports};
              }else feed.participant=next;
            }
            else if(feed.tracker.status==='live'){feed.tracker={...feed.tracker,status:'not-found'};feed.participant=null;}
            else if(['waiting','not-found','wrong-event','ambiguous','need-number'].includes(feed.tracker.status))feed.participant=null;
            else feed.tracker={...feed.tracker,status:'unavailable'};
          }catch{feed.tracker={status:'unavailable',checkedAt:new Date().toISOString()};}
        }));
        const states=registeredRunners.map(person=>runnerFeeds[person.id].tracker.status);
        const status=states.includes('live')?'live':states.every(value=>value==='waiting')?'waiting':['wrong-event','ambiguous','not-found','unavailable'].find(value=>states.includes(value))||'waiting';
        tracker={status,checkedAt:new Date().toISOString()};
      }finally{trackerBusy=false;renderTracker();updateMapMarkers();}
      return;
    }
    const requestedBib=bib();
    if(!requestedBib){tracker={status:'need-number'};participant=null;renderTracker();updateMapMarkers();return;}
    trackerBusy=true;
    try{
      const next=await api('/api/tracker?bib='+encodeURIComponent(requestedBib));
      if(bib()!==requestedBib)return;
      tracker=next&&typeof next==='object'?next:{status:'unavailable'};
      const people=Array.isArray(tracker.participants)?tracker.participants:[];
      if(tracker.status==='live'&&people.length===1){participant=coordinates(people[0])?people[0]:null;}
      else if(tracker.status==='live'&&people.length>1){tracker={...tracker,status:'ambiguous'};participant=null;}
      else if(['waiting','not-found','wrong-event','ambiguous','need-number'].includes(tracker.status)){participant=null;}
      else if(tracker.status!=='live')tracker={...tracker,status:'unavailable'};
    }catch{tracker={status:'unavailable',checkedAt:new Date().toISOString()};}
    finally{trackerBusy=false;renderTracker();updateMapMarkers();if(bib()!==requestedBib)queueMicrotask(pollTracker);}
  }
  function renderTracker(){
    if(registeredRunners.length){renderIndividualTracker();return;}
    const usable=updateProgress(),number=bib();
    let heading='Number pending',statusText=publicMode&&!owner()?'Waiting for their race number':'Add their number →',detail=publicMode&&!owner()?'Tracking begins automatically once the supporters have saved their race number.':'Add the exact race number after registration. The guide will then check for their live report automatically.';
    if(number){
      const states={
        waiting:['Waiting for race reports','No live position yet','The event has not supplied a current live position yet. Keep the official tracker handy.'],
        'not-found':['Number not found','Check the saved number','No participant exactly matches this number. Check registration or the official tracker.'],
        'wrong-event':['Event not confirmed','Open the official tracker','The available tracker data does not identify the current event reliably. No historical position is shown as live.'],
        ambiguous:['Check their number','More than one match','More than one participant matches. Use their exact unique race number; the guide has not chosen a runner.'],
        unavailable:['Tracker unavailable','Manual guide still works','The tracker could not be checked just now. It will retry while this guide is visible.'],
        'need-number':['Number pending','Add their number →','Save their exact race number to start checking the tracker.']
      };
      [heading,statusText,detail]=states[tracker.status]||states.unavailable;
      if(tracker.status==='live'&&participant){
        const reported=ageText(participant.updatedAt);
        if(participant.finished||participant.retired){heading=participant.finished?'Marked finished':'Marked retired';statusText=`Last report ${reported}`;detail=`The official tracker marks this participant ${participant.finished?'finished':'retired'}. The last position was reported ${reported}. Check the official tracker for the final result.`;}
        else if(usable){heading=`~${projection.routeKm.toFixed(1)} route km`;statusText=`Reported ${reported}`;detail=`Estimated distance along the planned route: ${projection.routeKm.toFixed(1)} km. Latest official report ${reported}. Updates are checked about every 30 seconds while this page is visible.`;}
        else if(projection?.offRouteM>=500){heading='Away from planned route';statusText=`Reported ${reported}`;detail=`Latest official report ${reported}. The position is more than 500 m from the old planned route, so a route-distance estimate is not shown.`;}
        else{heading='Last reported position';statusText=`${reported} · not fresh`;detail=`The last official position was reported ${reported}. It is not recent enough for a current distance estimate.`;}
      }else if(tracker.status==='live'){heading='Waiting for a position';statusText='Participant found';detail='Their number matches, but no usable position has been reported yet.';}
      else if(tracker.status==='unavailable'&&participant){statusText=`Last report ${ageText(participant.updatedAt)}`;detail+=` The last known position is still available on the map, labelled with its report time.`;}
    }
    if(q('#live-running-distance'))q('#live-running-distance').textContent=heading;
    if(q('#live-tracker-status'))q('#live-tracker-status').textContent=statusText;
    if(tracker.status==='live'&&participant)detail=`Matched ${String(participant.name||'Unnamed participant')} · number ${String(participant.bib||number)}. `+detail;
    if(q('#live-tracker-detail'))q('#live-tracker-detail').textContent=detail;
    emitSnapshot();
  }
  function renderIndividualTracker(){
    const usable=updateProgress(),runners=individualRunners();
    const descriptions=registeredRunners.map(person=>{
      const feed=runnerFeeds[person.id],p=runners[person.id],label=person.shortName+' #'+person.bib;
      if(p)return label+': '+(p.retired?'marked retired':p.finished?'marked finished':p.offRouteM>=500?'away from planned route':p.fresh&&!p.reportCached?'updated '+ageText(positionTime(p)):'last report '+ageText(positionTime(p)))+(p.reportCached?' · refreshing tracker':'');
      return label+': '+({waiting:'waiting for first report','not-found':'number not found in the current roster','wrong-event':'event needs checking',ambiguous:'tracker entry needs checking',unavailable:'tracker temporarily unavailable'}[feed.tracker.status]||'waiting for a position');
    });
    const positions=Object.values(runners).filter(Boolean),live=positions.filter(p=>p.fresh);
    const heading=usable?'~'+participant.routeKm.toFixed(1)+' route km':live.length?'Waiting for route position':positions.length?'Last reported positions':'Waiting for first reports';
    if(q('#live-running-distance'))q('#live-running-distance').textContent=heading;
    if(q('#live-tracker-status'))q('#live-tracker-status').textContent=registeredRunners.map(person=>(person.shortName||person.name)+' #'+person.bib).join(' · ');
    if(q('#live-tracker-detail'))q('#live-tracker-detail').textContent=descriptions.join('. ')+'. Reports refresh about every 30 seconds while this page is visible. Distance and arrival estimates follow the latest usable route progress.';
    emitSnapshot();
  }
  function supporterState(personId,source=room){
    const record=source?.supporters?.[personId];
    if(record&&typeof record==='object')return {position:coordinates(record.position)?record.position:null,sharing:record.sharing===true};
    // The old shared pin belonged to Huiyan's phone. It never supplies Graham.
    if(personId==='huiyan'&&!Object.hasOwn(source||{},'supporters'))return {position:coordinates(source?.position)?source.position:null,sharing:source?.sharing===true};
    return {position:null,sharing:false};
  }
  function supporterPosition(personId){return supporterState(personId).position;}
  function supporterSharingActive(personId){return Boolean(supporterState(personId).sharing&&!roomError);}
  function supporterSnapshot(personId){
    const p=supporterPosition(personId),active=supporterSharingActive(personId);
    return p?{lat:p.lat,lng:p.lng,accuracy:Number.isFinite(p.accuracy)?p.accuracy:null,recordedAt:positionTime(p)||null,updatedAt:p.updatedAt||null,fresh:active&&fresh(p),sharing:active}:null;
  }
  function roomPosition(){return supporterPosition('huiyan');}
  function renderCrewGlance(){
    const people=Object.keys(SUPPORTERS).map(id=>({id,position:supporterPosition(id)}));
    let heading=publicMode?'Waiting for supporters':privateRoom.viewToken?'Waiting for crew':'Not sharing yet',statusText=canShareLocation()?'Tap for location controls':'Updates appear automatically';
    if(roomError){heading=roomError==='expired'?(publicMode?'Race sharing ended':'Private link expired'):'Crew update unavailable';statusText='Open Live for details →';}
    else if(people.some(person=>person.position)){
      heading='Supporter locations';
      statusText=people.map(person=>`${SUPPORTERS[person.id]}: ${person.position?ageText(positionTime(person.position)):'not sharing yet'}`).join(' · ');
    }else if(room){heading='No supporter position yet';statusText=canShareLocation()?'Choose whose location this phone shares':'Waiting for a phone location update';}
    if(q('#live-supporter-label'))q('#live-supporter-label').textContent=heading;
    if(q('#live-supporter-status'))q('#live-supporter-status').textContent=planError?'Meeting update not shared · retrying':statusText;
    emitSnapshot();
  }
  function sharingStateText(){
    const name=SUPPORTERS[locationPersonId];
    if(gpsStatus==='denied')return 'Location permission is blocked. Open this guide in Safari or Chrome and allow Location for this website, then try again below.';
    if(gpsStatus==='unsupported')return 'Open this guide in Safari or Chrome to share this phone’s location, then try again below.';
    if(gpsStatus==='publishing-error')return 'Your new position has not reached the shared map. Check your connection and try again below.';
    if(gpsStatus==='unavailable')return 'The phone could not get a current GPS position. Move where you have a clearer signal and try again below.';
    if(gpsStatus==='timeout')return 'Getting your position took too long. Keep this page open and try again below.';
    if(gpsStatus==='invalid-fix')return 'The phone returned an old or invalid position. It has not been shared. Try again below.';
    if(gpsStatus==='waiting')return `Finding ${name}’s current phone position…`;
    if(gpsStatus==='publishing')return `Sending ${name}’s new position to the shared map…`;
    if(gpsStatus==='updated'){const p=supporterPosition(locationPersonId);return p?`Position shared ${ageText(positionTime(p))}${Number.isFinite(p.accuracy)?` · accuracy about ${Math.round(p.accuracy)} m`:''}. This was a one-time update for ${name}.`:`A one-time position was shared for ${name}. Tap to update again.`;}
    if(gpsStatus==='sharing')return `Sharing ${name}’s fresh phone position every 30 seconds while this guide stays open.`;
    if(gpsStatus==='paused')return gpsDetail||(sharingRequested?'Sharing is paused while this page is in the background. It resumes automatically when you return to this tab.':'The unfinished location update was paused. Choose a sharing button below to try again.');
    if(gpsStatus==='stopping-error')return `This phone has stopped updating ${name}, but removal of the last position was not confirmed. Try Stop ${name} sharing again when connected.`;
    return `Phone connected for ${name}. Location is not sharing yet. Tap Share ${name} · every 30s below, then allow location access.`;
  }
  function locationReportText(personId=locationPersonId){
    const p=supporterPosition(personId),name=SUPPORTERS[personId];if(!p)return `${name} has not shared a position yet.`;
    const at=positionTime(p),seconds=Math.floor(age(at)/1000);
    const ago=seconds<60?`${Math.max(0,seconds)} second${seconds===1?'':'s'} ago`:ageText(at);
    const clock=Number.isFinite(time(at))?new Date(time(at)).toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'time unavailable';
    const lastKnown=!supporterSharingActive(personId)||!fresh(p)?'Last known · ':'';
    return `${name}: ${lastKnown}${clock} · ${ago}${Number.isFinite(p.accuracy)?` · about ${Math.round(p.accuracy)} m accuracy`:''}.`;
  }
  function locationPersonSelector(){
    return `<p class="field-label">This phone shares as</p><div class="live-actions" role="group" aria-label="Choose whose location this phone shares" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr))">${Object.entries(SUPPORTERS).map(([id,name])=>`<button type="button" class="button ${id===locationPersonId?'primary':'secondary'}" data-live-action="select-person" data-person-id="${id}" aria-pressed="${id===locationPersonId}" style="min-height:44px;min-width:0;padding:12px 6px"${locationControlBusy?' disabled':''}>${name}</button>`).join('')}</div><p class="small muted">Choose the person carrying this phone. Their location stays separate from the other supporters.</p>`;
  }
  function supporterSummaries(){
    const plans=supporterPlans();
    return `<div class="live-supporter-summaries">${Object.keys(SUPPORTERS).map(id=>`<p class="small live-location-report" data-supporter-summary="${id}"><strong>${safe(SUPPORTERS[id])}${plans[id]?` · ${plans[id].mode==='walking'?'Walking with Emily':'Meeting at next stop'}`:''}</strong><br>${safe(locationReportText(id))}</p>`).join('')}</div>`;
  }
  function supporterMapActions(){
    return `<div class="live-actions">${Object.entries(SUPPORTERS).filter(([id])=>supporterPosition(id)).map(([id,name])=>`<button class="button secondary" data-live-action="supporter-map" data-person-id="${id}">Show ${name} on map</button>`).join('')}</div>`;
  }
  function locationControls(compact=false,personId=locationPersonId){
    if(personId!==locationPersonId)return `<p class="small live-location-report">${safe(locationReportText(personId))}</p><p class="small">This phone is set to ${SUPPORTERS[locationPersonId]}. To share ${SUPPORTERS[personId]}’s location, use the phone they are carrying.</p><button type="button" class="button secondary" data-live-action="select-person" data-person-id="${personId}">Use this phone for ${SUPPORTERS[personId]}</button>`;
    const name=SUPPORTERS[personId],waiting=oneShotBusy,p=supporterPosition(personId),primaryAction=sharingRequested?'update-location':'start';
    const primary=waiting?(gpsStatus==='publishing'?'Updating shared map…':'Finding phone location…'):sharingRequested?`Update ${name} now`:`Share ${name} · every 30s`;
    const buttonId=compact?'':' id="live-update-location"';
    const help=compact?'Keep this guide open and screen awake. Sharing pauses in the background and resumes when you return.':'Updates need this guide open and your screen awake. Locking the phone or opening another app pauses them. Return to this tab to resume automatically; after a reload, tap Share again. Your last report keeps its real time.';
    let content=`<p class="live-sharing-status" role="status" aria-live="polite">${safe(sharingStateText())}</p>${compact?`<p class="small live-location-report">${safe(locationReportText(personId))}</p>`:''}<div class="live-actions"><button${buttonId} class="button primary" data-live-action="${primaryAction}" data-person-id="${personId}"${waiting?' disabled':''}>${primary}</button>${!sharingRequested?`<button class="button secondary" data-live-action="update-location" data-person-id="${personId}"${waiting?' disabled':''}>Update ${name} once</button>`:''}${sharingRequested||p||gpsStatus==='stopping-error'?`<button class="button secondary" data-live-action="stop" data-person-id="${personId}">Stop ${name} sharing</button>`:''}</div><p class="small muted">${help}</p>`;
    if(!compact&&p)content+=`<div class="live-actions"><button class="button secondary" data-live-action="supporter-map" data-person-id="${personId}">Show ${name} on map</button></div>`;
    return content;
  }
  function supporterPlanControls(personId=locationPersonId){
    if(!Object.hasOwn(SUPPORTERS,personId))return '';
    const plan=supporterPlans()[personId],label=plan?.mode==='walking'?'Walking with Emily':plan?.mode==='meeting'?'Meeting at next stop':'Plan not set',busy=supporterPlanBusy.has(personId);
    let html=`<section class="supporter-plan" aria-label="${SUPPORTERS[personId]}’s shared plan"><p class="field-label">${SUPPORTERS[personId]}’s plan</p><p class="supporter-plan-current"><strong>${label}</strong></p>`;
    if(canManageCheckpoints())html+=`<div class="live-actions supporter-plan-actions" role="group" aria-label="Change ${SUPPORTERS[personId]}’s plan">${[['walking','Walk with Emily'],['meeting','Meet at next stop']].map(([mode,label])=>`<button type="button" class="button ${plan?.mode===mode?'primary':'secondary'}" data-live-action="supporter-plan" data-person-id="${personId}" data-plan-mode="${mode}" aria-pressed="${plan?.mode===mode}"${busy?' disabled':''}>${label}</button>`).join('')}</div><p class="small muted">Shared with everyone. Each avatar follows that person’s own phone.</p>`;
    if(busy||supporterPlanErrors[personId])html+=`<p class="small live-error" role="status">${busy?'Saving the shared plan…':safe(supporterPlanErrors[personId])}</p>`;
    return html+'</section>';
  }
  function getLocationControls({compact=false,personId=locationPersonId}={}){
    if(!Object.hasOwn(SUPPORTERS,personId))personId=locationPersonId;
    if(publicStatus==='ended'||roomError==='expired')return '<p>Race sharing has ended. The last position cannot be updated from this session.</p>';
    const plan=supporterPlanControls(personId);
    if(canShareLocation())return plan+locationControls(compact,personId);
    return plan+`<p class="small live-location-report">${safe(locationReportText(personId))}</p><p class="small">On the phone ${SUPPORTERS[personId]} is carrying, connect below to share their location.</p><button class="button primary" data-live-action="location-controls" data-person-id="${personId}">${publicMode?`Connect ${SUPPORTERS[personId]}’s phone`:'Location details'}</button>`;
  }
  function locationSetupForm(){
    const name=SUPPORTERS[locationPersonId];
    return `<details id="live-location-setup" class="live-privacy"><summary>Connect this phone for ${name}</summary>${locationPersonSelector()}<p class="small">Paste your private setup code to connect this phone for <strong>${name}</strong>. Next, tap <strong>Share ${name} · every 30s</strong> to put their location on the map.</p><form id="live-location-form" method="post"><label class="field-label" for="live-location-code">Location setup code</label><input id="live-location-code" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your setup code"${locationControlBusy?' disabled':''}><button class="button secondary" type="submit"${locationControlBusy?' disabled':''}>${locationControlBusy?'Connecting…':`Connect this phone for ${name}`}</button><p class="small live-error" role="status">${safe(locationFormError)}</p></form><p class="small muted">The code connects the phone. The Share button starts GPS updates.</p></details>`;
  }
  function renderPublicSharing(holder){
    let content='<article class="paper-card live-private-card"><p class="card-kicker">OUR LIVE RACE MAP</p><h2>Support crew ♡</h2>';
    if(publicStatus==='ended'){
      holder.innerHTML=content+'<p>Race sharing has ended. The route guide is still available.</p></article>';return;
    }
    content+=supporterSummaries();
    if(canShareLocation())content+=locationPersonSelector()+supporterPlanControls()+locationControls();
    else{
      if(!Object.keys(SUPPORTERS).some(id=>supporterPosition(id)))content+='<p>Waiting for supporters to share their location.</p>';
      content+='<p class="small muted">Huiyan, Graham, Jeff and Ben each have their own position. Each supporter can connect the phone they are carrying to update their location for everyone.</p>'+supporterMapActions();
      if(publicControlBusy||locationControlBusy)content+='<p class="live-sharing-status" role="status">Opening this phone’s location controls…</p>';
      if(controlError)content+='<p class="live-alert small">'+safe(controlError)+'</p><button class="button secondary" data-live-action="activate-public">Retry supporter controls</button>';
      if(locationControlError)content+='<p class="live-alert small">'+safe(locationControlError)+'</p><button class="button secondary" data-live-action="activate-location">Retry location controls</button>';
      content+=locationSetupForm();
    }
    if(roomError)content+='<p class="live-alert small">'+safe(connectionText())+'</p>';
    if(roomDisplayError)content+='<p class="live-alert small">The update arrived, but this view could not refresh. Tap Retry live updates.</p>';
    if(planError)content+='<p class="live-alert small">The new meeting plan has not reached the shared map yet. Please confirm the change with the runners while we retry.</p>';
    content+='<div class="live-actions"><button class="button secondary" data-live-action="invite">Share race guide</button></div>';
    if(owner())content+='<details class="live-privacy"><summary>Supporter controls</summary><p class="small">Everyone can see the latest shared location, race number and agreed meet-up. Only your setup phones can change them. No location history is kept.</p><button class="text-button live-revoke" data-live-action="revoke">End race sharing</button></details>';
    content+=recoveryControls();
    if(privateRoom.expiresAt)content+=`<p class="small muted live-expiry">Sharing ends ${safe(new Date(privateRoom.expiresAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}.</p>`;
    holder.innerHTML=content+'</article>';
  }
  function renderSharing(force=false){
    emitSnapshot();
    const holder=q('#live-sharing-panel');if(!holder)return;
    if(!force&&document.activeElement?.closest('#live-location-form'))return;
    const setupExpanded=holder.querySelector('#live-location-setup')?.open;
    if(publicMode){renderPublicSharing(holder);if(setupExpanded&&q('#live-location-setup'))q('#live-location-setup').open=true;return;}
    if(!privateRoom.viewToken){holder.innerHTML='<article class="paper-card live-private-card"><p class="card-kicker">THE CHEERING CREW</p><h2>Keep the crew in sight ♡</h2><p>Create a private link for the family. Anyone with that link can see the latest crew position, agreed meet-up and race number.</p><button class="button primary" data-live-action="create">Create private crew link</button><p class="small muted">Location permission is requested only when you tap Share now & every 30s or Update once. New links last 48 hours.</p><p class="small live-error" role="status">'+safe(roomError?'Private sharing is temporarily unavailable. The manual guide still works.':'')+'</p></article>';return;}
    let content='<article class="paper-card live-private-card"><p class="card-kicker">PRIVATE FAMILY LINK</p><h2>Support crew location</h2>';
    if(roomError==='expired'){content+='<div class="live-alert"><strong>This private link has expired or been revoked.</strong><p class="small">Ask the crew for a new link, or create a new one on the sharing phone.</p><button class="button primary" data-live-action="leave">Leave this expired link</button></div>';holder.innerHTML=content+'</article>';return;}
    if(owner()){
      content+=supporterSummaries()+locationPersonSelector()+supporterPlanControls()+locationControls();
      content+='<div class="live-actions"><button class="button secondary" data-live-action="invite">Share private crew link</button></div><details class="live-privacy"><summary>Private link and controls</summary><p class="small">Anyone with the link can see the latest position, chosen meet-up and race number. Only this sharing phone can publish updates. No location history is kept.</p><button class="text-button live-revoke" data-live-action="revoke">Revoke this private link</button></details>';
    }else{
      content+=supporterSummaries()+supporterMapActions()+'<div class="live-actions"><button class="button secondary" data-live-action="invite">Copy / share family link</button></div><p class="small muted">This is a private view. Anyone with this link can see the shared updates. Keep it within your crew.</p><button class="text-button" data-live-action="leave">Leave private view on this phone</button>';
    }
    if(roomError)content+='<p class="live-alert small">'+safe(connectionText())+'</p>';
    if(roomDisplayError)content+='<p class="live-alert small">The update arrived, but this view could not refresh. Tap Retry live updates.</p>';
    if(planError)content+='<p class="live-alert small">The new meeting plan has not reached the private link yet. Share the change with your crew directly; this page will retry.</p>';
    content+=recoveryControls();
    if(privateRoom.expiresAt)content+=`<p class="small muted live-expiry">Expires ${safe(new Date(privateRoom.expiresAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}.</p>`;
    holder.innerHTML=content+'</article>';
  }
  function expireRoom(){
    clearSavedMaps();
    if(publicMode){publicStatus='ended';publicControlReady=false;locationControlReady=false;}
    room=null;roomLoaded=false;roomError='expired';sharingRequested=false;oneShotBusy=false;sessionEpoch++;stopWatch();gpsStatus='stopped';desiredMeetup=undefined;desiredBib=undefined;planError=false;
    window.supportGuide?.setSharedCheckpointState?.({completedPointIds:[],checkpointStatuses:{},addedEvPointIds:[]});
    if(!owner())window.supportGuide?.setSharedMeetup(null);
    renderCrewGlance();renderSharing();updateMapMarkers();
  }
  function updateRoom(next){
    if(!next||typeof next!=='object')return;
    acceptAchievements(next.achievements);
    if(Number.isFinite(time(next.expiresAt))&&time(next.expiresAt)<=Date.now()){expireRoom();return;}
    if(room&&Number.isFinite(time(room.updatedAt))&&Number.isFinite(time(next.updatedAt))&&time(next.updatedAt)<time(room.updatedAt))return;
    room=next;roomLoaded=true;roomError='';crewIssue=null;roomVerifiedAt=Date.now();rememberMaps(next);if(publicMode)publicStatus='active';
    if(next.expiresAt){privateRoom.expiresAt=next.expiresAt;storePrivate();if(publicMode&&validLocationToken(locationGrant.token)){locationGrant.expiresAt=next.expiresAt;storeLocationGrant();}}
    // Public session state wins over old per-phone settings. Pending explicit
    // edits are kept until acknowledged; merely opening a controller writes none.
    window.supportGuide?.setSharedCheckpointState?.({completedPointIds:next.completedPointIds||[],checkpointStatuses:next.checkpointStatuses||{},...(Array.isArray(next.addedEvPointIds)?{addedEvPointIds:next.addedEvPointIds}:{})});
    if(!owner())window.supportGuide?.setSharedMeetup(next.meetup||null);
    else if(desiredMeetup===undefined)window.supportGuide?.setOwnedMeetup?.(next.meetup||null);
    if(!registeredRunners.length&&(!owner()||(publicMode&&desiredBib===undefined))&&next.bib!==undefined&&String(next.bib||'').trim()!==bib()){
      window.crewGuide?.setSharedBib?.(String(next.bib||''));participant=null;tracker={status:bib()?'waiting':'need-number'};renderTracker();updateMapMarkers();pollTracker();
    }
    lastMeetingSignature=JSON.stringify(next.meetup||null);lastBibSignature=String(next.bib||'');
    renderCrewGlance();renderSharing();updateMapMarkers();
  }
  function acceptPublicFeed(result){
    acceptAchievements(result?.achievements);
    publicStatus=['waiting','active','ended'].includes(result?.status)?result.status:'waiting';
    archivedReleases=publicStatus==='ended'&&Array.isArray(result?.releases)?result.releases:[];
    if(result?.room){updateRoom(result.room);return;}
    room=null;roomLoaded=true;roomError='';crewIssue=null;clearSavedMaps();
    if(publicStatus==='ended'){
      ++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';publicControlReady=false;locationControlReady=false;desiredMeetup=undefined;desiredBib=undefined;
    }
    if(!owner())window.supportGuide?.setSharedMeetup(null);
    if(!registeredRunners.length&&bib()){window.crewGuide?.setSharedBib?.('');participant=null;tracker={status:'need-number'};renderTracker();}
    renderCrewGlance();renderSharing();updateMapMarkers();
  }
  async function activatePublic(){
    if(!publicMode||!validToken(privateRoom.publishToken)||publicControlBusy)return;
    const token=privateRoom.publishToken,epoch=sessionEpoch;publicControlBusy=true;controlError='';
    try{
      const result=await api('/api/crew',{method:'POST',token,body:{action:'activate-public'}});
      if(token!==privateRoom.publishToken||epoch!==sessionEpoch)return;
      if(!result?.room)throw new Error('Supporter controls unavailable');
      publicControlReady=true;applyCrewUpdate(result,true);
    }catch(error){
      if(token!==privateRoom.publishToken||epoch!==sessionEpoch)return;
      publicControlReady=false;controlError='Supporter controls could not be opened. The public map still works.';
      renderSharing(true);renderCrewGlance();pollCrew();
    }finally{publicControlBusy=false;}
  }
  async function activateLocation(){
    if(!publicMode||!validLocationToken(locationGrant.token)||locationControlBusy)return;
    const token=locationGrant.token,epoch=sessionEpoch;locationControlBusy=true;locationControlError='';renderSharing(true);
    try{
      const result=await api('/api/crew',{method:'POST',token,body:{action:'activate-location'}});
      if(token!==locationGrant.token||epoch!==sessionEpoch)return;
      locationControlReady=true;applyCrewUpdate(result,true);
    }catch(error){
      if(token!==locationGrant.token||epoch!==sessionEpoch)return;
      locationControlReady=false;locationControlError='This phone’s location controls could not be opened. The public map still works. Try again, or reopen your location setup link.';
      renderSharing();pollCrew();
    }finally{locationControlBusy=false;renderSharing(true);}
  }
  async function pollCrew(){
    if(document.hidden||crewBusy||(!publicMode&&!validToken(privateRoom.viewToken)))return;
    const knownExpiry=publicMode?room?.expiresAt:privateRoom.expiresAt;
    if(Number.isFinite(time(knownExpiry))&&time(knownExpiry)<=Date.now()){if(roomError!=='expired')expireRoom();return;}
    const requestedToken=privateRoom.viewToken,requestedEpoch=sessionEpoch,requestedWriteGeneration=crewWriteGeneration;
    crewBusy=true;let next;
    try{
      next=await api(publicMode?'/api/crew?public=1':'/api/crew',publicMode?{}:{token:requestedToken});
      if(requestedToken!==privateRoom.viewToken||requestedEpoch!==sessionEpoch||requestedWriteGeneration!==crewWriteGeneration)return;
    }catch(error){
      if(requestedToken!==privateRoom.viewToken||requestedEpoch!==sessionEpoch||requestedWriteGeneration!==crewWriteGeneration)return;
      crewIssue=issueFor(error,'Crew request');
      roomError=!publicMode&&[401,403,404,410].includes(error.status)?'expired':'unavailable';
      if(roomError==='expired'){clearSavedMaps();room=null;sharingRequested=false;sessionEpoch++;stopWatch();if(!owner())window.supportGuide?.setSharedMeetup(null);updateMapMarkers();}
      renderCrewGlance();renderSharing();
    }finally{crewBusy=false;}
    if(next&&requestedToken===privateRoom.viewToken&&requestedEpoch===sessionEpoch&&requestedWriteGeneration===crewWriteGeneration)applyCrewUpdate(publicMode?next:next.room||next,publicMode);
  }
  async function patchCrew(patch,{quiet=false,keepalive=false,epoch=null,locationOnly=false}={}){
    if((locationOnly?!canShareLocation():!owner())||(epoch!==null&&epoch!==sessionEpoch))return false;
    if(locationOnly&&(Object.keys(patch).some(key=>!['personId','position','sharing'].includes(key))||!Object.hasOwn(SUPPORTERS,patch.personId)))return false;
    const useLocationGrant=locationOnly&&!owner(),requestedToken=useLocationGrant?locationGrant.token:privateRoom.publishToken;
    const current=()=>requestedToken===(useLocationGrant?locationGrant.token:privateRoom.publishToken)&&(epoch===null||epoch===sessionEpoch);
    try{
      const result=await api('/api/crew',{method:'PATCH',token:requestedToken,body:patch,keepalive});
      if(!current())return false;
      const next=result.room||result;
      if(locationOnly&&patch.position){
        const sent=patch.position,record=supporterState(patch.personId,next),confirmed=record.position;
        if(!record.sharing||!coordinates(confirmed)||confirmed.lat!==sent.lat||confirmed.lng!==sent.lng||confirmed.accuracy!==sent.accuracy||time(positionTime(confirmed))!==time(sent.recordedAt)){
          const error=new Error('Position was not confirmed');error.code='invalid_response';throw error;
        }
      }
      ++crewWriteGeneration;applyCrewUpdate(next);
      return true;
    }catch(error){
      if(!current())return false;
      if(error.status===409&&error.code==='sharing_stopped'){
        ++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='paused';gpsDetail=`${SUPPORTERS[patch.personId]}’s location sharing is stopped. Choose a sharing button below to start again.`;
        room={...(room||{}),...(patch.personId==='huiyan'?{sharing:false}:{}),supporters:{...(room?.supporters||{}),[patch.personId]:{...supporterState(patch.personId),sharing:false}}};roomError='';renderCrewGlance();renderSharing();updateMapMarkers();pollCrew();
        return false;
      }
      if(publicMode&&[401,403,404,410].includes(error.status)){
        if(useLocationGrant){locationControlReady=false;locationControlError='Location controls are unavailable. Reopen your location setup link on this phone.';}
        else{publicControlReady=false;controlError='Supporter controls are unavailable. The public map still works.';}
        sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';pollCrew();renderSharing();
      }else{
        roomError=[401,403,404,410].includes(error.status)?'expired':'unavailable';
        if(roomError==='expired'){clearSavedMaps();room=null;sharingRequested=false;oneShotBusy=false;stopWatch();updateMapMarkers();}
      }
      if(!quiet)notify('That update could not be saved to the shared map. Please try again.');renderCrewGlance();return false;
    }
  }
  const patchLocation=(patch,options={})=>patchCrew(patch,{...options,locationOnly:true});
  async function setSupporterPlan(personId,mode){
    if(!Object.hasOwn(SUPPORTERS,personId)||!['walking','meeting'].includes(mode))return {ok:false,reason:'invalid-plan'};
    if(!canManageCheckpoints())return {ok:false,reason:'setup-required'};
    if(supporterPlanBusy.has(personId))return {ok:false,reason:'busy'};
    if(supporterPlans()[personId]?.mode===mode)return {ok:true,unchanged:true};
    const useLocationGrant=!owner(),token=useLocationGrant?locationGrant.token:privateRoom.publishToken;
    const current=()=>token===(useLocationGrant?locationGrant.token:privateRoom.publishToken);
    supporterPlanBusy.add(personId);delete supporterPlanErrors[personId];renderSharing();
    try{
      const result=await api('/api/crew',{method:'PATCH',token,body:{supporterPlan:{personId,mode}}});
      if(!current())return {ok:false};
      const next=result?.room||result,confirmed=next?.supporterPlans?.[personId];
      if(confirmed?.mode!==mode||!Number.isFinite(time(confirmed.updatedAt)))throw new Error('The shared plan was not confirmed');
      ++crewWriteGeneration;applyCrewUpdate(next);
      notify(`${SUPPORTERS[personId]}: ${mode==='walking'?'walking with Emily':'meeting at the next stop'}. Shared with everyone.`);
      return {ok:true,personId,mode};
    }catch(error){
      if(!current())return {ok:false};
      supporterPlanErrors[personId]=[401,403,404,410].includes(error.status)?'Reconnect a supporter phone to change the plan. Everyone can still view it.':'That plan was not saved. Check your connection and try again.';
      notify(supporterPlanErrors[personId]);await pollCrew();
      return {ok:false,reason:error.code||'unavailable'};
    }finally{supporterPlanBusy.delete(personId);renderSharing();}
  }
  async function checkpointAction(action,pointId){
    if(!['complete','skip','undo','select','add-ev','remove-ev'].includes(action)||typeof pointId!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(pointId))return {ok:false};
    if(!canManageCheckpoints()){
      notify('Connect your supporter phone first to update meet-ups for everyone.');
      return {ok:false,reason:'setup-required'};
    }
    if(checkpointActionBusy||planBusy)return {ok:false,reason:'busy'};
    // An explicit outstanding meeting choice must reach the server before a
    // completion. Never let an old queued local choice overwrite the new stop.
    if(desiredMeetup!==undefined||desiredBib!==undefined){
      await syncPlan();
      if(planError||planBusy||desiredMeetup!==undefined||desiredBib!==undefined){notify('Let the meeting choice finish saving, then mark this stop.');return {ok:false,reason:'pending-plan'};}
    }
    checkpointActionBusy=true;checkpointActionError='';emitSnapshot();
    const useLocationGrant=!owner(),token=useLocationGrant?locationGrant.token:privateRoom.publishToken;
    const current=()=>token===(useLocationGrant?locationGrant.token:privateRoom.publishToken);
    try{
      const result=await api('/api/crew',{method:'PATCH',token,body:{checkpoint:{action,pointId}}});
      if(!current())return {ok:false};
      const next=result?.room||result;
      if(!next||!Array.isArray(next.completedPointIds)||!next.checkpointStatuses||typeof next.checkpointStatuses!=='object')throw new Error('Checkpoint update was not confirmed');
      if(action==='select'&&next.meetup?.id!==pointId)throw new Error('Meeting choice was not confirmed');
      if(['add-ev','remove-ev'].includes(action)&&(!Array.isArray(next.addedEvPointIds)||next.addedEvPointIds.includes(pointId)!==(action==='add-ev')))throw new Error('Charging choice was not confirmed');
      applyCrewUpdate(next);
      const p=window.supportGuide?.getPoint?.(pointId),name=p?.town?p.label+' · '+p.town:p?.label||'Meet-up';
      const actual=next.checkpointStatuses[pointId]?.status;
      notify(action==='add-ev'?name+' added to your meeting options. The agreed next stop is unchanged.':action==='remove-ev'?name+' removed from your meeting options.':action==='select'?name+' is the agreed next meet-up for everyone.':action==='undo'?'Last checkpoint stamp undone for everyone.':name+(actual==='skipped'?' stamped Skipped.':actual==='met'?' stamped Met.':' is already passed.')+' Next stop shared with everyone.');
      return {ok:true,pointId,action};
    }catch(error){
      if(!current())return {ok:false};
      checkpointActionError=error.status===409?'The meeting plan changed on another phone. The latest plan is loading; check it before trying again.':'That checkpoint was not saved. Check your connection and try again.';
      if(error.code==='ev_current_meetup')checkpointActionError='This is the agreed next meet-up. Choose another meeting point before removing this charging option.';
      if([401,403,404,410].includes(error.status))checkpointActionError='Reconnect your supporter phone to update meet-ups. Everyone can still view the map.';
      notify(checkpointActionError);await pollCrew();
      return {ok:false,reason:error.code||'unavailable',message:checkpointActionError};
    }finally{checkpointActionBusy=false;emitSnapshot();}
  }
  function meetupPayload(p){
    if(!p)return null;
    const hasPin=coordinates(p);
    return {id:String(p.id||'meetup'),label:String(p.label||p.name||'Agreed meeting place'),routeKm:Number.isFinite(p.routeKm)?p.routeKm:null,lat:hasPin?p.lat:null,lng:hasPin?p.lng:null,mapUrl:validMapsUrl(p.mapUrl||'')||(hasPin?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.lat+','+p.lng):null),note:String(p.detail||p.name||'').slice(0,500)};
  }
  async function syncPlan(){
    if(!owner()||!roomLoaded||document.hidden||planBusy||checkpointActionBusy||(desiredMeetup===undefined&&desiredBib===undefined))return;
    const requestedToken=privateRoom.publishToken,pendingMeetup=desiredMeetup,pendingBib=desiredBib,patch={};
    if(pendingMeetup!==undefined)patch.meetup=pendingMeetup;if(pendingBib!==undefined)patch.bib=pendingBib;
    planBusy=true;const success=await patchCrew(patch,{quiet:true});planBusy=false;
    if(requestedToken!==privateRoom.publishToken)return;
    if(success){if(JSON.stringify(desiredMeetup)===JSON.stringify(pendingMeetup))desiredMeetup=undefined;if(desiredBib===pendingBib)desiredBib=undefined;}
    planError=!success;renderCrewGlance();renderSharing();
  }
  async function createRoom(){
    if(publicMode)return;
    const button=q('[data-live-action="create"]');if(button){button.disabled=true;button.textContent='Creating…';}
    try{
      const made=await api('/api/crew',{method:'POST',body:{action:'create'}});
      if(!validToken(made.viewToken)||!validToken(made.publishToken))throw new Error('Invalid private room');
      privateRoom={viewToken:made.viewToken,publishToken:made.publishToken,expiresAt:made.expiresAt||null};storePrivate();room={position:null,sharing:false,bib:'',meetup:null,googleMapsUrl:null,expiresAt:made.expiresAt};roomError='';roomLoaded=true;gpsStatus='stopped';
      window.supportGuide?.setSharedMeetup(undefined);
      desiredBib=bib();desiredMeetup=meetupPayload(window.supportGuide?.getSelected?.());await syncPlan();
      renderSharing(true);renderCrewGlance();notify('Private crew link ready. Share it with the family, then start sharing when ready.');
    }catch{roomError='unavailable';renderSharing(true);notify('Private sharing could not be created. Please try again with a connection.');}
  }
  function stopWatch(){if(gpsTimer!==null)clearInterval(gpsTimer);gpsTimer=null;}
  function selectLocationPerson(personId){
    if(!Object.hasOwn(SUPPORTERS,personId)||personId===locationPersonId||locationControlBusy)return;
    // Choosing a different person ends only this phone's local GPS session.
    // Captured old requests cannot publish under the newly selected identity.
    ++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';gpsDetail='';
    locationPersonId=personId;
    try{localStorage.setItem(LOCATION_PERSON_KEY,personId);}catch{}
    renderSharing(true);renderCrewGlance();
  }
  function ensurePhoneTimer(){
    if(gpsTimer!==null||!sharingRequested||document.hidden)return;
    gpsTimer=setInterval(()=>{
      if(sharingRequested&&!document.hidden&&!oneShotBusy)requestPhonePosition({automatic:true});
    },LOCATION_INTERVAL_MS);
  }
  function enqueueControl(operation){const task=controlQueue.then(operation,operation);controlQueue=task.catch(()=>{});return task;}
  function freshPhoneFix(position){
    if(!position?.coords||!Number.isFinite(position.timestamp)||Date.now()-position.timestamp>30000||position.timestamp>Date.now()+30000)return null;
    const p={lat:position.coords.latitude,lng:position.coords.longitude,accuracy:position.coords.accuracy,recordedAt:new Date(position.timestamp).toISOString()};
    return coordinates(p)&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=100000?p:null;
  }
  function gpsErrorStatus(error){return error?.code===1?'denied':error?.code===3?'timeout':'unavailable';}
  function requestPhonePosition({automatic=false,starting=false}={}){
    if(!canShareLocation()||oneShotBusy||automatic&&!sharingRequested)return;
    if(!navigator.geolocation?.getCurrentPosition||!window.isSecureContext){sharingRequested=false;stopWatch();gpsStatus='unsupported';renderSharing();return;}
    if(document.hidden){pausePhoneSharing();return;}
    // Update now may be tapped while the return-to-page refresh is pending.
    // Preserve its automatic session without replacing or cancelling this fix.
    ensurePhoneTimer();
    const epoch=sharingRequested?sessionEpoch:++sessionEpoch,personId=locationPersonId;
    oneShotBusy=true;gpsStatus='waiting';gpsDetail='';renderSharing();
    const current=()=>epoch===sessionEpoch&&personId===locationPersonId&&oneShotBusy&&!document.hidden;
    const fail=status=>{
      if(!current())return;
      oneShotBusy=false;gpsStatus=status;
      if(starting||status==='denied'){sharingRequested=false;stopWatch();}
      renderSharing();
    };
    try{
      navigator.geolocation.getCurrentPosition(async position=>{
        if(!current())return;
        const fix=freshPhoneFix(position),previous=supporterPosition(personId);
        if(!fix||previous&&time(fix.recordedAt)<=time(positionTime(previous))){fail('invalid-fix');return;}
        gpsStatus='publishing';renderSharing();
        // Only a direct Start or Update action may start sharing. A timer tick
        // or automatic resume cannot restart a session another supporter stopped.
        const patch=automatic?{personId,position:fix}:{personId,sharing:true,position:fix};
        const success=await enqueueControl(()=>patchLocation(patch,{quiet:true,epoch}));
        if(!current())return;
        oneShotBusy=false;
        if(!success&&starting){sharingRequested=false;stopWatch();}
        gpsStatus=success?(sharingRequested?'sharing':'updated'):'publishing-error';
        if(success&&!automatic)notify(sharingRequested?`${SUPPORTERS[personId]}’s location shared. Automatic updates are on every 30 seconds.`:`${SUPPORTERS[personId]}’s GPS position is now shared on this map.`);
        renderSharing();renderCrewGlance();
      },error=>fail(gpsErrorStatus(error)),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    }catch{fail('unavailable');}
  }
  function updateLocationOnce(){requestPhonePosition();}
  function startWatch({resuming=false}={}){
    if(!canShareLocation()||oneShotBusy)return;
    if(document.hidden){gpsStatus='paused';renderSharing();return;}
    if(resuming&&(!sharingRequested||gpsStatus!=='paused'||gpsTimer!==null))return;
    ++sessionEpoch;stopWatch();sharingRequested=true;
    ensurePhoneTimer();
    requestPhonePosition(resuming?{automatic:true}:{starting:true});
  }
  async function stopSharing(){
    if(!canShareLocation())return;
    const epoch=++sessionEpoch,personId=locationPersonId,requestedToken=owner()?privateRoom.publishToken:locationGrant.token;sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';renderSharing();
    // A deliberate Stop keeps its captured target even if the user next selects
    // another identity. Only its local completion message is session-dependent.
    const success=await enqueueControl(()=>requestedToken===(owner()?privateRoom.publishToken:locationGrant.token)?patchLocation({personId,sharing:false,position:null},{quiet:true}):false);
    if(epoch!==sessionEpoch)return;
    if(!success)gpsStatus='stopping-error';else notify(`${SUPPORTERS[personId]}’s location sharing stopped and the last phone position removed.`);
    renderSharing();
  }
  async function revoke(){
    if(!owner()||!window.confirm(publicMode?'End race sharing for everyone? This removes the shared supporter position and cannot be restarted with this setup link. Use Stop sharing instead for a temporary break.':'Revoke this private crew link? The family will need a new link for shared positions and meet-ups.'))return;
    const requestedToken=privateRoom.publishToken;++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();
    try{await enqueueControl(()=>api('/api/crew',{method:'DELETE',token:requestedToken,body:{}}));if(requestedToken===privateRoom.publishToken)leaveRoom();notify(publicMode?'Race sharing ended.':'Private crew link revoked.');}
    catch(error){if([401,403,404,410].includes(error.status)){leaveRoom();notify('That private crew link is no longer available.');}else{gpsStatus='stopping-error';renderSharing();notify('The link could not be revoked. Please retry when connected.');}}
  }
  function leaveRoom(){
    clearSavedMaps();
    ++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();publicControlReady=false;locationControlReady=false;locationGrant={token:null,expiresAt:null};storeLocationGrant();privateRoom={viewToken:null,publishToken:null,expiresAt:null};room=null;roomError='';roomLoaded=false;gpsStatus='stopped';desiredMeetup=undefined;desiredBib=undefined;planError=false;storePrivate();window.supportGuide?.setSharedMeetup(publicMode?null:undefined);renderCrewGlance();renderSharing(true);updateMapMarkers();if(publicMode)pollCrew();
  }
  function invite(){
    if(publicMode){shareText('Emily & Jeff · Live race guide','Follow Emily and her support crew on the live race map.',location.origin+location.pathname+'#now');return;}
    if(!validToken(privateRoom.viewToken))return;
    const url=location.origin+location.pathname+'#crew='+privateRoom.viewToken;
    shareText('Emily & Jeff · Private crew link','Private family crew link: latest support position, agreed meet-up and race number. Anyone with this link can view these updates.',url);
  }
  function markerIcon(kind){return L.divIcon({className:'live-position-pin live-'+(kind==='runner'?'runner':'crew')+'-pin',html:'<span>'+safe(kind==='runner'?registeredRunners.map(person=>(person.shortName||person.name||'R').charAt(0)).join('+')||'R':SUPPORTERS[kind]?.charAt(0)||'♡')+'</span>',iconSize:[44,44],iconAnchor:[22,22]});}
  function updateMapMarkers(){
    if(!liveMap||!window.L)return;
    if(coordinates(participant)){
      if(!runnerMarker){runnerMarker=L.marker([participant.lat,participant.lng],{icon:markerIcon('runner'),zIndexOffset:500,title:activeRunnerNames+'’s last reported position'}).addTo(liveMap);runnerMarker.on('click',()=>window.supportGuide?.clearMapSelection?.());}
      else runnerMarker.setLatLng([participant.lat,participant.lng]);
      runnerMarker.bindPopup(`<strong>${safe(activeRunnerNames)}</strong><br>Official report ${safe(ageText(participant.updatedAt))}${tracker.status!=='live'?'<br>Tracker currently unavailable':''}`);
    }else if(runnerMarker){liveMap.removeLayer(runnerMarker);runnerMarker=null;}
    for(const [id,name] of Object.entries(SUPPORTERS)){
      const p=supporterPosition(id);
      if(p){
        if(!supporterMarkers[id]){supporterMarkers[id]=L.marker([p.lat,p.lng],{icon:markerIcon(id),zIndexOffset:550,title:`${name}’s last reported position`}).addTo(liveMap);supporterMarkers[id].on('click',()=>window.supportGuide?.clearMapSelection?.());}
        else supporterMarkers[id].setLatLng([p.lat,p.lng]);
        supporterMarkers[id].bindPopup(`<strong>${name}</strong><br>Reported ${safe(ageText(positionTime(p)))}${supporterSharingActive(id)&&fresh(p)?'':'<br>Last known position'}${Number.isFinite(p.accuracy)?`<br>GPS accuracy about ${Math.round(p.accuracy)} m`:''}`);
        if(Number.isFinite(p.accuracy)&&p.accuracy>0){if(!supporterAccuracy[id])supporterAccuracy[id]=L.circle([p.lat,p.lng],{radius:p.accuracy,color:'#9b5eac',fillOpacity:.08,weight:1,interactive:false}).addTo(liveMap);else supporterAccuracy[id].setLatLng([p.lat,p.lng]).setRadius(p.accuracy);}
        else if(supporterAccuracy[id]){liveMap.removeLayer(supporterAccuracy[id]);delete supporterAccuracy[id];}
      }else{
        if(supporterMarkers[id]){liveMap.removeLayer(supporterMarkers[id]);delete supporterMarkers[id];}
        if(supporterAccuracy[id]){liveMap.removeLayer(supporterAccuracy[id]);delete supporterAccuracy[id];}
      }
    }
  }
  function showCrewLocationControls(personId){
    // A named Connect action is an explicit choice of phone identity. Merely
    // opening a person's avatar must not switch the current sharing session.
    if(Object.hasOwn(SUPPORTERS,personId))selectLocationPerson(personId);
    switchTab('live');renderSharing(true);
    const focusControls=()=>{
      if(typeof currentTab!=='undefined'&&currentTab!=='live')return;
      let target=q('#live-update-location');
      if(publicMode&&!canShareLocation()){
        const setup=q('#live-location-setup');
        if(setup){setup.open=true;target=q('#live-location-code')||setup;}
      }
      if(!target){target=q('#live-sharing-panel');target?.setAttribute?.('tabindex','-1');}
      target?.scrollIntoView?.({block:'start',behavior:'smooth'});target?.focus?.({preventScroll:true});
    };
    // Run after the drawer's own focus step so the requested control keeps focus.
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(focusControls);else focusControls();
  }
  function showPosition(kind){
    const individual=registeredRunners.find(person=>person.id===kind);
    const supporterId=kind==='crew'?'huiyan':Object.hasOwn(SUPPORTERS,kind)?kind:null;
    const p=supporterId?supporterPosition(supporterId):individual?runnerSnapshot(individual,runnerFeeds[kind]):participant;
    if(!coordinates(p)){if(supporterId)showCrewLocationControls();else switchTab('live');return;}
    if(window.raceMap?.focusPerson){window.raceMap.focusPerson(kind);return;}
    window.supportGuide?.clearMapSelection?.();switchTab('map');
    if(!liveMap){notify('The map is loading. Try again in a moment.');return;}
    updateMapMarkers();liveMap.setView([p.lat,p.lng],15);(supporterId?supporterMarkers[supporterId]:runnerMarker)?.openPopup();
    const reportTime=supporterId?positionTime(p):p.updatedAt;
    if(q('#map-detail'))q('#map-detail').innerHTML=`<div class="map-place-info"><span class="stage-tag">${supporterId?'SUPPORTER POSITION':'OFFICIAL TRACKER POSITION'}</span><h3>${supporterId?SUPPORTERS[supporterId]:safe(activeRunnerNames)}</h3><p>Reported ${safe(ageText(reportTime))}.</p><p class="small muted">A reported position can move. Confirm the meeting place together.</p></div>${supporterId?`<button class="button primary" data-live-action="location-controls" data-person-id="${supporterId}">Location updates for ${SUPPORTERS[supporterId]}</button>`:''}`;
    q('#route-map')?.scrollIntoView({block:'center',behavior:'smooth'});
  }
  q('#crew-location-glance')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();showCrewLocationControls();});
  q('#live-running-distance')?.closest('button')?.addEventListener('click',event=>{if(coordinates(participant)){event.preventDefault();event.stopPropagation();showPosition('runner');}});
  async function retryLiveUpdates(){
    if(retryBusy)return;
    retryBusy=true;renderSharing();
    try{await Promise.all([pollTracker(),pollCrew()]);}
    finally{retryBusy=false;renderTracker();renderCrewGlance();renderSharing();}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-live-action]');if(!button)return;
    const action=button.dataset.liveAction,personId=button.dataset.personId;
    if(action==='supporter-plan')return setSupporterPlan(personId,button.dataset.planMode);
    if(action==='select-person')return selectLocationPerson(personId);
    if(['start','update-location','stop'].includes(action)&&personId&&personId!==locationPersonId)return;
    if(action==='supporter-map'&&Object.hasOwn(SUPPORTERS,personId))return showPosition(personId);
    if(action==='retry')return retryLiveUpdates();
    if(action==='activate-public')activatePublic();else if(action==='activate-location')activateLocation();else if(action==='update-location')updateLocationOnce();else if(action==='location-controls')showCrewLocationControls(personId);else if(action==='create')createRoom();else if(action==='start')startWatch();else if(action==='stop')stopSharing();else if(action==='invite')invite();else if(action==='revoke')revoke();else if(action==='leave')leaveRoom();else if(action==='crew-map')showPosition('crew');
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='live-location-form')return;event.preventDefault();
    const input=q('#live-location-code'),token=String(input?.value||'').trim();
    if(!publicMode||!validLocationToken(token)){locationFormError='Paste the complete private location setup code, then tap Connect.';renderSharing(true);return;}
    if(input)input.value='';
    ++sessionEpoch;sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';locationControlReady=false;locationFormError='';
    locationGrant={token,expiresAt:null};storeLocationGrant();
    await activateLocation();
    if(canShareLocation()&&!document.hidden)showCrewLocationControls();
  });
  window.addEventListener('racebibchange',()=>{
    if(registeredRunners.length){renderTracker();pollTracker();return;}
    participant=null;tracker={status:bib()?'waiting':'need-number'};renderTracker();pollTracker();
    const current=bib();if(owner()&&roomLoaded&&current!==lastBibSignature){desiredBib=current;syncPlan();}
  });
  window.addEventListener('supportchange',event=>{
    if(!owner()||!roomLoaded||['load','shared','server','owned-load'].includes(event.detail?.reason))return;
    const meetup=meetupPayload(window.supportGuide?.getSelected?.()),signature=JSON.stringify(meetup);
    if(signature===lastMeetingSignature&&desiredMeetup===undefined)return;desiredMeetup=meetup;syncPlan();
  });
  function pausePhoneSharing(){
    if(!sharingRequested&&!oneShotBusy)return;
    ++sessionEpoch;
    oneShotBusy=false;stopWatch();gpsStatus='paused';gpsDetail='';renderSharing();
    // Keep the last confirmed report at its real time. Automatic suspension
    // stops this phone only and retains its in-memory sharing intent. Explicit
    // Stop sharing clears that intent and removes the shared pin.
  }
  async function returnToPage(){
    if(document.hidden)return;
    const epoch=sessionEpoch,resume=sharingRequested&&gpsStatus==='paused';
    pollTracker();
    await pollCrew();
    // Stop, hiding again, expiry or revocation during the refresh wins. A second
    // pageshow/visibility event cannot create another timer or GPS acquisition.
    if(document.hidden||epoch!==sessionEpoch)return;
    if(resume&&sharingRequested&&gpsStatus==='paused'){
      if(!canShareLocation()||roomError==='expired'||publicStatus==='ended'){
        sharingRequested=false;stopWatch();gpsStatus='stopped';
      }else if(roomLoaded&&!roomError&&!supporterState(locationPersonId).sharing){
        sharingRequested=false;stopWatch();gpsDetail=`${SUPPORTERS[locationPersonId]}’s location sharing is stopped. Choose a sharing button below to start again.`;
      }else startWatch({resuming:true});
    }
    renderTracker();renderCrewGlance();renderSharing();
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)pausePhoneSharing();
    else returnToPage();
  });
  window.addEventListener('pagehide',event=>{
    pausePhoneSharing();
    // Only a back/forward-cache restoration preserves this document session.
    // A reload or ordinary navigation must still require a new explicit Start.
    if(!event.persisted){sharingRequested=false;oneShotBusy=false;stopWatch();gpsStatus='stopped';gpsDetail='';renderSharing();}
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)returnToPage();});
  window.liveGuide={getSnapshot,setSupporterPlan,pendingReleases,acknowledgeCelebration,releaseCelebration,addEvMeetup(id){return checkpointAction('add-ev',id);},removeEvMeetup(id){return checkpointAction('remove-ev',id);},selectCheckpoint(id){return checkpointAction('select',id);},completeCheckpoint(id){return checkpointAction('complete',id);},skipCheckpoint(id){return checkpointAction('skip',id);},undoCheckpoint(id){return checkpointAction('undo',id);},onMapReady(instance){liveMap=instance;updateMapMarkers();},refresh(){return Promise.all([pollTracker(),pollCrew(),window.rivalGuide?.refresh?.()]);},showCrewLocationControls,getLocationControls,showCrewOnMap(){showPosition('crew');},showRunnersOnMap(){showPosition('runner');},showRunnerOnMap(id){if(registeredRunners.some(person=>person.id===id))showPosition(id);}};
  if(typeof map!=='undefined'&&map)window.liveGuide.onMapReady(map);
  fetch('data/route.geojson').then(r=>{if(!r.ok)throw new Error('Route unavailable');return r.json();}).then(geo=>{const c=geo.coordinates||geo.geometry?.coordinates;if(!Array.isArray(c))return;routeCoords=c.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));routeCumulative=[0];for(let i=1;i<routeCoords.length;i++)routeCumulative.push(routeCumulative[i-1]+haversine(routeCoords[i-1],routeCoords[i]));renderTracker();}).catch(()=>{});
  restoreSavedMaps();
  if(publicMode||privateRoom.viewToken&&!owner())window.supportGuide?.setSharedMeetup(null);
  renderTracker();renderCrewGlance();renderSharing();pollTracker();
  const activations=[];
  if(publicMode&&validToken(privateRoom.publishToken))activations.push(activatePublic());
  if(publicMode&&validLocationToken(locationGrant.token))activations.push(activateLocation());
  if(activations.length)Promise.allSettled(activations).then(pollCrew);else pollCrew();
  if(supportInvitation||locationInvitation)switchTab('live');
  if(joinedByLink){switchTab('now');notify(owner()?'Your private crew link is ready.':'Joined the private crew view. ♡');}
  setInterval(()=>{if(!document.hidden)pollTracker();},30000);
  window.addEventListener('online',()=>{pollTracker();pollCrew();syncPlan();});
  setInterval(()=>{if(!document.hidden){pollCrew();syncPlan();renderTracker();renderCrewGlance();}},15000);
})();
