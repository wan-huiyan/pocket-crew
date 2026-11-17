'use strict';
(() => {
  const q = selector => document.querySelector(selector);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const mode = () => typeof state !== 'undefined' && state.mode === 'supporter' ? 'supporter' : 'runner';
  const posterMode = () => Boolean(document.body?.classList?.contains?.('poster-mode'));
  const compactPosterPins = () => toiletMapActive || chargerMapActive || fullRouteActive || milestoneMapActive || (posterMode() && raceMap?.getSize().y < 280);
  const timestamp = x => typeof x === 'number' ? (x < 1e12 ? x * 1000 : x) : Date.parse(x || '');
  const age = p => Math.max(0, Date.now() - timestamp(p?.recordedAt || p?.updatedAt));
  const ago = p => !Number.isFinite(age(p)) ? 'time unavailable' : age(p) < 60000 ? 'just now' : age(p) < 3600000 ? Math.floor(age(p) / 60000) + ' min ago' : Math.floor(age(p) / 3600000) + 'h ago';
  const fresh = p => p?.fresh === true && age(p) < 300000;
  const distance = (a,b) => { const rad = x => x * Math.PI / 180, dl = rad(b.lat-a.lat), dn = rad(b.lng-a.lng); const h = Math.sin(dl/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dn/2)**2; return 6371.0088*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); };
  const unit = km => km.toFixed(1) + '<span class="distance-unit">km</span>';
  const title = p => p?.label || p?.name || 'Agreed meet-up';
  const kinds = {toilet:{symbol:'WC',label:'Toilets'},parking:{symbol:'P',label:'Parking'},charger:{symbol:'ϟ',label:'EV charging'},cafe:{symbol:'☕',label:'Café'}};
  const people = [
    {id:'emily',name:'Emily',feed:'runner'},
    {id:'jeff',name:'Jeff',feed:'crew'},
    {id:'huiyan',name:'Huiyan',feed:'crew'},
    {id:'graham',name:'Graham',feed:'crew'},
    {id:'ben',name:'Ben',feed:'crew'}
  ];
  let raceMap, geometry = [], cumulative = [], data, pois = [], frame = [], current = {}, following = true, moving = false, activeFilter = 'toilet', placeLayer, routeLayer, peopleLayer, rivalLayer, tileFailure = false, mapLoadError = false;
  let milestones = [], milestoneMapActive = false;
  let pinnedPoint = null, arrivalDetailPoint = null, pointDetail = null, activePersonId = null, toiletMapActive = false, chargerMapActive = false, fullRouteActive = false;
  let chargerScope = 'remaining', chargerMeetupsOnly = false;
  let checkpointBusy = false, checkpointMessage = '';
  // WC filters are local viewing preferences; they never change the meet-up plan.
  let toiletScope = 'remaining', toiletArrival = null, toiletOpening = 'all', toiletWide = null, highlightedToilet = null;
  const toiletAudience = () => toiletArrival || (mode()==='supporter'&&current.supporterPlans?.[current.sharing?.personId]?.mode!=='walking'?'crew':'runner');
  const toiletScopeName = () => toiletScope==='20'?'Next 20 km':'Rest of route';
  const toiletDriver = () => window.crewTravel?.driver?.(current,Date.now()) || null;
  const toiletArrivalName = () => toiletAudience()==='crew'?(toiletDriver()?.name||'Meet-up crew')+' · driving now':'Emily’s ETA';
  const toiletOffsetLimit = () => (toiletWide===null?mode()==='supporter':toiletWide)?3000:800;
  const toiletPlanEnd = () => Number.isFinite(planData().planningEndKm)?planData().planningEndKm:Math.max(cumulative.at(-1)||0,...pois.map(p=>Number.isFinite(p.routeKm)?p.routeKm:0));
  const toiletWindowEnd = () => Math.min(toiletPlanEnd(),toiletScope==='20'?baseKm()+20:Infinity);
  const chargerScopeName = () => chargerScope==='all'?'Whole route':'Rest of route';
  const chargerMeetupAdded = point => Boolean(point&&(!point.optionalMeetup||window.supportGuide?.isEvAdded?.(point.id)||selected()?.id===point.id));
  const rival = () => window.rivalGuide?.getSnapshot?.() || {id:'madlis',name:'Matt Leese',shortName:'Matt',bib:'210',position:null,status:'waiting'};
  const rivalPosition = () => {
    const p=rival().position, time=timestamp(p?.recordedAt||p?.updatedAt);
    return isPoint(p)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&Number.isFinite(time)&&time<=Date.now()+30000?p:null;
  };
  // The old Matt portrait remains a failsafe only if the category module fails
  // to load. Normally he joins the other competitors as a coloured crow.
  const rivalMapPosition = () => window.competitorGuide?.getSnapshot?null:window.competitorGuide?.isShown?.('210')===false?null:rivalPosition();
  const runnerPeople = people.filter(person=>person.feed==='runner');
  const supporterPeople = people.filter(person=>person.feed==='crew');
  const hasRunnerFeeds = () => Object.prototype.hasOwnProperty.call(current,'runners');
  // Emily is the sole race feed. Jeff now needs his own supporter phone report.
  const legacyRunner = () => current.runner?.summaryRunnerId==='jeff'||current.runner?.bib==='133'||current.bib==='133'?null:current.runner;
  const runnerPosition = id => id==='emily'?(hasRunnerFeeds() ? current.runners?.emily || null : legacyRunner()):null;
  const raceRunner = () => runnerPosition('emily');
  const raceRunners = () => ({emily:raceRunner()});
  const raceSnapshot = () => ({...current,runner:raceRunner(),runners:raceRunners()});
  // Legacy crew reports came from Huiyan's phone. Other supporters need their own reports.
  const supporterPosition = id => Object.prototype.hasOwnProperty.call(current,'supporters') ? current.supporters?.[id] || null : id==='huiyan' ? current.crew || null : null;
  const supporterPlan = id => current.supporterPlans?.[id]?.mode;
  const supporterPlanLabel = (id,short=false) => supporterPlan(id)==='walking'?(short?'With Emily':'Walking with Emily'):supporterPlan(id)==='meeting'?(short?'Next stop':'Meeting at next stop'):'';
  // Map-only co-location: a walking plan is not a phone GPS update. Keep the
  // recorded time and coordinate from Emily's official race tracker intact.
  const emilyTrackerForWalker = id => {
    const p=raceRunner(),at=timestamp(p?.recordedAt);
    return supporterPlan(id)==='walking'&&isPoint(p)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&fresh(p)&&Number.isFinite(at)&&at<=Date.now()+30000&&!p.retired&&!p.finished?p:null;
  };
  const mapSupporterPosition = id => {
    const tracker=emilyTrackerForWalker(id);
    return tracker?{...tracker,viaEmilyTracker:true}:supporterPosition(id);
  };
  const supporterPositions = () => supporterPeople.map(person=>mapSupporterPosition(person.id)).filter(isPoint);
  const personPosition = person => person.feed==='crew' ? mapSupporterPosition(person.id) : runnerPosition(person.id);
  const visibleMilestones = () => milestones.filter(p=>!p.hiddenUntilReached&&!p.id.startsWith('km-')||current.achievements?.persisted===true&&current.achievements.records?.some(r=>r.runnerId==='emily'&&r.milestoneId===p.id));
  const runnerPositions = () => runnerPeople.map(person=>runnerPosition(person.id)).filter(isPoint);
  const summarySelection = () => hasRunnerFeeds() ? window.arrivalEta?.selectRunner?.({runners:raceRunners(),now:Date.now()}) : null;
  const summaryName = () => raceRunner()?'Emily':'';
  const runnerBib = person => current.runnerTracking?.[person.id]?.bib || (!hasRunnerFeeds()?current.bib:null);
  const runnerTrackingIssue = person => ({
    unavailable:'Report unavailable',error:'Report unavailable',offline:'Report unavailable',
    'wrong-event':'Check event','event-not-current':'Check event',
    'not-found':'Check race number',ambiguous:'Check tracker entry'
  })[current.runnerTracking?.[person.id]?.status] || null;
  function runnerWaitingStatus(person) {
    const issue=runnerTrackingIssue(person);if(issue)return issue;
    if(current.runnerTracking?.[person.id]?.status==='need-number')return runnerBib(person)?'Check race number':'Add race number';
    return runnerBib(person)?'Awaiting report':current.room?.owner?'Add race number':'Awaiting tracker';
  }
  function trackerChipLabel() {
    const chosen=summarySelection(), selectedReport=chosen?.runner;
    if(chosen?.positionUsable&&isPoint(selectedReport))return 'Updated '+ago(selectedReport)+' ›';
    const person=runnerPeople[0],report=raceRunner(),bib=runnerBib(person),issue=runnerTrackingIssue(person);
    if(issue)return 'Emily'+(bib?' '+bib:'')+' · '+issue.toLowerCase()+' ›';
    if(!isPoint(report))return 'Emily'+(bib?' '+bib:'')+' · '+runnerWaitingStatus(person).toLowerCase()+' ›';
    if(report.retired)return 'Emily retired ›';
    if(report.finished)return 'Emily finished ›';
    if(report.offRouteM>=500)return 'Emily off route ›';
    return (fresh(report)?'Updated ':'Last report · ')+ago(report)+' ›';
  }
  function kmAtPoint(km) {
    if (!geometry.length) return null;
    const end = cumulative[cumulative.length-1]; km = Math.max(0,Math.min(end,km));
    let i = 1; while (i < cumulative.length-1 && cumulative[i] < km) i++;
    const part = (km-cumulative[i-1]) / Math.max(.000001,cumulative[i]-cumulative[i-1]);
    const a=geometry[i-1], b=geometry[i]; return [a[1]+(b[1]-a[1])*part, a[0]+(b[0]-a[0])*part];
  }
  function slice(from,to) {
    if(geometry.length<2)return [];
    const result=[kmAtPoint(from)];
    for(let i=1;i<geometry.length-1;i++)if(cumulative[i]>from&&cumulative[i]<to)result.push([geometry[i][1],geometry[i][0]]);
    result.push(kmAtPoint(to));return result.filter(Boolean);
  }
  function progress() {
    if(hasRunnerFeeds()){
      const chosen=summarySelection();
      return chosen?.positionUsable&&Number.isFinite(chosen.runner.routeKm)?chosen.runner.routeKm:null;
    }
    const r=raceRunner();
    if(!r || (r.offRouteM!==null && Number.isFinite(r.offRouteM) && r.offRouteM>=500))return null;
    return Number.isFinite(r.routeKm) ? r.routeKm : Number.isFinite(r.projectedRouteKm) ? r.projectedRouteKm : null;
  }
  const selected = () => window.supportGuide?.getSelected?.() || current.meetup || null;
  const planData = () => window.supportGuide?.getMapPlanData?.() || {};
  const manualKm = () => !raceRunner() && Number.isFinite(planData().progressKm) ? planData().progressKm : null;
  const baseKm = () => progress() ?? (Number.isFinite(raceRunner()?.projectedRouteKm)?raceRunner().projectedRouteKm:manualKm()??0);
  function mapPlan(limitOverride) {
    const source=planData(), known=progress() ?? manualKm();
    const plan=window.upcomingPoints?.plan({
      ...source,selected:selected(),
      limit:limitOverride || (mode()==='runner'||compactPosterPins()?1:2),
      progressKm:known ?? (!hasRunnerFeeds()&&Number.isFinite(raceRunner()?.projectedRouteKm)?raceRunner().projectedRouteKm:null),
      planningEndKm:source.planningEndKm ?? cumulative[cumulative.length-1]
    }) || {points:isPoint(selected())?[{...selected(),agreed:true,sequence:'next',alternatives:[]}]:[],fromKm:baseKm(),endKm:baseKm()+10};
    if(!Number.isFinite(known))plan.points=plan.points.map(p=>({...p,distanceKm:null}));
    return plan;
  }
  const nextMeeting = () => mapPlan().points[0] || null;
  const followingMeeting = () => mapPlan(2).points[1] || null;
  const landmarkName = p => p?.landmark?.mapLabel || p?.landmark?.name || p?.name || p?.detail || title(p);
  const townName = p => p?.town || p?.landmark?.town || '';
  function meetingCrowKm(p){
    const fromShared=window.routeDistances?.crowKm?.(p);
    return Number.isFinite(fromShared)?fromShared:isPoint(p)&&isPoint(data?.crowDistanceOrigin)?distance(p,data.crowDistanceOrigin):null;
  }
  function meetingDistanceCards(p){
    const route=Number.isFinite(p?.routeKm)?'~'+p.routeKm.toFixed(1)+' km':'Not set';
    const crow=meetingCrowKm(p);
    return '<dl class="point-distance-pair" aria-label="Total distance from Meriden to this meeting point">'+
      '<div><dt>On-foot planned route</dt><dd>'+safe(route)+'</dd></div>'+
      '<div><dt>As the crow flies · approx.</dt><dd>'+safe(Number.isFinite(crow)?'~'+crow.toFixed(1)+' km':'Not available')+'</dd></div></dl>';
  }
  const meetingName = p => {const name=title(p),town=townName(p);return name+(town&&!name.toLowerCase().includes(town.toLowerCase())?' · '+town:'');};
  const pointStatus = p => {
    const value=planData().statuses?.[p?.id] || current.checkpointStatuses?.[p?.id];
    return typeof value==='string'?value:value?.status;
  };
  const completionLabel = p => pointStatus(p)==='met'?'Met':pointStatus(p)==='skipped'?'Skipped':pointStatus(p)==='passed'?'Passed':'';
  const completionSymbol = p => pointStatus(p)==='skipped'?'↷':'✓';
  const canManageCheckpoints = () => mode()==='supporter'&&Boolean(current.room?.canManageCheckpoints || current.room?.owner);
  const meetingForecast = p => window.meetingForecast?.estimate?.({snapshot:raceSnapshot(),point:p,now:Date.now()});
  function forecastRange(forecast) {
    const range=typeof forecast?.rangeText==='string'?forecast.rangeText.trim():'';
    if(range)return range.replace(/^(?:around|about)\s+/i,'');
    const early=forecast?.earliestFormattedTime,late=forecast?.latestFormattedTime;
    return early?(late&&late!==early?early+'–'+late:early):forecast?.formattedTime||'time pending';
  }
  function forecastDisplay(forecast) {
    if(forecast.status==='ready'){
      const text='ETA '+forecastRange(forecast)+(forecast.paceHeld?' · provisional':''),detail=[text,forecast.note].filter(Boolean).join('. ');
      return {state:'available',clockText:text,text,fullText:detail,ariaLabel:detail,forecast};
    }
    const text=forecast.status==='arrived'?'Near this stop':forecast.status==='passed'?'Passed this stop':'ETA · waiting for pace';
    return {state:forecast.status==='arrived'?'arrived':forecast.status==='passed'?'passed':'unavailable',clockText:text,text,fullText:forecast.note||text,ariaLabel:forecast.note||text,forecast};
  }
  function forecastMethod(forecast) {
    return forecast?.note?`<details class="point-forecast-method"><summary>How this arrival is estimated</summary><p>${safe(forecast.note)}</p></details>`:'';
  }
  function forecastDetail(p) {
    if(completionLabel(p))return '';
    const forecast=meetingForecast(p);if(!forecast)return '';
    if(forecast.status!=='ready')return `<p class="point-arrival-note">${forecast.status==='arrived'?'Near this stop':forecast.status==='passed'?'Passed on latest tracker':'ETA · waiting for usable route pace'}</p>`;
    return `<div class="point-forecast"><strong>ETA ${safe(forecastRange(forecast))}</strong></div>${forecastMethod(forecast)}`;
  }
  function checkpointControls(p) {
    if(mode()!=='supporter')return '';
    const busy=checkpointBusy||current.checkpointActionBusy,done=completionLabel(p),last=current.lastCheckpointAction;
    const undo=canManageCheckpoints()&&last?.pointId?`<button class="text-button" type="button" data-map-action="undo-checkpoint" data-point-id="${safe(last.pointId)}" ${busy?'disabled':''}>Undo last ${last.action==='skip'?'skip':'mark'}</button>`:'';
    const currentNext=nextMeeting()?.id===p.id;
    const controls=canManageCheckpoints()&&!done&&currentNext?`<button type="button" class="button primary full checkpoint-complete" data-map-action="complete-checkpoint" data-point-id="${safe(p.id)}" ${busy?'disabled':''}>${busy?'Saving for everyone…':'Met here → Next stop'}</button><div class="checkpoint-secondary"><button type="button" class="text-button" data-map-action="skip-checkpoint" data-point-id="${safe(p.id)}" ${busy?'disabled':''}>Skip this stop</button>${undo}</div>`:done?`<div class="checkpoint-stamp ${pointStatus(p)}">${completionSymbol(p)} ${done}</div>${undo}`:undo;
    return `<section class="checkpoint-controls" aria-label="Update this meet-up">${controls}<p class="checkpoint-help">The next stop advances when a fresh runner report passes it.${canManageCheckpoints()?' Mark Met or Skipped to update everyone straight away.':''}</p>${checkpointMessage?`<p class="checkpoint-feedback" role="status">${safe(checkpointMessage)}</p>`:''}</section>`;
  }
  async function changeCheckpoint(action,id) {
    if(!canManageCheckpoints()||checkpointBusy||current.checkpointActionBusy||!id)return;
    if(action!=='undo'&&id!==nextMeeting()?.id){notify('The next stop has changed. Open the current meet-up to mark it.');return;}
    const method=action==='undo'?window.liveGuide?.undoCheckpoint:action==='skip'?window.liveGuide?.skipCheckpoint:window.liveGuide?.completeCheckpoint;
    if(!method){notify('Meet-up controls are still loading. Please try again.');return;}
    checkpointBusy=true;checkpointMessage='';
    document.querySelectorAll('[data-map-action$="-checkpoint"]').forEach(button=>{button.disabled=true;});
    try {
      const result=await method(id);
      if(!result?.ok){checkpointMessage=result?.message||'That change has not been saved. Please try again.';notify(checkpointMessage);return;}
      checkpointMessage=action==='undo'?'Last change undone.':action==='skip'?'Skipped · the next stop is shared with everyone.':'Met ✓ · the next stop is shared with everyone.';
      refresh();showNextPoints();notify(checkpointMessage);
    } catch { checkpointMessage='That change has not been saved. Please try again.';notify(checkpointMessage); }
    finally {
      checkpointBusy=false;
      document.querySelectorAll('[data-map-action$="-checkpoint"]').forEach(button=>{button.disabled=Boolean(current.checkpointActionBusy);});
      const feedback=q('#checkpoint-controls');if(feedback&&pointDetail)feedback.innerHTML=checkpointControls(pointDetail);
    }
  }
  const allMeetings = () => (planData().points||[]).filter(p=>isPoint(p)&&Number.isFinite(p.routeKm)&&p.routeKm<=(planData().planningEndKm??cumulative[cumulative.length-1])&&!p.beyondPlannedFinish).sort((a,b)=>a.routeKm-b.routeKm).map(p=>({...p,sequence:'overview',agreed:p.id===selected()?.id}));
  const displayedMeetings = () => fullRouteActive&&mode()==='supporter'?allMeetings():mapPlan().points.filter(p=>!toiletMapActive||(Number.isFinite(p.routeKm)&&p.routeKm>=baseKm()-.25&&p.routeKm<=toiletWindowEnd()));
  function frameBounds() {
    const bounds=L.latLngBounds(frame);
    displayedMeetings().forEach(p=>{if(isPoint(p))bounds.extend([p.lat,p.lng]);});
    if(toiletMapActive)routeToilets().forEach(p=>bounds.extend([p.lat,p.lng]));
    if(chargerMapActive)routeChargers().forEach(p=>bounds.extend([p.lat,p.lng]));
    runnerPositions().forEach(p=>bounds.extend([p.lat,p.lng]));
    if(fullRouteActive)supporterPositions().forEach(p=>bounds.extend([p.lat,p.lng]));
    return bounds;
  }
  function reference(forToilets=false) {
    if(forToilets && mode()==='runner' && isPoint(raceRunner()))return raceRunner();
    if(isPoint(pinnedPoint))return pinnedPoint;
    if(isPoint(nextMeeting()))return nextMeeting();
    if(isPoint(raceRunner()))return raceRunner();
    return data?.start || {lat:52.4373,lng:-1.6495};
  }
  function directions(p, travel) {
    if(!isPoint(p))return p?.mapUrl || ORIGINAL_MAP;
    return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(p.lat+','+p.lng)+'&travelmode='+(travel || (mode()==='runner'?'walking':'driving'));
  }
  function putText(selector, text) { const el=q(selector); if(el)el.textContent=text; }
  function setDistance(selector, km, fallback='—') { const el=q(selector); el.innerHTML=Number.isFinite(km)?unit(Math.max(0,km)):safe(fallback);el.classList.toggle('is-long',!Number.isFinite(km)&&fallback.length>8); }
  function showCrewLocation() {
    if(window.liveGuide?.showCrewLocationControls)window.liveGuide.showCrewLocationControls();
    else switchTab('live');
  }
  function arrivalEstimate(meet) {
    return window.arrivalEta?.estimate({runners:raceRunners(),meeting:meet,now:Date.now()}) || null;
  }
  function arrivalDisplay(estimate) {
    return window.arrivalEta?.format(estimate,{now:Date.now()}) || {state:'unavailable',clockText:'ETA · waiting',text:'ETA · waiting for tracker',fullText:'An arrival estimate needs current runner reports and estimated route pace.',ariaLabel:'Estimated arrival is waiting for current runner reports and estimated route pace.'};
  }
  function planningArrivalDisplay(meet) {
    const forecast=meetingForecast(meet);
    if(!forecast)return arrivalDisplay(arrivalEstimate(meet));
    return forecastDisplay(forecast);
  }
  function trackerPace(p) {
    if(!Number.isFinite(p?.paceMinPerKm)||p.paceMinPerKm<=0)return '';
    const seconds=Math.round(p.paceMinPerKm*60);
    return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' /km';
  }
  function personRunnerInfo(person) {
    // A person card never borrows the summary/other runner's tracker or pace.
    const runner=current.runners?.[person.id] || null, now=Date.now();
    const reportTime=timestamp(runner?.recordedAt), trackerStatus=current.runnerTracking?.[person.id]?.status;
    const currentReport=isPoint(runner)&&Math.abs(runner.lat)<=90&&Math.abs(runner.lng)<=180&&
      runner.fresh===true&&Number.isFinite(reportTime)&&reportTime<=now+30000&&now-reportTime<300000&&
      (!trackerStatus||trackerStatus==='live'||runner.reportCached===true);
    const onRoute=currentReport&&Number.isFinite(runner.routeKm)&&runner.routeKm>=0&&
      Number.isFinite(runner.offRouteM)&&runner.offRouteM>=0&&runner.offRouteM<500;
    const usable=onRoute&&!runner.retired&&!runner.finished;
    const held=runner?.paceSource==='held-tracker-route';
    const pace=usable&&['recent-tracker-route','held-tracker-route'].includes(runner.paceSource)&&Number.isFinite(runner.paceMinPerKm)&&
      runner.paceMinPerKm>=2&&runner.paceMinPerKm<=120?trackerPace(runner):'';
    let note='Waiting for enough recent GPS progress along the planned route.';
    if(runner?.retired)note='The event tracker marks this runner as retired.';
    else if(runner?.finished)note='The event tracker marks this runner as finished.';
    else if(!runner)note=runnerWaitingStatus(person)+'. Pace will appear when this runner has enough reports.';
    else if(runnerTrackingIssue(person)&&!currentReport)note='This runner’s tracker is temporarily unavailable.';
    else if(!currentReport)note='Waiting for a fresh report. Older pace is not shown.';
    else if(!onRoute)note=runner.offRouteM>=500?'Away from the planned route. Route pace is unavailable.':'Waiting for a reliable position on the planned route.';
    else if(pace)note=held?'Provisional earlier GPS route pace, kept while waiting for enough new moving samples (up to 15 min). Emily may have slowed or stopped. The position shown is from the latest tracker fix.':'GPS progress along the planned route'+(Number.isFinite(runner.paceWindowMinutes)&&runner.paceWindowMinutes>0?' over '+Math.round(runner.paceWindowMinutes)+' min':'')+'. Includes stops.'+(runner.reportCached?' Using the latest available report while the tracker retries.':'');
    return {runner,pace,note,currentReport,usable};
  }
  function replacePersonControls(html) {
    const controls=q('#person-controls');if(!controls||controls.innerHTML===html)return;
    const focused=document.activeElement,action=controls.contains?.(focused)?focused?.dataset?.liveAction:null,planMode=focused?.dataset?.planMode,personId=focused?.dataset?.personId;
    controls.innerHTML=html;
    // Status updates must not steal keyboard focus from an unchanged action.
    if(action){
      const next=controls.querySelector?.('[data-live-action="'+action+'"]'+(action==='supporter-plan'?'[data-person-id="'+personId+'"][data-plan-mode="'+planMode+'"]':''))||controls.querySelector?.('button:not([disabled])');
      (next||q('#person-close'))?.focus?.({preventScroll:true});
    }
  }
  function renderPerson() {
    if(activePersonId==='madlis'){renderRivalPerson();return;}
    const person=people.find(item=>item.id===activePersonId);if(!person)return;
    const crew=person.feed==='crew',position=personPosition(person),bib=crew?null:runnerBib(person);
    putText('#person-heading',person.name);
    putText('#person-role',crew?(person.id==='ben'?'SUPPORT CREW · EMILY’S PARTNER':'SUPPORT CREW'):bib?'RUNNER · #'+bib:'RUNNER');
    putText('#person-subtitle',crew?(supporterPlanLabel(person.id)||'Supporting Emily ♡'):'Powered by tofu ♡');
    const portrait=q('#person-portrait');if(portrait){portrait.hidden=false;portrait.src='assets/avatars-v5/'+person.id+'.webp';}const symbol=q('#person-symbol');if(symbol)symbol.hidden=true;
    const panel=q('#panel-person');panel?.setAttribute('aria-labelledby','person-heading');panel?.setAttribute('data-person',person.id);
    const summary=q('#person-summary');
    if(crew){
      if(summary)summary.innerHTML=position?.viaEmilyTracker?'<p class="person-travel-note"><strong>Shown with Emily · via her official tracker ('+safe(ago(position))+').</strong> This is a shared-plan map position, not '+safe(person.name)+'’s phone GPS. Their own location-sharing controls are below.</p>':'<p class="person-travel-note">'+safe(person.name)+'’s own phone location.</p>';
      replacePersonControls(window.liveGuide?.getLocationControls?.({compact:true,personId:person.id})||'<p class="person-detail-note">Open location setup to connect this phone.</p><button type="button" class="button primary full" data-live-action="location-controls">Connect this phone</button>');
    }else{
      const info=personRunnerInfo(person),meet=nextMeeting();
      const result=arrivalEstimate(meet)?.runners?.[person.id];
      const estimate=info.usable?(info.pace||['arrived','passed'].includes(result?.status)?result:{status:'unavailable',reason:'missing-pace'}):{status:'unavailable',reason:info.runner?.retired?'retired':info.runner?.finished?'finished':info.runner&&!info.currentReport?'stale-report':info.runner?.offRouteM>=500?'off-route':'missing-report'};
      const currentPaceDisplay=arrivalDisplay(estimate);
      const ownForecast=info.usable&&info.pace?window.meetingForecast?.estimate?.({snapshot:{...current,runner:info.runner,runners:{[person.id]:info.runner}},point:meet,now:Date.now()}):null;
      const display=ownForecast?forecastDisplay(ownForecast):currentPaceDisplay,paceValue=info.pace.replace(' /km','');
      const remaining=info.usable&&Number.isFinite(meet?.routeKm)?Math.max(0,meet.routeKm-info.runner.routeKm):null;
      const report=info.runner?'Tracker '+(info.currentReport?'updated ':'last report ')+ago(info.runner):'Waiting for '+person.name+'’s tracker report';
      const html='<div class="person-pace '+(paceValue?'':'is-pending')+'"><span class="person-metric-label">Estimated route pace</span><strong>'+safe(paceValue||'Waiting')+(paceValue?'<small>min/km</small>':'')+'</strong><p>'+safe(info.note)+'</p></div>'+
        '<div class="person-arrival"><span class="person-metric-label">'+safe(meet?landmarkName(meet):'NEXT MEET-UP')+'</span><strong aria-label="'+safe(display.ariaLabel)+'">'+safe(display.clockText)+'</strong>'+(ownForecast?.status==='ready'&&currentPaceDisplay.state==='available'?'<p>'+(info.runner?.paceSource==='held-tracker-route'?'At earlier measured pace':'At current pace')+' · '+safe(currentPaceDisplay.clockText.replace(/^ETA /,''))+'</p>':'')+'<p>'+safe([remaining!==null?remaining.toFixed(1)+' km to go':null,display.remainingText].filter(Boolean).join(' · ')||'Waiting for a usable arrival estimate')+'</p></div>'+
        '<p class="person-report">'+safe(report)+'.'+(display.state==='available'?' ETA uses UK time; stops can change it.':'')+'</p>';
      if(summary&&summary.innerHTML!==html)summary.innerHTML=html;
      replacePersonControls('');
    }
    const mapAction=q('#person-map-action');if(mapAction){mapAction.hidden=!isPoint(position);mapAction.setAttribute('data-map-person-focus',person.id);}
  }
  function openPerson(id) {
    if(id!=='madlis'&&!people.some(person=>person.id===id))return;
    // The selected person is local UI state, not a generic #person deep link.
    activePersonId=id;renderPerson();switchTab('person',false);
  }
  function rivalPace() {
    const other=rival(),p=rivalPosition();
    const pace=other.paceMinPerKm??p?.paceMinPerKm,source=other.paceSource??p?.paceSource;
    if(!fresh(p)||other.retired||other.finished||!Number.isFinite(p?.routeKm)||p.routeKm<0||!Number.isFinite(p?.offRouteM)||p.offRouteM<0||p.offRouteM>=500||source!=='recent-tracker-route'||!Number.isFinite(pace)||pace<2||pace>120)return '';
    return trackerPace({paceMinPerKm:pace});
  }
  function renderRivalPerson() {
    const other=rival(),p=rivalPosition(),reported=isPoint(p),stale=reported&&age(p)>=300000;
    putText('#person-heading',other.name||'Matt Leese');putText('#person-role','RUNNER · #210');putText('#person-subtitle','A little friendly competition ♡');
    const portrait=q('#person-portrait');if(portrait){portrait.hidden=false;portrait.src='assets/avatars-v5/matt.webp';}const symbol=q('#person-symbol');if(symbol)symbol.hidden=true;
    q('#panel-person')?.setAttribute('data-person','madlis');
    const status=reported?(other.retired?'Tracker marked retired. ':other.finished?'Tracker marked finished. ':'')+(stale?'Last report ':'Tracker updated ')+ago(p)+'.':'Waiting for a valid report from the official tracker.';
    const pace=rivalPace();
    q('#person-summary').innerHTML='<div class="person-pace '+(pace?'':'is-pending')+'"><span class="person-metric-label">Estimated route pace</span><strong>'+safe(pace.replace(' /km','')||'Waiting')+(pace?'<small>min/km</small>':'')+'</strong><p>'+safe(other.paceMessage||(pace?'Recent moving GPS progress along this route, excluding stops.':'Waiting for enough recent moving GPS progress on this route.'))+'</p></div><p class="person-report">'+safe(status)+'</p><p class="small muted">Matt’s portrait is an illustrated character.</p>';
    replacePersonControls('');
    const mapAction=q('#person-map-action');if(mapAction){mapAction.hidden=!reported;mapAction.setAttribute('data-map-person-focus','madlis');}
  }
  function arrivalDetail(meet) {
    const estimate=arrivalEstimate(meet),display=planningArrivalDisplay(meet),forecast=display.forecast;
    const rows=runnerPeople.map(person=>{
      const runner=estimate?.runners?.[person.id],formatted=arrivalDisplay(runner),pace=trackerPace(runner),bib=runnerBib(person);
      const windowMinutes=Number.isFinite(runner?.paceWindowMinutes)?Math.round(runner.paceWindowMinutes):null;
      const note=[formatted.remainingText,pace?(runner?.paceSource==='held-tracker-route'?'Earlier measured route pace ':'Estimated route pace ')+pace+(windowMinutes?' over '+windowMinutes+' min':''):''].filter(Boolean).join(' · ');
      return `<div><dt>${safe(person.name)}${bib?` <small>#${safe(bib)}</small>`:''}</dt><dd><strong aria-label="${safe(formatted.ariaLabel)}">${safe(formatted.clockText)}</strong>${note?`<span>${safe(note)}</span>`:''}${formatted.state==='unavailable'?`<span>${safe(formatted.fullText||formatted.ariaLabel)}</span>`:''}</dd></div>`;
    }).join('');
    return `<h3>Estimated arrival</h3><p class="point-arrival-summary" aria-label="${safe(display.ariaLabel)}">${safe(display.text)}</p>${forecast?forecastMethod(forecast)+'<h3 class="point-current-pace-heading">'+(forecast.paceHeld?'At Emily’s earlier measured pace':'At Emily’s current pace')+'</h3>':''}<dl class="point-arrival-runners">${rows}</dl><p class="point-arrival-note">${forecast?'The range begins at unchanged measured moving pace and allows for a later arrival if pace eases. ':''}${forecast?.paceHeld?'Pace is provisionally carried from earlier moving GPS history; it will be reconsidered after resuming. ':'Pace measures movement along the planned route, excluding time spent stationary. '}Arrival uses the remaining route distance. Future stops can change the time. UK local time.</p>`;
  }
  function drawArrival(meet) {
    const display=planningArrivalDisplay(meet),label=q('#map-meet-eta');
    if(label){
      label.textContent=posterMode()?display.text:display.clockText;
      label.setAttribute('aria-label',display.ariaLabel);
      label.setAttribute('title',display.fullText||display.text);
      label.setAttribute('data-eta-state',display.state);
    }
    const ready=q('#map-ready-by');if(ready){ready.hidden=true;ready.textContent='';}
    const action=q(posterMode()?'#poster-meeting':'.distance-destination');
    action?.setAttribute('aria-label',(meet?title(meet)+'. ':'')+display.ariaLabel+' Open meet-up details.');
    const detail=q('#point-arrival');
    if(detail&&arrivalDetailPoint){
      detail.innerHTML=meet?.id===arrivalDetailPoint.id?arrivalDetail(meet):'<p class="point-arrival-note">The next meet-up has changed.</p><button class="text-button" data-map-action="next-point">View the current meet-up ›</button>';
    }
  }
  function drawSummary() {
    const r=summarySelection()?.runner||raceRunner(), km=progress()??manualKm(), meet=nextMeeting(), usable=Number.isFinite(km), live=usable&&fresh(r)&&Number.isFinite(r?.routeKm);
    putText('#map-role-label',mode()==='runner'?'Running':'Supporting');
    setDistance('#map-route-distance',usable?km:null);
    putText('#map-route-caption',usable?(!r?'manual on-foot estimate':live?'on-foot route · approx.':'last known · planned route'):(r?.offRouteM>=500?'off planned route':'waiting for tracker'));
    const standings=window.competitorGuide?.getSnapshot?.();
    const official=standings?.status!=='wrong-event'?standings?.femaleSolo?.find(p=>p.bib==='247'):null;
    const officialTime=timestamp(official?.updatedAt),hasOfficial=Number.isFinite(official?.crowKm)&&official.crowKm>=0&&Number.isFinite(officialTime)&&officialTime<=Date.now()+30000;
    const approx=fresh(r)?meetingCrowKm(r):null;
    setDistance('#map-crow-distance',hasOfficial?official.crowKm:approx);
    putText('#map-crow-caption',hasOfficial?(Date.now()-officialTime<300000?'crow flight · official':'crow flight · last reported'):Number.isFinite(approx)?'crow flight · approx.':'crow flight · awaiting tracker');
    putText('#map-next-meet-name',meet?meetingName(meet):'No point ahead');
    putText('#map-meet-eyebrow',meet?.agreed?'AGREED MEET-UP':'NEXT MEET-UP');
    const after=followingMeeting(),then=q('#map-following-stop');
    if(then){then.hidden=!after;then.textContent=after?'Then: '+meetingName(after):'';}
    const other=rival(),otherPosition=rivalPosition();
    putText('#rival-track-name','😈 '+(other.name||'Matt Leese')+' · #210');
    putText('#rival-track-status',otherPosition?(age(otherPosition)<300000?'Updated ':'Last report ')+ago(otherPosition):other.status==='unavailable'?'Tracker temporarily unavailable':'Waiting for tracker report');
    drawArrival(meet);
    if(usable&&Number.isFinite(meet?.routeKm)){
      const left=meet.routeKm-km;
      if(left<-.15){setDistance('#map-meet-distance',null,'Passed pin');putText('#map-meet-caption','check the meet-up plan');}
      else {setDistance('#map-meet-distance',left);putText('#map-meet-caption',live?'to our meet-up':!r?'manual estimate':'last estimate');}
    } else {setDistance('#map-meet-distance',null);putText('#map-meet-caption',meet?'awaiting position':'to next meet-up');}
    const chip=q('#map-tracking-status');
    const statuses={'need-number':current.room?.owner?'Add race number ›':'Race number pending',waiting:'Waiting for tracker ›',offline:'Offline · last positions',error:'Tracker unavailable ›','not-found':'Checking race number ›','event-not-current':'Waiting for this event ›'};
    const status=current.tracker?.status;
    chip.textContent=!navigator.onLine?'Offline · last report':hasRunnerFeeds()?trackerChipLabel():r?(r.retired?'Tracker retired ›':r.finished?'Finished ›':r.offRouteM>=500?'Off route ›':(fresh(r)?'Updated ':'Last ')+ago(r)+' ›'):(statuses[status]||'Connect tracking ›');
    const trackerDescription=hasRunnerFeeds()?runnerPeople.map(person=>{
      const p=runnerPosition(person.id),bib=runnerBib(person);
      return (current.runnerTracking?.[person.id]?.name||person.name)+(bib?' · race '+bib:'')+': '+(runnerTrackingIssue(person)?.toLowerCase()||(isPoint(p)?(fresh(p)?'updated ':'last report ')+ago(p):runnerWaitingStatus(person).toLowerCase()));
    }).join('. '):chip.textContent;
    chip.setAttribute('aria-label',trackerDescription);chip.setAttribute('title',trackerDescription);
    chip.classList.toggle('is-stale',runnerPositions().some(p=>!fresh(p))||runnerPeople.some(person=>runnerTrackingIssue(person))||!navigator.onLine);
    putText('#map-meet-title',meet?'⚑ '+title(meet)+(meet.agreed?' · agreed':' · option'):'⚑ Choose our next hello');
    const drive=q('#map-drive');drive.textContent=meet?'Drive to pin':'Choose meet-up';
    drive.href=meet?directions(meet,'driving'):'#now';
    if(meet){drive.target='_blank';drive.rel='noopener noreferrer';}else{drive.removeAttribute('target');drive.removeAttribute('rel');}
    q('#map-follow').classList.toggle('paused',!following||toiletMapActive||chargerMapActive||fullRouteActive||milestoneMapActive);
    q('#map-all-stops').setAttribute('aria-pressed',String(fullRouteActive));
    putText('#map-follow-label',toiletMapActive||chargerMapActive||fullRouteActive||milestoneMapActive?'Back to meet-up':'Re-centre map');
    const followDescription=toiletMapActive||chargerMapActive||fullRouteActive||milestoneMapActive?'Back to meet-up. Return to runners and the route ahead.':following?'Re-centre map. Automatically following runners and the route ahead.':'Re-centre map and resume following runners and the route ahead.';
    for(const selector of ['#map-follow','#map-recenter']){
      q(selector).setAttribute('aria-label',followDescription);
      q(selector).setAttribute('title',followDescription);
    }
    const missing=people.filter(person=>!isPoint(personPosition(person))).map(person=>{
      const crew=person.feed==='crew',canShare=current.room?.owner||current.room?.canShareLocation;
      const bib=crew?null:runnerBib(person);
      const status=crew?(current.room?.error==='expired'||current.room?.status==='ended'?'Sharing ended':canShare?'Update location':'Awaiting location'):runnerWaitingStatus(person);
      const description=crew?`${person.name} · ${status}. Open location details on this site.`:`${person.name}${bib?' · race '+bib:''} · ${status.toLowerCase()}. Open pace and arrival details.`;
      const contents=`<img src="assets/avatars-v5/${person.id}.webp" alt=""><strong>${person.name}</strong><small>${bib?'<b class="waiting-bib">'+safe(bib)+'</b> · ':''}${safe(status)}</small>`;
      // Unknown positions stay in a fixed status strip, never at a made-up map coordinate.
      return `<button type="button" class="waiting-person" data-person="${person.id}" data-map-person="${person.id}" aria-haspopup="dialog" aria-label="${safe(description)}">${contents}</button>`;
    });
    q('#map-waiting').innerHTML=missing.join('');q('#map-waiting').hidden=!missing.length;
    q('#map-waiting').style.gridTemplateColumns=`repeat(${Math.max(1,missing.length)},minmax(0,1fr))`;
    q('#map-waiting').style.width=`min(calc(100% - 28px),${missing.length*88}px)`;
    if(mapLoadError||tileFailure||!navigator.onLine){q('#map-notice').hidden=false;q('#map-notice').textContent=mapLoadError?'Route could not load. Open the original Google route from the tools.':!navigator.onLine?'Offline · showing the saved route. Live positions need a connection.':'Map background unavailable. Route and reported pins still work.';q('#map-waiting').hidden=true;}
    else if(milestoneMapActive){q('#map-notice').hidden=false;q('#map-notice').innerHTML='<span><strong>Race milestones</strong><small>Tap a flag for ETA & crossing times</small></span><button type="button" data-tab-target="milestones">Moments ›</button>';q('#map-waiting').hidden=true;}
    else if(fullRouteActive){q('#map-notice').hidden=true;q('#map-waiting').hidden=true;}
    else if(chargerMapActive){
      const count=routeChargers().length;
      q('#map-notice').hidden=false;
      q('#map-notice').innerHTML=`<span><strong>${count} charging stops · ${safe(chargerScopeName())}</strong><small>Tap ϟ for access, charging & meet-up options</small></span><button type="button" data-map-action="charger-list">EV list ›</button>`;
      q('#map-waiting').hidden=true;
    }
    else if(toiletMapActive){
      const count=routeToilets().length,summary=count+' pit stops · '+toiletScopeName()+' · '+toiletArrivalName();
      q('#map-notice').hidden=false;q('#map-notice').textContent=summary;
      q('#map-notice').innerHTML=`<span><strong>${safe(count?summary:'No pit stops match these filters')}</strong><small>${safe(toiletOpening==='open'?'Venue open at ETA · check toilet access':toiletOpening==='confirmed'?'Confirmed toilet hours fit arrival':'WC? = café · ask about toilet access')}</small></span><button type="button" data-map-action="toilet-filters">Filters & list ›</button>`;
      q('#map-waiting').hidden=true;
    }
    else q('#map-notice').hidden=true;
    q('#map-notice').classList.toggle('toilet-map-note',(toiletMapActive||chargerMapActive||milestoneMapActive)&&!mapLoadError&&!tileFailure&&navigator.onLine);
    q('#map-notice').classList.toggle('charger-map-note',chargerMapActive);
  }
  function screenBox(selector) {
    const el=q(selector),rect=el?.getBoundingClientRect?.(),mapRect=q('#race-map')?.getBoundingClientRect?.();
    if(!rect?.width||!rect.height||!mapRect)return null;
    return {x:rect.left-mapRect.left,y:rect.top-mapRect.top,w:rect.width,h:rect.height};
  }
  function usableMap() {
    const size=raceMap.getSize(),row=screenBox('.map-follow-row'),summary=screenBox('.map-distance'),dock=screenBox(mode()==='runner'?'.runner-dock':'.supporter-dock');
    const note=toiletMapActive||chargerMapActive||milestoneMapActive?screenBox('#map-notice'):null;
    // The re-centre/all-stops row is now BELOW the map's useful markers.
    // Poster distance cards sit outside the map; the standard summary overlays its top.
    if(posterMode())return {top:12,bottom:Math.min(row?row.y-9:size.y-25,note?note.y-8:Infinity)};
    return {top:summary?summary.y+summary.h+14:254,bottom:Math.min(row?row.y-10:dock?dock.y-12:size.y-(mode()==='runner'?116:142),note?note.y-8:Infinity)};
  }
  function boundsPadding() {
    const size=raceMap.getSize(),{top,bottom}=usableMap();
    // A fitted coordinate needs room for the whole portrait above it, not
    // just its dot. Keep northern avatars below the summary and status row
    // without moving their true position or reversing nearby people.
    const portraitHeadroom=Math.min(posterMode()&&size.y<280?76:94,Math.max(24,(bottom-top)*.45));
    if(posterMode())return {paddingTopLeft:[38,top+portraitHeadroom],paddingBottomRight:[38,size.y-bottom+14],maxZoom:15,animate:false};
    return {paddingTopLeft:[32,top+Math.max(portraitHeadroom,milestoneMapActive?110:0)],paddingBottomRight:[32,size.y-bottom+28],maxZoom:15,animate:false};
  }
  function fit(bounds, options={}) {
    if(!raceMap||!bounds?.isValid())return;moving=true;
    raceMap.fitBounds(bounds,{...boundsPadding(),...options});
    moving=false;updateEdge();
  }
  function follow() {
    milestoneMapActive=false;toiletMapActive=false;chargerMapActive=false;fullRouteActive=false;following=true;pinnedPoint=null;drawSummary();drawRoute();drawPlaces();
    if(frame.length)fit(frameBounds());
  }
  function recenterFromTap() {
    follow();
    if(mapLoadError)notify('Map unavailable right now. Meet-up details are still available.');
    else if(!raceMap||!frame.length)notify('Map loading · automatic following is on');
    else notify(runnerPositions().length?'Map centred · following runners and next meet-up':'Map centred · waiting for runner positions');
  }
  function showNextPoints() { switchTab('now');follow(); }
  function showFullRoute() {
    if(mode()!=='supporter')return;
    milestoneMapActive=false;fullRouteActive=true;toiletMapActive=false;chargerMapActive=false;following=true;pinnedPoint=null;switchTab('now');drawSummary();drawRoute();drawPlaces();
    notify('Whole route · '+allMeetings().length+' meeting options. Zoom for nearby stops; tap a pin for its town and details.');
    if(frame.length)fit(frameBounds());
  }
  function showMilestones(id=null) {
    if(!raceMap)return;
    milestoneMapActive=true;fullRouteActive=false;toiletMapActive=false;chargerMapActive=false;following=false;pinnedPoint=null;
    switchTab('now');drawSummary();drawRoute();drawPlaces();
    const target=visibleMilestones().find(point=>point.id===id);
    if(target&&isPoint(target)){moving=true;raceMap.setView([target.lat,target.lng],12,{animate:false});moving=false;}
    else {const points=[...visibleMilestones(),...runnerPositions(),...supporterPositions()].filter(isPoint).map(point=>[point.lat,point.lng]);if(points.length)fit(L.latLngBounds(points));}
  }
  function milestonePresentation(point) {
    return window.raceMoments?.presentation?.(point,current)||{text:'ETA · waiting for pace',completed:false};
  }
  function milestoneColour(id){return {marathon:'#906092',silver:'#657d91',gold:'#ad7b0c'}[id]||'#906092';}
  function showToiletsAhead() {
    if(!raceMap){openFacilities('toilet');return;}
    milestoneMapActive=false;toiletMapActive=true;chargerMapActive=false;fullRouteActive=false;following=true;pinnedPoint=null;switchTab('now');drawSummary();drawRoute();drawPlaces();
    refreshCrewToiletTravel();
    if(frame.length)fit(frameBounds());
  }
  function everyone() {
    if(!raceMap)return;following=false;pinnedPoint=null;
    // Group views follow the family. Matt is only centred through his explicit map action.
    const points=[...frame];[...runnerPositions(),...supporterPositions(),...mapPlan().points].forEach(p=>{if(isPoint(p))points.push([p.lat,p.lng]);});
    if(points.length)fit(L.latLngBounds(points));drawSummary();
  }
  function showChargers() {
    if(mode()!=='supporter')return;
    if(!raceMap){openFacilities('charger');return;}
    milestoneMapActive=false;chargerMapActive=true;toiletMapActive=false;fullRouteActive=false;following=true;pinnedPoint=null;
    switchTab('now');drawSummary();drawRoute();drawPlaces();
    if(frame.length)fit(frameBounds());
  }
  // No floating “see everyone” shortcut: the map is intentionally uncluttered.
  function updateEdge() {}
  function rivalPortraitHtml(p) {
    const other=rival(),stale=age(p)>=300000,pace=rivalPace(),shortAge=ago(p).replace(' min','m');
    return '<span class="rival-pin '+(compactPortraits()?'compact-rival':'')+'"><img class="rival-cutout" src="assets/avatars-v5/matt.webp" alt=""><strong>'+safe(other.shortName||'Matt')+' <small>210</small></strong><span class="rival-pace">'+safe(pace||'Pace pending')+'</span><small class="person-update">'+safe((stale?'Last · ':'')+shortAge)+'</small><i aria-hidden="true"></i></span>';
  }
  function compactPortraits() {
    if(compactPosterPins())return true;
    if(!raceMap)return false;
    const dots=[...runnerPositions(),...supporterPositions(),rivalMapPosition()].filter(isPoint).map(p=>raceMap.latLngToContainerPoint([p.lat,p.lng]));
    return dots.some((p,i)=>dots.slice(i+1).some(other=>Math.hypot(p.x-other.x,p.y-other.y)<120));
  }
  function portraitHtml(p, person) {
    const crew=person.feed==='crew',stale=!fresh(p),withEmily=crew&&p.viaEmilyTracker;
    const shortAge=ago(p).replace(' min','m').replace(/(\d+h) \d+m ago/,'$1 ago').replace('time unavailable','Unknown');
    const status=withEmily?'Via Emily’s official tracker · '+shortAge:crew&&!p.sharing?'Paused · '+shortAge:stale?'Last · '+shortAge:shortAge;
    const compact=compactPortraits(),tiny=posterMode()&&raceMap?.getSize().y<280,plan=crew?supporterPlanLabel(person.id,true):'';
    return `<div class="person-pin gps-portrait ${crew?'supporters':'runners'} ${stale?'stale':''} ${withEmily?'via-emily-tracker':''} ${compact?'compact-poster-pin':''} ${tiny?'tiny-gps-portrait':''} ${plan?'has-plan':''}" data-person="${person.id}"><img class="person-cutout" src="assets/avatars-v5/${person.id}.webp" alt=""><strong class="person-name">${person.name}</strong>${plan?`<small class="person-plan ${supporterPlan(person.id)}">${safe(plan)}</small>`:''}<small class="person-update"${status!==shortAge?` title="${safe(status)}"`:""}>${safe(withEmily?'Tracker · '+shortAge:shortAge)}</small></div>`;
  }
  function crewPositionDescription(p,person) {
    if(p.viaEmilyTracker)return person.name+'. Walking with Emily. Shown at Emily’s official tracker location, updated '+ago(p)+'. This is an inferred co-location from the shared plan, not '+person.name+'’s own phone GPS. Open location details and sharing controls on this site.';
    const paused=!p.sharing,stale=!fresh(p);
    return person.name+'. '+(supporterPlanLabel(person.id)?supporterPlanLabel(person.id)+'. ':'')+(paused?'Site sharing paused. ':'')+
      (paused||stale?'Last site position reported ':'Site location updated ')+ago(p)+'. '+
      'Open crew location details and sharing controls on this site.';
  }
  function pinSize(html,className,width,minHeight,intrinsicWidth=false) {
    // Measure the actual label, including wrapped custom meeting names.
    // Collision boxes must grow with the large text rather than covering it.
    if(!document.createElement||!document.body)return [width,minHeight];
    const el=document.createElement('div');el.className=className;
    el.style.cssText=`position:fixed;left:-10000px;top:0;width:${intrinsicWidth?'max-content':width+'px'};visibility:hidden;pointer-events:none;`;
    el.innerHTML=html;document.body.appendChild(el);
    const rect=el.getBoundingClientRect();el.remove();
    return [intrinsicWidth&&Number.isFinite(rect.width)?Math.max(width,Math.ceil(rect.width)):width,Math.max(minHeight,Math.ceil(rect.height))];
  }
  function drawPeople() {
    if(!raceMap)return;peopleLayer.clearLayers();placeLayer.clearLayers();
    const size=raceMap.getSize(),{top,bottom}=usableMap();
    const used=[];
    ['#map-waiting','#map-notice'].forEach(selector=>{const box=screenBox(selector);if(box)used.push(box);});
    if(posterMode()){const controls=screenBox('.map-control-stack');if(controls)used.push(controls);}
    // Separate the labels when the crew and meeting flag occupy the same spot.
    // A small dot and leader retain the actual reported coordinate.
    const overlapArea=(a,b)=>Math.max(0,Math.min(a.x+a.w+4,b.x+b.w+4)-Math.max(a.x-4,b.x-4))*Math.max(0,Math.min(a.y+a.h+4,b.y+b.h+4)-Math.max(a.y-4,b.y-4));
    const avatarPoints=[...runnerPositions(),...supporterPositions(),rivalMapPosition()].filter(isPoint).map(p=>raceMap.latLngToContainerPoint([p.lat,p.lng]));
    const candidatesFor=(p,w,h,meeting=false,crew=false,anchored=false)=>{
      const point=raceMap.latLngToContainerPoint([p.lat,p.lng]);
      // Portraits stay next to their own GPS point. The previous global card
      // packing could send a runner farther ahead than the support crew.
      // Nearby offsets are constrained to the point's screen-space region,
      // preserving the order of people along the line between their dots.
      const anchorLimit=milestoneMapActive?260:100,anchorOffsets=milestoneMapActive?[0,-24,24,-48,48,-72,72,-96,96,-120,120,-144,144,-168,168,-192,192,-216,216,-240,240]:[0,-24,24,-48,48,-72,72,-96,96];
      // The whole-route milestone overview fans labels sideways; their
      // vertical baseline and coloured GPS dots keep the route order clear.
      const offsets=anchored?anchorOffsets.flatMap(dx=>(milestoneMapActive?[0]:anchorOffsets).filter(dy=>Math.hypot(dx,dy)<=anchorLimit).map(dy=>[-w/2+dx,-h-8+dy])):meeting?[[20,16],[-w-20,16],[20,-h-18],[-w-20,-h-18],[20,78],[-w-20,78],[92,16],[92,86],[-w/2,125]]:[[-w/2,-h-18],[28,-h-18],[-w-28,-h-18],[-w/2,24],[28,24],[-w-28,24],[60,-h-18],[60,24],[-w/2,-h-110]];
      const onScreen=point.x>=0&&point.x<=size.x&&point.y>=top-70&&point.y<=bottom+50;
      const candidates=[],seen=new Set();
      const consider=(left,upper,order)=>{
        let x=left,y=upper;
        if(onScreen&&!anchored){x=Math.max(9,Math.min(size.x-w-9,x));y=Math.max(top,Math.min(bottom-h,y));}
        if(anchored){
          const centred={x:x+w/2,y:y+h+8};
          if(Math.hypot(centred.x-point.x,centred.y-point.y)>anchorLimit+.01)return;
          // With the common above-dot baseline removed, a portrait may not
          // cross the midpoint toward another person's actual position.
          if(!milestoneMapActive&&avatarPoints.some(other=>{
            const dx=other.x-point.x,dy=other.y-point.y;if(dx*dx+dy*dy<1)return false;
            return (centred.x-(point.x+other.x)/2)*dx+(centred.y-(point.y+other.y)/2)*dy>.01;
          }))return;
        }
        const key=x.toFixed(1)+','+y.toFixed(1);if(seen.has(key))return;seen.add(key);
        const box={x,y,w,h,point,anchored},overflow=anchored&&onScreen?(Math.max(0,9-x)+Math.max(0,x+w-size.x+9))*h+(Math.max(0,top-y)+Math.max(0,y+h-bottom))*w:0,overlap=overflow+used.reduce((sum,b)=>sum+overlapArea(box,b),0);
        const score=order*20+Math.hypot(x+w/2-point.x,y+h/2-point.y);
        candidates.push({...box,score,overlap});
      };
      offsets.forEach(([dx,dy],order)=>{consider(point.x+dx,point.y+dy,order);if(anchored&&onScreen)consider(Math.max(9,Math.min(size.x-w-9,point.x+dx)),Math.max(top,Math.min(bottom-h,point.y+dy)),order+offsets.length);});
      // Very close phone reports can leave a narrow diagonal space between
      // dots. Offer exact sideways offsets as well as the grid, so cutouts can
      // separate without crossing ahead of anyone else's true position.
      if(anchored&&crew&&!milestoneMapActive&&supporterPeople.some(person=>supporterPlanLabel(person.id))){
        const nearby=avatarPoints.map(other=>({dx:other.x-point.x,dy:other.y-point.y})).map(d=>({...d,length:Math.hypot(d.dx,d.dy)})).filter(d=>d.length>=1&&d.length<120).sort((a,b)=>a.length-b.length).slice(0,2);
        for(const other of nearby)for(const shift of [-96,-72,-48,-24,24,48,72,96]){
          const x=point.x-w/2-other.dy/other.length*shift,y=point.y-h-8+other.dx/other.length*shift;
          if(x>=9&&x+w<=size.x-9&&y>=top&&y+h<=bottom)consider(x,y,offsets.length+Math.abs(shift)/24);
        }
      }
      if(onScreen&&!anchored){
        // Include exact edge slots: on a compact phone two large name cards
        // fit across only when both can use the full available width.
        const xs=[9,size.x-w-9],ys=[top,bottom-h];
        for(let x=9;x<=size.x-w-9;x+=18)xs.push(x);
        for(let y=top;y<=bottom-h;y+=18)ys.push(y);
        for(const y of ys)for(const x of xs)consider(x,y,offsets.length);
      }
      return candidates.sort((a,b)=>a.overlap-b.overlap||a.score-b.score);
    };
    const planned=displayedMeetings();
    const overviewTownVisible=p=>{const here=raceMap.latLngToContainerPoint([p.lat,p.lng]);return planned.every(other=>{if(other.id===p.id)return true;const there=raceMap.latLngToContainerPoint([other.lat,other.lng]);return Math.hypot(here.x-there.x,here.y-there.y)>86;});};
    const entries=[...people.map(person=>({key:person.id,p:personPosition(person),person})),{key:'rival',p:rivalMapPosition(),person:{id:'madlis',name:'Matt',feed:'rival'}},...planned.map(p=>({key:'meetup-'+p.id,p}))].filter(({p})=>isPoint(p)).map(({key,p,person})=>{
      const meeting=key.startsWith('meetup-'),crew=person?.feed==='crew',isRival=key==='rival',bib=isRival?'210':person&&!crew&&runnerBib(person),name=isRival?(rival().name||'Matt Leese')+' · #210':meeting?meetingName(p)+' · '+landmarkName(p):crew?person.name+(p.viaEmilyTracker?' · via Emily’s official tracker':' · own phone location'):person.name+(bib?' · race '+bib:'')+' · official tracker';
      const className=isRival?'rival-map-icon'+(age(p)>=300000?' stale':''):meeting?'meeting-map-icon upcoming-meeting'+(toiletMapActive?' toilet-context-meeting':'')+(fullRouteActive?' overview-meeting':'')+(completionLabel(p)?' checkpoint-'+pointStatus(p):''):'portrait-map-icon';
      const gap=Number.isFinite(p.distanceKm)?(p.distanceKm<.15?'Here now':p.distanceKm.toFixed(1)+' km ahead'):Number.isFinite(p.routeKm)?'Route km '+p.routeKm.toFixed(1):'Distance to agree';
      const number=p.optionalMeetup?'EV option':p.pointNumber?'Point '+p.pointNumber:title(p);
      const html=isRival?rivalPortraitHtml(p):meeting?fullRouteActive?`<div class="overview-point-card ${overviewTownVisible(p)?'show-overview-town':''}"><b>${safe(p.pointNumber||'1st')}</b><strong class="overview-town">${safe(townName(p)||landmarkName(p))}</strong>${completionLabel(p)?`<span class="overview-completion" aria-label="${safe(completionLabel(p))}">${completionSymbol(p)}</span>`:''}</div>`:`<div class="next-point-card ${p.sequence==='then'?'then-point':'first-point'}"><div class="point-eyebrow"><b>${toiletMapActive?'MEET-UP':p.sequence==='then'?'THEN':'NEXT'}</b>${toiletMapActive?'':`<span>${safe(number)}</span>`}${p.agreed?'<span class="point-agreed" aria-label="Agreed">✓</span>':''}</div>${townName(p)?`<span class="point-town">${safe(townName(p))}</span>`:''}<strong class="point-place-name">${safe(landmarkName(p))}</strong>${mode()==='supporter'&&!toiletMapActive?`<span class="point-gap">${safe(gap)}</span>`:''}</div>`:portraitHtml(p,person);
      const iconSize=meeting?(fullRouteActive?[36,28]:pinSize(html,className,toiletMapActive?112:148,44)):pinSize(html,className,isRival?84:crew&&supporterPlanLabel(person.id)?82:56,isRival?90:posterMode()&&size.y<280?48:compactPortraits()?64:76);
      const point=raceMap.latLngToContainerPoint([p.lat,p.lng]),fixedOverview=meeting&&fullRouteActive;
      return {key,p,person,meeting,crew,isRival,name,className,html,iconSize,anchored:!meeting,fixedOverview,candidates:fixedOverview?[{x:point.x-18,y:point.y-14,w:36,h:28,point,overlap:0,score:0}]:candidatesFor(p,...iconSize,meeting,crew,!meeting)};
    });
    const milestonePlan=mapPlan();
    for(const p of visibleMilestones().filter(p=>isPoint(p)&&(milestoneMapActive||fullRouteActive||p.routeKm>=Math.max(0,milestonePlan.fromKm-1)&&p.routeKm<=milestonePlan.endKm+2))){
      const presentation=milestonePresentation(p),className='race-milestone-map-icon';
      const html='<span class="race-milestone-pin milestone-'+safe(p.id)+'"><strong><span aria-hidden="true">'+(presentation.completed?'✓':'✦')+'</span> '+safe(p.label)+'</strong><small>'+safe(presentation.text)+'</small></span>';
      const routeDistance=Number.isFinite(p.routeKm)?'approximately '+p.routeKm.toFixed(1)+' km on foot along the planned route':'route distance unavailable';
      const crowDistance=Number.isFinite(p.crowKm)?'approximately '+p.crowKm.toFixed(1)+' km as the crow flies from Meriden':'crow-flight distance unavailable';
      const iconSize=pinSize(html,className,118,45),name=p.label+'. '+routeDistance+'; '+crowDistance+'. '+presentation.text+'. Open crossing estimates and recorded moments.';
      entries.push({key:'race-milestone-'+p.id,p,milestone:true,name,className,html,iconSize,candidates:candidatesFor(p,...iconSize,true)});
    }
    const shownPlaces=placesToShow(),wcOverview=toiletMapActive&&shownPlaces.length>8&&(raceMap.getZoom?.()??10)<12,evOverview=chargerMapActive&&shownPlaces.length>6&&(raceMap.getZoom?.()??10)<13;
    for(const {p,kind} of shownPlaces){
      const k=kinds[kind],extra=mode()==='supporter'?p.kinds.filter(x=>x!==kind).map(x=>kinds[x]?.symbol).filter(Boolean).join(' · '):'';
      const compact=wcOverview||evOverview||compactPosterPins()&&!toiletMapActive&&!chargerMapActive,timing=kind==='toilet'?toiletTiming(p):null,status=timing?.check.status||'unknown';
      const statusLabel=timing?.check.label||p.mapAccessLabel||'Check access';
      const shortStatus=timing?.arrival?({open:'✓ Open at ETA',likely:'~ Likely · check',possible:'? Ask about WC',closed:'× Closed at ETA',tight:'! Timing tight',unknown:timing.arrival.status==='ready'?'? Check hours':'? ETA to check'}[status]):statusLabel;
      const label=kind==='toilet'?`<span class="facility-mini-label facility-route-label ${toiletMapActive?'':'facility-route-name'}"><strong>${safe(p.mapLabel||p.name)}</strong>${toiletMapActive?`<small>${safe(shortStatus)}</small>`:''}</span>`:kind==='charger'&&chargerMapActive?`<span class="facility-mini-label facility-route-label"><strong>${safe(p.charging?.name||p.mapLabel||p.name)}</strong>${p.meetupPointId?'<small>Meet-up option</small>':''}</span>`:extra?`<span class="facility-mini-label">${safe(extra)}</span>`:'';
      const html=`<div class="facility-pin ${kind} ${toiletMapActive?'toilet-ahead-pin wc-'+status:''} ${compact?'compact-poster-pin':''} ${wcOverview?'wc-overview-pin':''}"><span class="facility-symbol"><span>${kind==='toilet'&&p.possibleToilet?'WC?':k.symbol}</span></span>${compact?'':label}${wcOverview?`<span class="wc-state-symbol" aria-hidden="true">${status==='open'?'✓':status==='likely'?'~':status==='closed'?'×':status==='tight'?'!':'?'}</span>`:''}</div>`;
      const className='facility-map-icon'+(toiletMapActive?' toilet-ahead-icon':'')+(chargerMapActive?' charger-route-icon':''),iconSize=pinSize(html,className,compact?45:kind==='toilet'?(toiletMapActive?112:130):chargerMapActive?124:60,compact?44:toiletMapActive?52:60,true);
      const point=raceMap.latLngToContainerPoint([p.lat,p.lng]);
      entries.push({key:'facility-'+p.id,p,kind,facility:true,name:(kind==='charger'?p.charging?.name||p.name:p.name)+(toiletMapActive?' · '+statusLabel:''),className,html,iconSize,fixedOverview:wcOverview||evOverview,candidates:wcOverview||evOverview?[{x:point.x-iconSize[0]/2,y:point.y-iconSize[1],w:iconSize[0],h:iconSize[1],point,overlap:0,score:0}]:candidatesFor(p,...iconSize)});
    }
    // Solve people, meeting and facility labels together. Greedy placement
    // can trap a final label even when a clear arrangement exists nearby.
    const order=entries.filter(entry=>!entry.fixedOverview).sort((a,b)=>Number(b.anchored)-Number(a.anchored)||b.iconSize[0]*b.iconSize[1]-a.iconSize[0]*a.iconSize[1]);
    const chosen=new Map(entries.filter(entry=>entry.fixedOverview).map(entry=>[entry.key,entry.candidates[0]]));let budget=24000;
    const arrange=index=>{
      if(index===order.length)return true;
      const entry=order[index];
      for(const box of entry.candidates){
        if(--budget<0)return false;
        if(box.overlap>.01||[...chosen.values()].some(other=>overlapArea(box,other)>.01))continue;
        chosen.set(entry.key,box);
        if(arrange(index+1))return true;
        chosen.delete(entry.key);
      }
      return false;
    };
    function anchoredArrangement() {
      // Optional map cards can exhaust the full-layout search. Preserve a
      // clear local arrangement of people before packing those cards; fixing
      // portraits one at a time can trap a walking partner beside Emily.
      // The partner may have only three clear slots. Place that constrained
      // portrait first so nearby people can use their more flexible slots.
      const anchored=order.filter(entry=>entry.anchored).map(entry=>({...entry,candidates:entry.candidates.filter(box=>box.overlap<=.01)})).sort((a,b)=>a.candidates.length-b.candidates.length),boxes=new Map();let remaining=8000;
      const place=index=>{
        if(index===anchored.length)return true;
        const entry=anchored[index];
        for(const box of entry.candidates){
          if(--remaining<0)return false;
          if(box.overlap>.01||[...boxes.values()].some(other=>overlapArea(box,other)>.01))continue;
          boxes.set(entry.key,box);
          if(place(index+1))return true;
          boxes.delete(entry.key);
        }
        return false;
      };
      return place(0)?boxes:null;
    }
    function compactArrangement(anchored) {
      if(fullRouteActive||size.x>=440||entries.length>(toiletMapActive?12:8))return null;
      const fixed=new Map(),visible=[];
      // Off-screen people and pins retain a position near their coordinate.
      // Only cards whose coordinate is in the usable map enter the compact grid.
      for(const entry of entries){
        const point=entry.candidates[0]?.point;
        if(!point)return null;
        if(entry.anchored){
          const box=anchored?.get(entry.key)||entry.candidates.find(box=>box.overlap<=.01&&![...fixed.values()].some(other=>overlapArea(box,other)>.01))||entry.candidates[0];
          fixed.set(entry.key,box);continue;
        }
        if(point.x>=0&&point.x<=size.x&&point.y>=top-70&&point.y<=bottom+50){visible.push(entry);continue;}
        const box=entry.candidates.find(box=>box.overlap<=.01&&![...fixed.values()].some(other=>overlapArea(box,other)>.01));
        if(!box)return null;
        fixed.set(entry.key,box);
      }
      const obstacles=[...used,...fixed.values()],gap=8,margin=9;
      const makeBox=(entry,x,y)=>{
        const point=entry.candidates[0].point,[w,h]=entry.iconSize;
        return {x,y,w,h,point,overlap:0,score:Math.hypot(x+w/2-point.x,y+h/2-point.y)};
      };
      const clear=box=>!obstacles.some(other=>overlapArea(box,other)>.01);
      function column(items,x,zoneTop,zoneBottom) {
        if(!items.length)return {boxes:new Map(),score:0};
        const ordered=[...items].sort((a,b)=>a.candidates[0].point.y-b.candidates[0].point.y);
        const totalHeight=ordered.reduce((sum,entry)=>sum+entry.iconSize[1],0)+gap*(ordered.length-1);
        if(totalHeight>zoneBottom-zoneTop)return null;
        const starts=[zoneTop,zoneBottom-totalHeight];let offset=0;
        for(const entry of ordered){starts.push(entry.candidates[0].point.y-entry.iconSize[1]/2-offset);offset+=entry.iconSize[1]+gap;}
        for(const box of obstacles)starts.push(box.y+box.h+gap);
        let best=null;
        for(const start of starts){
          let cursor=Math.max(zoneTop,Math.min(zoneBottom-totalHeight,start)),score=0;
          const boxes=new Map();
          for(const entry of ordered){
            let box=makeBox(entry,x,cursor);
            // A reserved status card or crew arrow may split a column. Step
            // below it while retaining the gap, rather than covering it.
            for(let attempt=0;attempt<=obstacles.length;attempt++){
              const collision=obstacles.find(other=>overlapArea(box,other)>.01);
              if(!collision)break;
              box=makeBox(entry,x,collision.y+collision.h+gap);
            }
            if(box.y+box.h>zoneBottom||!clear(box)){boxes.clear();break;}
            boxes.set(entry.key,box);score+=box.score;cursor=box.y+box.h+gap;
          }
          if(boxes.size===ordered.length&&(!best||score<best.score))best={boxes,score};
        }
        return best;
      }
      function columns(items,zoneTop,zoneBottom) {
        if(!items.length)return {boxes:new Map(),score:0};
        let best=null;
        for(let mask=0;mask<(1<<items.length);mask++){
          const left=items.filter((_,i)=>!(mask&(1<<i))),right=items.filter((_,i)=>mask&(1<<i));
          const leftWidth=Math.max(0,...left.map(entry=>entry.iconSize[0])),rightWidth=Math.max(0,...right.map(entry=>entry.iconSize[0]));
          if(leftWidth+rightWidth+(left.length&&right.length?gap:0)>size.x-margin*2)continue;
          const single=!left.length||!right.length;
          const one=left.length?left:right,width=left.length?leftWidth:rightWidth;
          const xs=single?[margin,(size.x-width)/2,size.x-width-margin]:[margin];
          for(const x of xs){
            const a=column(single?one:left,x,zoneTop,zoneBottom);
            if(!a)continue;
            const b=single?{boxes:new Map(),score:0}:column(right,size.x-rightWidth-margin,zoneTop,zoneBottom);
            if(!b)continue;
            const score=a.score+b.score;
            if(!best||score<best.score)best={boxes:new Map([...a.boxes,...b.boxes]),score};
          }
        }
        if(!best&&items.length>=3){
          // Four separate portraits need three columns on the narrowest
          // screens: two portrait columns beside the meeting-place column.
          // Prune impossible widths/heights before measuring actual slots.
          const groups=[[],[],[]],sorted=[...items].sort((a,b)=>b.iconSize[0]-a.iconSize[0]);
          const pack=index=>{
            const widths=groups.map(group=>Math.max(0,...group.map(entry=>entry.iconSize[0])));
            const occupied=widths.filter(Boolean);
            if(occupied.reduce((sum,w)=>sum+w,0)+gap*(occupied.length-1)>size.x-margin*2)return;
            if(groups.some(group=>group.reduce((sum,entry)=>sum+entry.iconSize[1],0)+gap*Math.max(0,group.length-1)>zoneBottom-zoneTop))return;
            if(index===sorted.length){
              if(occupied.length<3)return;
              const byPosition=[...groups].sort((a,b)=>a.reduce((sum,e)=>sum+e.candidates[0].point.x,0)/a.length-b.reduce((sum,e)=>sum+e.candidates[0].point.x,0)/b.length);
              const totalWidth=occupied.reduce((sum,w)=>sum+w,0)+gap*2;
              for(const ordered of [byPosition,[...byPosition].reverse()]){
                let x=(size.x-totalWidth)/2,score=0;const boxes=new Map();
                for(const group of ordered){
                  const result=column(group,x,zoneTop,zoneBottom);
                  if(!result){boxes.clear();break;}
                  for(const [key,box] of result.boxes)boxes.set(key,box);
                  score+=result.score;x+=Math.max(...group.map(entry=>entry.iconSize[0]))+gap;
                }
                if(boxes.size===items.length&&(!best||score<best.score))best={boxes,score};
              }
              return;
            }
            for(const group of groups){
              const wasEmpty=!group.length;group.push(sorted[index]);pack(index+1);group.pop();
              if(wasEmpty)break; // Empty columns are interchangeable.
            }
          };
          pack(0);
        }
        return best;
      }
      let best=columns(visible,top,bottom);
      // Several short facility labels can share a row. This leaves the two
      // full-width columns for the larger names and meeting descriptions.
      const small=visible.filter(entry=>entry.facility&&entry.iconSize[0]<=130&&entry.iconSize[1]<=70);
      for(let mask=1;mask<(1<<small.length);mask++){
        const row=small.filter((_,i)=>mask&(1<<i)).sort((a,b)=>a.candidates[0].point.x-b.candidates[0].point.x);
        if(row.length<2)continue;
        const rowWidth=row.reduce((sum,entry)=>sum+entry.iconSize[0],0)+gap*(row.length-1),rowHeight=Math.max(...row.map(entry=>entry.iconSize[1]));
        if(rowWidth>size.x-margin*2)continue;
        const rowKeys=new Set(row.map(entry=>entry.key)),rest=visible.filter(entry=>!rowKeys.has(entry.key));
        for(const atTop of [false,true]){
          const rowY=atTop?top:bottom-rowHeight;
          let x=(size.x-rowWidth)/2,rowScore=0;const rowBoxes=new Map();
          for(const entry of row){
            const box=makeBox(entry,x,rowY+(rowHeight-entry.iconSize[1])/2);
            if(!clear(box)){rowBoxes.clear();break;}
            rowBoxes.set(entry.key,box);rowScore+=box.score;x+=box.w+gap;
          }
          if(rowBoxes.size!==row.length)continue;
          const packed=columns(rest,atTop?top+rowHeight+gap:top,atTop?bottom:bottom-rowHeight-gap);
          if(!packed)continue;
          const score=packed.score+rowScore;
          if(!best||score<best.score)best={boxes:new Map([...packed.boxes,...rowBoxes]),score};
        }
      }
      if(!best){
        // Rows provide another compact arrangement for facility labels.
        const rows=[[],[],[]],sorted=[...visible].sort((a,b)=>b.iconSize[1]-a.iconSize[1]);
        const packRows=index=>{
          const filled=rows.filter(row=>row.length),heights=filled.map(row=>Math.max(...row.map(entry=>entry.iconSize[1])));
          const totalHeight=heights.reduce((sum,h)=>sum+h,0)+gap*Math.max(0,filled.length-1);
          if(totalHeight>bottom-top||filled.some(row=>row.reduce((sum,entry)=>sum+entry.iconSize[0],0)+gap*(row.length-1)>size.x-margin*2))return;
          if(index===sorted.length){
            const byPosition=[...filled].sort((a,b)=>a.reduce((sum,e)=>sum+e.candidates[0].point.y,0)/a.length-b.reduce((sum,e)=>sum+e.candidates[0].point.y,0)/b.length);
            for(const ordered of [byPosition,[...byPosition].reverse()])for(const start of [top,bottom-totalHeight]){
              let y=start,score=0;const boxes=new Map();
              for(const row of ordered){
                const width=row.reduce((sum,entry)=>sum+entry.iconSize[0],0)+gap*(row.length-1),height=Math.max(...row.map(entry=>entry.iconSize[1]));
                let x=(size.x-width)/2;
                for(const entry of [...row].sort((a,b)=>a.candidates[0].point.x-b.candidates[0].point.x)){
                  const box=makeBox(entry,x,y+(height-entry.iconSize[1])/2);
                  if(!clear(box)){boxes.clear();break;}
                  boxes.set(entry.key,box);score+=box.score;x+=box.w+gap;
                }
                if(boxes.size===0)break;
                y+=height+gap;
              }
              if(boxes.size===visible.length&&(!best||score<best.score))best={boxes,score};
            }
            return;
          }
          for(const row of rows){const empty=!row.length;row.push(sorted[index]);packRows(index+1);row.pop();if(empty)break;}
        };
        packRows(0);
      }
      return best?new Map([...fixed,...best.boxes]):null;
    }
    if(!arrange(0)){
      chosen.clear();
      for(const entry of entries.filter(entry=>entry.fixedOverview))chosen.set(entry.key,entry.candidates[0]);
      const anchored=anchoredArrangement(),packed=compactArrangement(anchored);
      if(packed)for(const [key,box] of packed)chosen.set(key,box);
      else {
        // If the space physically cannot contain every card, retain the
        // least obstructed arrangement and the actual coordinate dots.
        if(anchored)for(const [key,box] of anchored)chosen.set(key,box);
        for(const entry of order){
          if(chosen.has(entry.key))continue;
          let best;
          for(const box of entry.candidates){
            const overlap=box.overlap+[...chosen.values()].reduce((sum,b)=>sum+overlapArea(box,b),0);
            if(!best||overlap<best.overlap-.01||(Math.abs(overlap-best.overlap)<.01&&box.score<best.score))best={...box,overlap};
          }
          chosen.set(entry.key,best);
        }
      }
    }
    const drawnDots=new Set();
    for(const {key,p,person,meeting,crew,isRival,facility,milestone,kind,name,className,html,iconSize} of entries){
      const box=chosen.get(key),anchor=[box.point.x-box.x,box.point.y-box.y],colour=isRival?'#795291':milestone?milestoneColour(p.id):facility?({toilet:'#8554a1',parking:'#327db4',charger:'#498447',cafe:'#af7516'}[kind]):meeting?'#086d63':crew?'#e87c6c':'#e88e1c';
      const layer=facility||milestone?placeLayer:peopleLayer;
      const edge=[Math.max(box.x,Math.min(box.x+box.w,box.point.x)),Math.max(box.y,Math.min(box.y+box.h,box.point.y))];
      L.polyline([[p.lat,p.lng],raceMap.containerPointToLatLng(edge)],{color:colour,weight:person||crew?2.5:2,opacity:person||crew?1:.8,...(!(person||crew)?{dashArray:'3 4'}:{}),interactive:false}).addTo(layer);
      const dotKey=(p.viaEmilyTracker?'official-emily':person?.id==='emily'?'official-emily':person?.feed||key)+':'+p.lat+','+p.lng;
      if(!drawnDots.has(dotKey)){L.circleMarker([p.lat,p.lng],{radius:5,weight:2.5,color:colour,fillColor:'#fffdf4',fillOpacity:1,interactive:false}).addTo(layer);drawnDots.add(dotKey);}
      const icon=L.divIcon({className,iconSize,iconAnchor:anchor,html});
      const description=milestone?name:crew?crewPositionDescription(p,person):name+(facility?' · '+p.kinds.map(k=>kinds[k].label).join(', ')+(kind==='toilet'?'. '+(p.mapAccessLabel||'Check hours and access')+'. Open toilet details.':''):meeting?(completionLabel(p)?' · '+completionLabel(p):p.agreed?' · agreed meet-up':mode()==='runner'?' · next meet-up':' · planned option'):' · '+ago(p)+'. Open pace and arrival details.');
      // A focus-driven pan redraws offset cutouts between pointer-down and
      // click, which can open a neighbouring person instead of the tapped one.
      const marker=L.marker([p.lat,p.lng],{icon,zIndexOffset:facility?250:meeting?500:600,title:description,keyboard:true,autoPanOnFocus:false}).addTo(layer).on('click',event=>{
        if(milestone)window.raceMoments?.open?.(p.id);else if(facility)openFacilities(kind,p.id);else if(meeting)openPoint(p);
        else openPerson(person.id);
      });
      if(person||crew||milestone){marker.getElement?.()?.setAttribute('aria-label',description);marker.getElement?.()?.setAttribute('aria-haspopup','dialog');}
    }
    updateEdge();
  }
  function drawCompetitors(){
    if(!raceMap||!rivalLayer||!window.L)return;
    rivalLayer.clearLayers();
    const guide=window.competitorGuide,snapshot=guide?.getSnapshot?.();
    if(!snapshot||snapshot.status==='wrong-event')return;
    const candidates=new Map();
    // The map is for the family's chosen competitors only. Never auto-render
    // the whole category, including if an older phone saved that preference.
    for(const p of snapshot.followed||[]){
      if(p?.bib!=='247'&&snapshot.preferences?.followed?.[p.bib]===true)candidates.set(p.bib,p);
    }
    for(const p of candidates.values()){
      // A chosen family follow must not vanish merely because the GPS goes
      // quiet (Matt #210 stopped reporting at 16:49). Show a faded, clearly
      // dated LAST-KNOWN position; never pass it to routing or arrival ETA.
      if(!isPoint(p))continue;
      const fresh=guide?.isFresh?.(p)===true;
      const kind=guide.mapCrowMarker?.(p)||{type:'other',label:'Competitor',html:'<span>#'+safe(p.bib)+'</span>'};
      const icon=L.divIcon({className:'race-competitor-pin crow-pin-'+kind.type,html:kind.html,iconSize:[54,63],iconAnchor:[27,55]});
      const currentPace=fresh?guide?.paceText?.(p):'';
      const titleText=(p.name||'Competitor')+' · #'+p.bib+' · '+kind.label+' · '+(Number.isFinite(p.crowKm)?p.crowKm.toFixed(1)+' km crow flight':'distance pending')+(currentPace?' · '+currentPace+' recent moving GPS':'')+' · '+(fresh?'report '+ago(p):'LAST KNOWN position '+ago(p)+'; may have moved');
      const marker=L.marker([p.lat,p.lng],{icon,zIndexOffset:125,title:titleText,keyboard:true,autoPanOnFocus:false}).addTo(rivalLayer).on('click',()=>guide.open?.(p.bib));
      marker.getElement?.()?.setAttribute('aria-label',titleText);
    }
  }
  function drawRoute() {
    if(!raceMap||!geometry.length)return;routeLayer.clearLayers();
    const total=cumulative[cumulative.length-1], plan=mapPlan(), contextOnly=hasRunnerFeeds()&&!Number.isFinite(progress());
    const km=milestoneMapActive||fullRouteActive||chargerMapActive&&chargerScope==='all'?0:Math.max(0,Math.min(total,toiletMapActive||chargerMapActive?baseKm():contextOnly?Math.max(baseKm(),plan.fromKm):plan.fromKm)), end=Math.min(total,milestoneMapActive||fullRouteActive||chargerMapActive?(planData().planningEndKm??total):toiletMapActive?toiletWindowEnd():Math.max(plan.endKm,km+10));
    frame=slice(km,end);
    // Radial award boundaries are separate from route-distance goals.
    for(const milestone of milestones){if(milestone.radiusKm&&L.circle)L.circle([milestone.origin.lat,milestone.origin.lng],{radius:milestone.radiusKm*1000,color:milestoneColour(milestone.id),weight:2,opacity:.65,fill:false,dashArray:'7 8',interactive:false}).addTo(routeLayer);}
    // Keep the planned line visible when the crew pans to a meeting place.
    L.polyline(geometry.map(p=>[p[1],p[0]]),{color:'#55998b',weight:4,opacity:.7,interactive:false}).addTo(routeLayer);
    const past=slice(Math.max(0,km-2),km), future=slice(end,Math.min(total,end+2));
    if(past.length>1)L.polyline(past,{color:'#9daba5',weight:5,opacity:.8,interactive:false}).addTo(routeLayer);
    if(future.length>1)L.polyline(future,{color:'#8fa79a',weight:3,opacity:.5,dashArray:'5 7',interactive:false}).addTo(routeLayer);
    L.polyline(frame,{color:'#fffdf3',weight:10,opacity:1,interactive:false}).addTo(routeLayer);
    L.polyline(frame,{color:'#078c7d',weight:6,opacity:1,interactive:false}).addTo(routeLayer);
    if(!runnerPositions().length&&data?.start){const icon=L.divIcon({className:'',iconSize:[145,36],iconAnchor:[0,18],html:'<span class="route-start-pin">Meriden · start</span>'});L.marker([data.start.lat,data.start.lng],{icon,interactive:false}).addTo(routeLayer);}
    for(let at=km+1.5;at<end;at+=2.6){const a=kmAtPoint(at),b=kmAtPoint(Math.min(at+.05,total));if(!a||!b)continue;const az=Math.atan2((b[1]-a[1])*Math.cos(a[0]*Math.PI/180),b[0]-a[0])*180/Math.PI;L.marker(a,{interactive:false,icon:L.divIcon({className:'route-arrow-icon',html:`<span style="display:block;transform:rotate(${az}deg)">↑</span>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(routeLayer);}
  }
  function nearby(kind, ref=reference(kind==='toilet'), radius=3) {
    return pois.filter(p=>p.kinds.includes(kind)&&isPoint(p)).map(p=>({...p,proximity:distance(ref,p)})).filter(p=>p.proximity<=radius).sort((a,b)=>a.proximity-b.proximity);
  }
  function routeChargers() {
    if(mode()!=='supporter')return [];
    const start=chargerScope==='all'?0:Math.max(0,baseKm()-.25,(mapPlan().fromKm||0)-.25),end=planData().planningEndKm??cumulative.at(-1)??0;
    return pois.filter(p=>p.kinds.includes('charger')&&isPoint(p)&&Number.isFinite(p.routeKm)&&p.routeKm>=start&&p.routeKm<=end&&!p.beyondPlannedEndpoint&&(!chargerMeetupsOnly||Boolean(p.meetupPointId))&&(chargerScope==='all'||!chargerMeetupAdded(window.supportGuide?.getPoint?.(p.meetupPointId))||!completionLabel({id:p.meetupPointId})))
      .sort((a,b)=>a.routeKm-b.routeKm||a.name.localeCompare(b.name));
  }
  function setChargerFilters(options={}) {
    if(mode()!=='supporter')return;
    if(['remaining','all'].includes(options.scope))chargerScope=options.scope;
    if(typeof options.meetupsOnly==='boolean')chargerMeetupsOnly=options.meetupsOnly;
    highlightedToilet=null;
    if(typeof currentTab!=='undefined'&&currentTab==='facilities'&&activeFilter==='charger')renderFacilities();
    if(chargerMapActive){drawSummary();drawRoute();drawPlaces();if(following&&frame.length)fit(frameBounds());}
  }
  function renderChargerControls() {
    const holder=q('#charger-filters');if(!holder)return;
    holder.hidden=activeFilter!=='charger'||mode()!=='supporter';
    const scope=q('#charger-scope');if(scope)scope.value=chargerScope;
    const only=q('#charger-meetups-only');if(only)only.checked=chargerMeetupsOnly;
  }
  function chargerCard(p) {
    const charging=p.charging||{},point=p.meetupPointId?window.supportGuide?.getPoint?.(p.meetupPointId):null;
    const agreed=point&&selected()?.id===point.id,added=chargerMeetupAdded(point),done=point?completionLabel(point):'',forecast=meetingForecast(p);
    const past=Number.isFinite(progress()??manualKm())&&p.routeKm<baseKm()-.25;
    const gap=Number.isFinite(progress()??manualKm())?(past?(baseKm()-p.routeKm).toFixed(1)+' km behind':Math.max(0,p.routeKm-baseKm()).toFixed(1)+' km ahead'):'Route km '+p.routeKm.toFixed(1);
    const offset=Number.isFinite(p.routeOffsetM)?Math.round(p.routeOffsetM)+' m from route':'Route offset to check';
    const eta=forecast?.status==='ready'?`<span class="charger-runner-eta">Emily · ETA ${safe(forecastRange(forecast))}</span>`:'';
    const canChoose=mode()==='supporter'&&(!current.room?.joined||current.room.owner||canManageCheckpoints());
    const saved=point?.optionalMeetup&&added&&!agreed?'<p class="charger-added">✓ Added to meet-ups</p>':'';
    const disabled=current.checkpointActionBusy?'disabled':'';
    const meetingAction=point?agreed?`<button class="button primary full" data-map-point-id="${safe(point.id)}">✓ Our agreed meet-up</button>`:done?`<p class="charger-meeting-state">${added?completionSymbol(point)+' '+safe(done)+' · this meet-up':'This meeting group is already completed'}</p>`:past?'<p class="charger-meeting-state">Behind the latest runner report</p>':canChoose?added?`<button class="button primary full" data-support-action="choose" data-point-id="${safe(point.id)}" ${disabled}>ϟ Meet here next</button>`:`<button class="button primary full" data-support-action="add-ev" data-point-id="${safe(point.id)}" ${disabled}>＋ Add to meet-ups</button>`:`<button class="button secondary full" data-live-action="location-controls">Connect supporter phone to ${added?'choose':'add'}</button>`:`<p class="charger-meeting-state">${safe(charging.meetingNote||'Charging detour · keep the agreed runner meet-up')}</p>`;
    const remove=point?.optionalMeetup&&added&&!agreed&&canChoose?`<button class="button secondary full charger-remove" data-support-action="remove-ev" data-point-id="${safe(point.id)}" ${disabled}>Remove from meet-ups</button>`:'';
    const preferred=charging.preferredStop&&!past&&!done;
    const operatorUrl=typeof charging.operatorUrl==='string'&&/^https:\/\//.test(charging.operatorUrl)?charging.operatorUrl:null;
    return `<article class="paper-card facility-card charger-card ${preferred?'preferred-charger':''}" id="facility-${safe(p.id)}"><div class="charger-kicker"><span>ϟ ${safe(p.town||'EV charging')}</span><span>${safe(gap)}</span></div>${preferred?'<span class="charger-pick">Your Daventry charging choice ♡</span>':''}<h2>${safe(charging.name||p.mapLabel||p.name)}</h2><p class="charger-spec">${safe(charging.connectorSummary||'Connector / power: check operator')}</p><p class="charger-hours"><strong>${safe(charging.accessHours||p.hoursLabel||p.hours||'Access hours to check')}</strong></p><div class="charger-route-info"><span>${safe(offset)} · straight line</span>${eta}</div>${charging.availabilityCaution?'<p class="charger-check">Check working sockets before relying on this stop.</p>':''}${saved}${meetingAction}<div class="charger-actions"><button class="button secondary" data-focus-poi="${safe(p.id)}">Map pin</button><a class="button secondary" href="${directions(p,'driving')}" target="_blank" rel="noopener noreferrer">Drive here ↗</a></div><details class="details-card charger-details"><summary>Access, operator & sources</summary><p>${safe(charging.accessNote||p.access)}</p><p>${safe(p.address)}</p><p class="small muted">${safe(p.coordinateNote)} Route offsets are straight-line distances, not walking routes. Check the signed entrance.</p>${operatorUrl?`<a class="toilet-source" href="${safe(operatorUrl)}" target="_blank" rel="noopener noreferrer">Check operator / live bays ↗</a>`:''}<p class="small muted">Checked ${safe(charging.checkedOn||p.checkedOn||'2026-11-14')}. Connector power is a listed maximum, not a promised charge rate. Bay availability is not live on this map.</p>${remove}${(charging.sources||p.sources||[]).map(s=>`<a class="toilet-source" href="${safe(s.url)}" target="_blank" rel="noopener noreferrer">${safe(s.label)} ↗</a>`).join('')}</details></article>`;
  }
  function toiletCandidates({scope=toiletScope,offset=toiletOffsetLimit()}={}) {
    const km=baseKm(),end=Math.min(toiletPlanEnd(),scope==='20'?km+20:Infinity);
    return pois.filter(p=>(p.kinds.includes('toilet')||p.possibleToilet===true)&&isPoint(p)&&Number.isFinite(p.routeKm)&&p.routeKm>=km-.25&&p.routeKm<=end&&Number.isFinite(p.routeOffsetM)&&p.routeOffsetM<=offset).sort((a,b)=>a.routeKm-b.routeKm);
  }
  function toiletTiming(p,audience=toiletAudience()) {
    const now=Date.now();
    const arrival=audience==='crew'?window.crewTravel?.estimate?.({poi:p,snapshot:current,now}):window.toiletHours?.runnerArrival?.({poi:p,snapshot:current,now});
    const check=window.toiletHours?.evaluate?.({poi:p,arrival,now})||{status:'unknown',label:p.mapAccessLabel||'Hours / ETA to check',detail:'Opening-time estimates are still loading.'};
    return {arrival,check};
  }
  function routeToilets() {
    return toiletCandidates().filter(p=>{
      if(toiletOpening==='all')return true;
      const {check}=toiletTiming(p);
      return check.status==='open'||toiletOpening==='open'&&['likely','possible'].includes(check.status);
    });
  }
  function refreshCrewToiletTravel() {
    if(toiletAudience()!=='crew'||document.hidden||!window.crewTravel?.refresh)return;
    if(!toiletMapActive&&!(typeof currentTab!=='undefined'&&currentTab==='facilities'&&activeFilter==='toilet'))return;
    window.crewTravel.refresh({pois:toiletCandidates({scope:'remaining',offset:3000}),snapshot:current}).catch?.(()=>{});
  }
  function setToiletFilters(options={}) {
    if(['remaining','20'].includes(options.scope))toiletScope=options.scope;
    if(['runner','crew'].includes(options.arrival))toiletArrival=options.arrival;
    if(['all','open','confirmed'].includes(options.opening))toiletOpening=options.opening;
    if(typeof options.wide==='boolean')toiletWide=options.wide;
    highlightedToilet=null;
    renderToiletControls();refreshCrewToiletTravel();
    if(typeof currentTab!=='undefined'&&currentTab==='facilities'&&activeFilter==='toilet')renderFacilities();
    if(toiletMapActive){drawSummary();drawRoute();drawPlaces();if(following&&frame.length)fit(frameBounds());}
  }
  function renderToiletControls() {
    const section=q('#toilet-filters');if(!section)return;
    const kindFilters=q('#facility-filters');if(kindFilters)kindFilters.hidden=activeFilter==='toilet';
    section.hidden=activeFilter!=='toilet';
    for(const [selector,value] of [['#toilet-scope',toiletScope],['#toilet-opening',toiletOpening],['#toilet-arrival',toiletAudience()]]){const el=q(selector);if(el&&el.value!==value)el.value=value;}
    const wide=q('#toilet-wide');if(wide)wide.checked=toiletOffsetLimit()>800;
    putText('#toilet-time-note',toiletAudience()==='crew'?'Driving if '+(toiletDriver()?.name||'the meet-up crew')+' leaves now, from their latest phone position, plus up to 5 minutes for parking / walking. No live traffic.':'Arrival uses Emily’s route pace and slowdown estimate. Off-route walking access is approximate.');
    putText('#toilet-arrival option[value="crew"]',(toiletDriver()?.name||'Meet-up crew')+' · driving now');
    const routing=q('#toilet-routing-note');if(routing)routing.hidden=toiletAudience()!=='crew';
  }
  function toiletCard(p) {
    const {arrival,check}=toiletTiming(p),travel=toiletAudience()==='crew'?'driving':'walking';
    const phone=typeof p.phone==='string'&&/^\+?[\d ()-]{7,22}$/.test(p.phone)?p.phone.replace(/[ ()-]/g,''):null;
    const clock=arrival?.status==='ready'?(travel==='driving'?'~'+(arrival.formattedTime||'time pending'):forecastRange(arrival)):arrival?.status==='passed'?'Passed':'ETA unavailable';
    const offset=Math.round(p.routeOffsetM||0),ahead=Number.isFinite(progress()??manualKm())?Math.max(0,p.routeKm-baseKm()).toFixed(1)+' km ahead':'Route km '+p.routeKm.toFixed(1);
    return `<article class="paper-card facility-card toilet-card" id="facility-${safe(p.id)}"><div class="toilet-card-kicker"><span>${p.possibleToilet?'WC? · Ask staff':'WC'}${p.town?' · '+safe(p.town):''}</span><span>${safe(ahead)}</span></div><h2>${safe(p.name)}</h2>${p.beyondPlannedEndpoint?'<p class="small">Detour beyond the planned finish</p>':''}<div class="toilet-arrival-line"><div><small>${safe(toiletArrivalName())}</small><strong>${safe(clock)}</strong>${arrival?.status==='ready'&&arrival.rangeText&&travel==='driving'?`<small>${safe(arrival.rangeText)}</small>`:''}</div><span class="toilet-status status-${safe(check.status)}">${safe(check.label)}</span></div><p class="toilet-check-detail">${safe(arrival?.status==='ready'?check.detail:arrival?.note||check.detail)}</p><div class="toilet-card-actions"><button class="button primary" data-focus-poi="${safe(p.id)}">Show on map</button>${phone?`<a class="button secondary" href="tel:${safe(phone)}">Call</a>`:''}</div><details class="details-card toilet-access"><summary>Hours, access & directions</summary><p><strong>${safe(p.hoursLabel||p.hours||'Hours not verified')}</strong></p><p>${safe(p.access)}</p><p>${offset} m from route in a straight line; check walking access.</p>${arrival?.note?`<p class="small muted">${safe(arrival.note)}</p>`:''}<a class="button secondary" href="${directions(p,travel)}" target="_blank" rel="noopener noreferrer">${travel==='walking'?'Walking directions':'Drive here'} ↗</a><p>${safe(p.address)}</p><p class="small muted">${safe(p.coordinateNote)} Regular advertised hours, not live availability. Checked ${safe(p.checkedOn||'2026-11-14')}.</p>${(p.sources||[]).map(s=>`<a class="toilet-source" href="${safe(s.url)}" target="_blank" rel="noopener noreferrer">${safe(s.label)} ↗</a>`).join('')}</details></article>`;
  }
  function placesToShow() {
    if(fullRouteActive||milestoneMapActive)return [];
    if(chargerMapActive)return routeChargers().map(p=>({p,kind:'charger'}));
    const seen=new Set(), result=[];
    if(toiletMapActive){
      const sites=new Map();
      for(const p of routeToilets()){
        const site=p.toiletSiteId||p.id,existing=sites.get(site);
        if(!existing||existing.possibleToilet&&!p.possibleToilet)sites.set(site,p);
      }
      return [...sites.values()].map(p=>({p,kind:'toilet'}));
    }
    const candidates=toiletCandidates({scope:'20',offset:800}).map(p=>({p,check:toiletTiming(p,mode()==='supporter'?'crew':'runner').check})).filter(({check})=>check.status!=='closed');
    const confirmed=candidates.filter(({check})=>['open','likely'].includes(check.status));
    const wc=(confirmed[0]||candidates.find(({p})=>!p.daytimeOnly))?.p;if(wc){result.push({p:wc,kind:'toilet'});seen.add(wc.id);}
    if(mode()==='runner')return result;
    const ref=reference();
    for(const kind of ['parking','charger','cafe']){const candidates=nearby(kind,ref,2);const p=candidates[0];if(p&&!seen.has(p.id)){result.push({p,kind});seen.add(p.id);}}
    return result;
  }
  function drawPlaces() {
    drawPeople();
    drawCompetitors();
  }
  function placeCard(p, ref) {
    const prox=distance(ref,p), travel=mode()==='runner'?'walking':'driving';
    const from=mode()==='runner'&&isPoint(raceRunner())?'their last position':isPoint(pinnedPoint)?'the selected map pin':isPoint(nextMeeting())?'this meeting place':isPoint(raceRunner())?'their last position':'Meriden start';
    const routeInfo=p.kinds.includes('toilet')&&Number.isFinite(p.routeKm)?`<p class="facility-distance">Approx. route km ${p.routeKm.toFixed(1)}${Number.isFinite(progress()??manualKm())?' · '+Math.max(0,p.routeKm-baseKm()).toFixed(1)+' km ahead':''}${Number.isFinite(p.routeOffsetM)?'<br>'+Math.round(p.routeOffsetM)+' m from route in a straight line; check walking access.':''}</p>`:'';
    const phone=typeof p.phone==='string'&&/^\+?[\d ()-]{7,22}$/.test(p.phone)?p.phone.replace(/[ ()-]/g,''):null;
    return `<article class="paper-card facility-card" id="facility-${safe(p.id)}"><div class="facility-kinds">${p.kinds.filter(k=>mode()!=='runner'||k==='toilet').map(k=>`<span>${kinds[k].symbol} ${kinds[k].label}</span>`).join('')}</div><h2>${safe(p.name)}</h2>${routeInfo}<p class="facility-distance">${prox.toFixed(1)} km straight-line from ${from}</p><p><strong>${safe(p.hoursLabel||p.hours)}</strong></p><p>${safe(p.access)}</p><div class="inline-actions">${phone?`<a class="button primary" href="tel:${safe(phone)}">Call to check access</a>`:''}<a class="button ${phone?'secondary':'primary'}" href="${directions(p,travel)}" target="_blank" rel="noopener noreferrer">${travel==='walking'?'Walking directions':'Drive here'} ↗</a><button class="button secondary" data-focus-poi="${safe(p.id)}">Map pin</button></div><details class="details-card"><summary>Address & checked sources</summary><p>${safe(p.address)}</p><p>${safe(p.coordinateNote)}</p><p>Regular advertised hours, not live availability. Checked ${safe(p.checkedOn||'2026-11-13')}.</p>${(p.sources||[]).map(s=>`<a href="${safe(s.url)}" target="_blank" rel="noopener noreferrer">${safe(s.label)} ↗</a>`).join('')}</details></article>`;
  }
  function renderFacilities() {
    const filter=activeFilter,ref=reference(filter==='toilet');
    const list=q('#facilities-list'),panel=q('#panel-facilities'),scrollTop=panel?.scrollTop||0;
    const openIds=[...(list?.querySelectorAll?.('.toilet-access[open],.charger-details[open]')||[])].map(el=>el.closest('article')?.id);
    putText('#facilities-title',filter==='toilet'?'Little pit stops':filter==='charger'?'Charge & cheer':filter==='all'?'Around our meet-up':kinds[filter]?.label||'Nearby places');
    const spot=nextMeeting();putText('#facilities-context',filter==='toilet'?'Toilets & cafés along the route. WC? means ask staff. ♡':filter==='charger'?'Pick a charging stop for your crew. ♡':(spot?'Near '+title(spot)+'. ':'Near the start while we wait for positions. ')+'Check access and hours before relying on a stop.');
    renderToiletControls();renderChargerControls();
    document.querySelectorAll('[data-facility-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.facilityFilter===filter)));
    let items=pois.filter(p=>(filter==='all'||p.kinds.includes(filter)||filter==='toilet'&&p.possibleToilet)&&isPoint(p)).map(p=>({...p,proximity:distance(ref,p)})).sort((a,b)=>a.proximity-b.proximity);
    let visible=filter==='toilet'?routeToilets():filter==='charger'?routeChargers():items.filter(p=>p.proximity<=3).slice(0,6);
    if(filter==='charger'){
      const daventry=visible.find(p=>p.charging?.preferredStop&&p.routeKm>=baseKm()-.25&&!completionLabel(window.supportGuide?.getPoint?.(p.meetupPointId)));
      if(daventry)visible=[daventry,...visible.filter(p=>p.id!==daventry.id)];
    }
    if(highlightedToilet){const highlighted=items.find(p=>p.id===highlightedToilet);if(highlighted)visible=[highlighted,...visible.filter(p=>p.id!==highlightedToilet)];}
    let prefix=filter==='toilet'?`<button class="button primary full toilet-map-button" data-map-action="toilets">Show ${routeToilets().length} pit stops on map →</button><p class="toilet-results-note">${safe(toiletScopeName())} · ${safe(toiletArrivalName())}${highlightedToilet&&!routeToilets().some(p=>p.id===highlightedToilet)?' · selected stop shown separately':''}</p>`:filter==='charger'?`<button class="button primary full toilet-map-button" data-map-action="chargers">Show ${routeChargers().length} charging stops on map →</button><p class="toilet-results-note">${safe(chargerScopeName())} · ${chargerMeetupsOnly?'Suitable for meet-ups':'On-route stops & short detours'}</p>`:'';
    if(!visible.length){
      if(filter==='toilet')prefix+=`<div class="paper-card facility-empty"><img src="assets/crow.svg" alt=""><h2>${toiletOpening==='all'?'No checked stops in this stretch':'No stops match yet'}</h2><p>${toiletOpening==='all'?'Try the rest of the route or include farther detours.':'The opening filter needs a usable ETA and checked hours. Unknown access is never marked open.'}</p><button class="button secondary full" data-map-action="toilet-reset">Show all checked options</button></div>`;
      else if(filter==='charger')prefix+='<div class="paper-card facility-empty"><h2>No checked chargers in this selection</h2><p>Choose the whole route or include charging detours.</p></div>';
      else{const phrase=filter==='all'?'facilities':kinds[filter].label.toLowerCase();prefix+=`<div class="paper-card facility-empty"><h2>No checked ${safe(phrase)} within 3 km</h2><p>Check the next meet-up or another place on the route.</p></div>`;}
    }
    list.innerHTML=prefix+visible.map(p=>filter==='toilet'?toiletCard(p):filter==='charger'?chargerCard(p):placeCard(p,ref)).join('');
    for(const id of openIds){const el=document.getElementById?.(id)?.querySelector('.toilet-access,.charger-details');if(el)el.open=true;}
    if(panel)panel.scrollTop=scrollTop;
  }
  function openFacilities(filter='toilet', highlightedId=null) {
    if(mode()==='runner')filter='toilet';activeFilter=filter;highlightedToilet=highlightedId;
    renderFacilities();
    switchTab('facilities');
    if(filter==='toilet')refreshCrewToiletTravel();
  }
  function crewPlanSummary() {
    const names=mode=>supporterPeople.filter(p=>supporterPlan(p.id)===mode).map(p=>p.name).join(', ');
    const walking=names('walking'),meeting=names('meeting');
    return walking||meeting?'<div class="point-crew-plan">'+(walking?'<p><strong>Walking with Emily</strong> '+safe(walking)+'</p>':'')+(meeting?'<p><strong>Meeting at the next stop</strong> '+safe(meeting)+'</p>':'')+'</div>':'';
  }
  function openPoint(pointOrId) {
    const plan=mapPlan();
    const p=mode()==='runner'?plan.points[0]:typeof pointOrId==='string'?(plan.points.find(p=>p.id===pointOrId)||window.supportGuide?.getPoint?.(pointOrId)):pointOrId;
    if(!p){showNextPoints();return;}
    pointDetail=p;
    const entry=plan.points.find(x=>x.id===p.id)||p;
    const km=progress()??manualKm(), gap=Number.isFinite(km)&&Number.isFinite(p.routeKm)?Math.max(0,p.routeKm-km):null;
    const pointData=planData(), available=pointData.points||[], alternatives=mode()==='runner'?[]:entry.alternatives||available.filter(x=>x.id!==p.id&&p.groupNumber&&x.groupNumber===p.groupNumber&&!['met','skipped'].includes(pointData.statuses?.[x.id]?.status||pointData.statuses?.[x.id]));
    const edit=mode()==='supporter'&&(!current.room?.joined||current.room.owner||canManageCheckpoints());
    const landmark=p.landmark||{}, links=landmark.sources||[];
    arrivalDetailPoint=plan.points[0]?.id===p.id?p:null;
    const arrival=arrivalDetailPoint?`<section id="point-arrival" class="point-arrival" aria-label="Runner arrival estimates">${arrivalDetail(p)}</section>`:forecastDetail(p);
    const after=plan.points[0]?.id===p.id?followingMeeting():null;
    const then=after?`<div class="point-then"><span>AFTER THIS STOP</span><strong>${safe(meetingName(after))}</strong><p>${safe(landmarkName(after))}${Number.isFinite(after.routeKm)&&Number.isFinite(p.routeKm)?' · '+(after.routeKm-p.routeKm).toFixed(1)+' km further':''}</p></div>`:'';
    putText('#point-heading',meetingName(p));
    q('#point-detail').innerHTML=`<article class="point-detail-card"><p class="card-kicker">${entry.agreed?'OUR AGREED MEET-UP':mode()==='runner'?'NEXT MEET-UP':'MEETING OPTION'}${townName(p)?' · '+safe(townName(p)):''}</p><h2>${safe(landmarkName(p))}</h2><div id="checkpoint-controls">${checkpointControls(p)}</div>${landmark.nearbyLabel?`<p class="point-landmark">${safe(landmark.nearbyLabel)}</p>`:''}<p class="point-detail-distance">${gap!==null?`<strong>${gap.toFixed(1)} km</strong> ahead · ${fresh(raceRunner())?'approx. route distance':raceRunner()?'last estimate':'manual estimate'}`:Number.isFinite(p.routeKm)?`At approx. route km <strong>${p.routeKm.toFixed(1)}</strong>`:'Distance to agree'}</p>${meetingDistanceCards(p)}${arrival}${then}${entry.agreed?crewPlanSummary():''}<p class="point-location-note">${safe(landmark.meetingNote||p.detail||'Agree the exact meeting spot together.')}</p><div class="point-detail-actions">${edit&&!entry.agreed&&!completionLabel(p)?`<button class="button primary" data-support-action="choose" data-point-id="${safe(p.id)}">Meet here next ✓</button>`:''}<a class="button ${entry.agreed||!edit?'primary':'secondary'}" href="${directions(p)}" target="_blank" rel="noopener noreferrer">${mode()==='supporter'?'Drive to this pin':'Walking directions'} ↗</a><button class="button secondary" data-map-action="${fullRouteActive?'all-points':'points'}">Back to map</button></div>${edit&&!canManageCheckpoints()?`<div class="point-status-actions">${entry.agreed?`<button class="text-button" data-support-action="met" data-point-id="${safe(p.id)}">✓ Met here</button>`:''}<button class="text-button" data-support-action="skip" data-point-id="${safe(p.id)}">Skip this point</button></div>`:''}${alternatives.length?`<div class="point-alternatives"><h3>Nearby choice</h3>${alternatives.map(a=>`<button class="point-alternative" data-map-point-id="${safe(a.id)}"><strong>${safe(meetingName(a))} · ${safe(landmarkName(a))}</strong><span>${Math.abs(a.routeKm-p.routeKm).toFixed(1)} route km ${a.routeKm>=p.routeKm?'later':'earlier'} <b>›</b></span></button>`).join('')}</div>`:''}<details class="details-card point-sources"><summary>Original pin & place details</summary><p>${p.optionalMeetup?'This optional EV meet-up uses a checked charging location near the route. Check signed pedestrian access, car-park hours and bay availability.':'The pin follows the original planning map. Nearby names help you recognise the spot; confirm access and opening hours separately.'}</p>${(p.originalMapLinks||[]).map(url=>`<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">Original Google place / parking link ↗</a>`).join('')}${links.filter(url=>!(p.originalMapLinks||[]).includes(url)).map((url,i)=>`<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">${i?'Another checked source':'Checked landmark source'} ↗</a>`).join('')}</details></article>`;
    switchTab('point');
  }
  function focusPoint(p) {
    if(!raceMap||!isPoint(p)){notify('Open the agreed Google Maps link for this place.');return;}
    following=false;pinnedPoint=p;switchTab('now');moving=true;raceMap.setView([p.lat,p.lng],15,{animate:false});moving=false;drawSummary();drawPlaces();updateEdge();
    if(p.id&&selected()?.id!==p.id){
      const layer=L.marker([p.lat,p.lng],{title:title(p),icon:L.divIcon({className:'',html:'<span class="route-start-pin">'+safe(title(p))+'</span>',iconSize:[110,30],iconAnchor:[55,30]})}).addTo(placeLayer);
      layer.on('click',()=>{if(pois.some(x=>x.id===p.id))openFacilities(mode()==='supporter'&&p.kinds?.includes('charger')?'charger':p.kinds?.[0]||'all',p.id);else switchTab('meetup');});
    }
  }
  function focusPerson(kind) {
    if(kind==='crew'){everyone();switchTab('now');return;}
    const p=kind==='madlis'?rivalPosition():supporterPeople.some(person=>person.id===kind)?mapSupporterPosition(kind):raceRunner();
    if(!raceMap||!isPoint(p)){switchTab('live');return;}
    following=false;switchTab('now');moving=true;raceMap.setView([p.lat,p.lng],15,{animate:false});moving=false;drawSummary();updateEdge();
  }
  function refresh(snapshot) {
    current=snapshot || window.liveGuide?.getSnapshot?.() || {};
    if(typeof currentTab!=='undefined'&&currentTab==='facilities'&&['toilet','charger'].includes(activeFilter))renderFacilities();
    refreshCrewToiletTravel();
    drawSummary();renderPerson();if(pointDetail&&q('#checkpoint-controls'))q('#checkpoint-controls').innerHTML=checkpointControls(pointDetail);if(!raceMap)return;drawRoute();drawPlaces();
    if(following&&frame.length)fit(frameBounds());
  }
  async function bootMap() {
    if(!window.L){mapLoadError=true;q('#map-notice').hidden=false;putText('#map-notice','Map could not load. Open the original route from the tools.');return;}
    const read=async file=>{const response=await fetch('data/'+file);if(!response.ok)throw new Error('Map data unavailable');return response.json();};
    try{
      const loaded=await Promise.all([read('guide-data.json'),read('route.geojson'),read('facilities.json').catch(()=>({pois:[]}))]);
      data=loaded[0];window.routeDistances?.setOrigin?.(data.crowDistanceOrigin);const geo=loaded[1];milestones=window.raceMilestones?.build?.(geo,data.crowDistanceOrigin)||[];geometry=geo.coordinates||geo.geometry?.coordinates||[];pois=loaded[2].pois||[];
      if(geometry.length<2)throw new Error('Route line unavailable');
      cumulative=[0];for(let i=1;i<geometry.length;i++)cumulative.push(cumulative[i-1]+distance({lat:geometry[i-1][1],lng:geometry[i-1][0]},{lat:geometry[i][1],lng:geometry[i][0]}));
      raceMap=L.map('race-map',{zoomControl:false,scrollWheelZoom:true,zoomSnap:.5,zoomAnimation:!matchMedia('(prefers-reduced-motion: reduce)').matches}).setView([data.start.lat,data.start.lng],12);
      raceMap.attributionControl.setPrefix(false);
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(raceMap);
      let tileErrors=0;tiles.on('tileerror',()=>{if(++tileErrors>=4){tileFailure=true;drawSummary();}});tiles.on('tileload',()=>{if(tileFailure){tileFailure=false;tileErrors=0;drawSummary();}});
      routeLayer=L.layerGroup().addTo(raceMap);placeLayer=L.layerGroup().addTo(raceMap);peopleLayer=L.layerGroup().addTo(raceMap);rivalLayer=L.layerGroup().addTo(raceMap);
      raceMap.on('dragstart',()=>{following=false;drawSummary();});raceMap.on('zoomstart',()=>{if(!moving){following=false;drawSummary();}});raceMap.on('moveend zoomend',()=>{drawPeople();updateEdge();});
      new ResizeObserver(()=>{if(!raceMap)return;raceMap.invalidateSize();if(following&&frame.length)fit(frameBounds());}).observe(q('#race-map'));
      refresh();
    }catch(error){mapLoadError=true;console.warn('Map load:',error);q('#map-notice').hidden=false;putText('#map-notice','Route could not load. Open the original Google route from the tools.');}
  }
  q('#map-recenter').addEventListener('click',recenterFromTap);q('#map-follow').addEventListener('click',recenterFromTap);
  q('#map-zoom-in').addEventListener('click',()=>raceMap?.zoomIn());q('#map-zoom-out').addEventListener('click',()=>raceMap?.zoomOut());
  document.addEventListener('click',event=>{
    const personId=event.target.closest('[data-map-person]')?.dataset.mapPerson;if(personId)openPerson(personId);
    const personFocus=event.target.closest('[data-map-person-focus]')?.dataset.mapPersonFocus;if(personFocus)focusPerson(personFocus);
    const supportAction=event.target.closest('[data-support-action]')?.dataset.supportAction;
    if(['met','skip'].includes(supportAction)&&typeof currentTab!=='undefined'&&currentTab==='point')showNextPoints();
    const action=event.target.closest('[data-map-action]')?.dataset.mapAction;
    if(['complete-checkpoint','skip-checkpoint','undo-checkpoint'].includes(action))changeCheckpoint(action.split('-')[0],event.target.closest('[data-map-action]')?.dataset.pointId);
    else if(action==='everyone')everyone();else if(action==='all-points')showFullRoute();else if(action==='milestones')showMilestones();else if(action==='crew-location')showCrewLocation();else if(action==='points')showNextPoints();else if(action==='next-point')openPoint(nextMeeting());else if(action==='toilets')showToiletsAhead();else if(action==='chargers')showChargers();else if(action==='charger-list')openFacilities('charger');else if(action==='toilet-filters')openFacilities('toilet');else if(action==='toilet-reset')setToiletFilters({scope:'remaining',opening:'all',wide:true});else if(action==='amenities')mode()==='runner'?showToiletsAhead():openFacilities('all');
    const milestoneId=event.target.closest('[data-focus-milestone]')?.dataset.focusMilestone;if(milestoneId)showMilestones(milestoneId);
    const pointId=event.target.closest('[data-map-point-id]')?.dataset.mapPointId;if(pointId)openPoint(pointId);
    const filter=event.target.closest('[data-facility-filter]')?.dataset.facilityFilter;if(filter)filter==='toilet'?showToiletsAhead():openFacilities(filter);
    const id=event.target.closest('[data-focus-poi]')?.dataset.focusPoi;if(id){const p=pois.find(x=>x.id===id);if(p)focusPoint(p);}
  });
  for(const [id,key] of [['toilet-scope','scope'],['toilet-arrival','arrival'],['toilet-opening','opening'],['toilet-wide','wide']])q('#'+id)?.addEventListener('change',event=>setToiletFilters({[key]:key==='wide'?event.target.checked:event.target.value}));
  q('#charger-scope')?.addEventListener('change',event=>setChargerFilters({scope:event.target.value}));
  q('#charger-meetups-only')?.addEventListener('change',event=>setChargerFilters({meetupsOnly:event.target.checked}));
  window.addEventListener('crewtravelupdate',()=>{
    if(toiletAudience()!=='crew')return;
    if(typeof currentTab!=='undefined'&&currentTab==='facilities'&&activeFilter==='toilet')renderFacilities();
    if(toiletMapActive){drawSummary();drawPlaces();}
  });
  window.addEventListener('rivalupdate',()=>{drawSummary();drawPeople();if(activePersonId==='madlis')renderRivalPerson();});
  window.addEventListener('competitorupdate',()=>{drawSummary();drawPeople();drawCompetitors();});
  window.addEventListener('competitorlocate',event=>{
    const p=event.detail;
    if(!raceMap||!isPoint(p))return;
    following=false;switchTab('now');drawCompetitors();
    moving=true;raceMap.setView([p.lat,p.lng],14,{animate:false});moving=false;
    raceMap.invalidateSize?.();
    if(p.stale)console.info('Selected competitor: last reported position only ('+p.lastSeen+').');
  });
  window.addEventListener('liveupdate',event=>refresh(event.detail));window.addEventListener('supportchange',()=>refresh());
  window.addEventListener('modechange',()=>{if(mode()==='runner'&&(fullRouteActive||chargerMapActive)){fullRouteActive=false;chargerMapActive=false;following=true;}if(activePersonId){activePersonId=null;if(typeof currentTab!=='undefined'&&currentTab==='person')switchTab('now');}if(mode()==='runner'&&typeof currentTab!=='undefined'){if(currentTab==='facilities')openFacilities('toilet');else if(currentTab==='point')openPoint(nextMeeting());}refresh();});
  window.addEventListener('viewchange',event=>{if(event.detail?.tab==='charging'&&mode()==='supporter'){openFacilities('charger');return;}if(event.detail?.tab!=='person')activePersonId=null;if(event.detail?.tab!=='point')pointDetail=null;});
  window.addEventListener('online',()=>{tileFailure=false;refresh();});window.addEventListener('offline',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.raceMap={focusPoint,focusPerson,openPerson,follow,everyone,showNextPoints,showFullRoute,showToiletsAhead,showChargers,openPoint,showAmenities:openFacilities,refresh,setToiletFilters,setChargerFilters,getChargerFilters:()=>({scope:chargerScope,meetupsOnly:chargerMeetupsOnly}),getVisibleChargers:()=>routeChargers().map(p=>({id:p.id,name:p.name,routeKm:p.routeKm,meetupPointId:p.meetupPointId||null})),getToiletFilters:()=>({scope:toiletScope,arrival:toiletAudience(),opening:toiletOpening,wide:toiletOffsetLimit()>800}),getVisibleToilets:()=>routeToilets().map(p=>({id:p.id,name:p.name,routeKm:p.routeKm,...toiletTiming(p)})),getMilestones:()=>milestones,showMilestones,getSnapshot:()=>current,getUpcomingPoints:()=>mapPlan().points};
  if(typeof currentTab!=='undefined'&&currentTab==='charging'&&mode()==='supporter')openFacilities('charger');
  bootMap();
})();
