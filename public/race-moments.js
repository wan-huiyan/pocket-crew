'use strict';
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.raceMoments=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const NAMES={emily:'Emily',jeff:'Jeff'},LABELS={marathon:'Marathon',silver:'Silver ring',gold:'Gold ring',...Object.fromEntries([50,60,70,80,90,100,110,120,123].map(km=>['km-'+km,km+' km']))};
  const POSTER_MILESTONES=new Set(['marathon','gold','km-50','km-60','km-70','km-80','km-90','km-100','km-110','km-120','km-123']);
  const SEEN_KEY='crow-race-moments-35950-v1';
  const stamp=value=>typeof value==='number'?value:Date.parse(value||'');
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=value=>Number.isFinite(stamp(value))?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(stamp(value)):'time unknown';
  function records(snapshot){return root.raceMilestones?.mergeRecords?.(snapshot?.achievements?.records)||[];}
  function visiblePoint(point,snapshot){
    return !point.hiddenUntilReached&&!point.id.startsWith('km-')||snapshot?.achievements?.persisted===true&&records(snapshot).some(record=>record.runnerId==='emily'&&record.milestoneId===point.id);
  }
  function posterReleased(point,snapshot){
    return POSTER_MILESTONES.has(point.id)&&(snapshot?.releases||[]).some(release=>release.id===point.id&&Number.isFinite(stamp(release.releasedAt)));
  }
  function activeRunnerIds(snapshot){
    const configured=root.crewGuide?.getRunners?.();
    return Array.isArray(configured)?configured.map(person=>person.id).filter(id=>Object.hasOwn(NAMES,id)):Object.keys(snapshot?.runners||{}).filter(id=>Object.hasOwn(NAMES,id));
  }
  function recordText(record){
    if(!record)return '';
    return record.crossedAt?(record.estimated?'~':'')+clock(record.crossedAt)+' crossed':'Beyond by '+clock(record.firstSeenBeyondAt);
  }
  function forecast(point,snapshot,runnerId,now){
    const crossed=new Set(records(snapshot).filter(r=>r.milestoneId===point.id).map(r=>r.runnerId));
    const active=new Set(activeRunnerIds(snapshot));
    const runners=Object.fromEntries(Object.entries(snapshot?.runners||{}).filter(([id])=>active.has(id)&&(runnerId?id===runnerId:!crossed.has(id))));
    return root.meetingForecast?.estimate?.({snapshot:{...snapshot,runners},point,now})||{status:'unavailable'};
  }
  function forecastRange(eta){
    const range=typeof eta?.rangeText==='string'?eta.rangeText.trim().replace(/^(?:around|about)\s+/i,''):'';
    const early=eta?.earliestFormattedTime,late=eta?.latestFormattedTime;
    return range||(early?(late&&late!==early?early+'–'+late:early):eta?.formattedTime||'time pending');
  }
  function presentation(point,snapshot,now=Date.now()){
    const active=activeRunnerIds(snapshot),reached=records(snapshot).filter(record=>record.milestoneId===point.id),reachedIds=new Set(reached.map(record=>record.runnerId));
    const activeReached=active.filter(id=>reachedIds.has(id)).length,completed=active.length>0&&activeReached===active.length;
    if(completed)return {text:active.length===1?NAMES[active[0]]+' crossed ♡':'Both crossed ♡',completed:true,records:reached};
    const eta=forecast(point,snapshot,null,now);
    const text=eta.status==='ready'?(activeReached?activeReached+' crossed · ETA ':'ETA ')+forecastRange(eta):activeReached?activeReached+' crossed · '+(active.length-activeReached)+' to come':['passed','arrived'].includes(eta.status)?'Checking crossing':'ETA · waiting for pace';
    return {text,completed:false,records:reached,forecast:eta};
  }
  function eligible(record,{now=Date.now(),startedAt=0,seen=new Set()}={}){
    const at=stamp(record?.crossedAt||record?.firstSeenBeyondAt);
    return !record?.backfilled&&!seen.has(record?.id)&&Number.isFinite(at)&&at>=startedAt&&at<=now+30000&&now-at<=300000;
  }

  const doc=typeof document!=='undefined'?document:null;
  let snapshot={},activeId=null,baseline=false,toastTimer=null;
  const startedAt=Date.now(),seen=new Set(),queue=new Map();
  try{for(const id of JSON.parse(root.localStorage?.getItem(SEEN_KEY)||'[]'))if(typeof id==='string')seen.add(id);}catch{}
  const q=selector=>doc?.querySelector(selector);
  function saveSeen(){try{root.localStorage?.setItem(SEEN_KEY,JSON.stringify([...seen].slice(-12)));}catch{}}
  function milestoneRows(point){
    const history=records(snapshot).filter(record=>record.milestoneId===point.id);
    const active=new Set(activeRunnerIds(snapshot));
    return Object.entries(NAMES).filter(([id])=>active.has(id)||history.some(record=>record.runnerId===id)).map(([id,name])=>{
      const record=history.find(item=>item.runnerId===id),eta=record?null:forecast(point,snapshot,id,Date.now());
      const text=record?recordText(record):eta?.status==='ready'?'ETA '+forecastRange(eta):['arrived','passed'].includes(eta?.status)?'Checking crossing':'Waiting for route pace';
      const evidence=record?.evidence;
      const note=record?(record.crossedAt?(evidence?.beforeAt&&evidence?.afterAt?'GPS bracket '+clock(evidence.beforeAt)+'–'+clock(evidence.afterAt)+'. Estimated crossing time.':'Estimated from the event tracker.'):'The first available report was already beyond the boundary; the crossing time is unknown.'):(eta?.note||(eta?.status==='ready'?'The arrival range starts at unchanged current pace. Future stops can change it.':'Waiting for enough recent GPS progress.'));
      return '<div class="milestone-runner '+(record?'milestone-crossed':'')+'"><img src="assets/avatars-v5/'+id+'.webp" alt=""><div><strong>'+name+'</strong><span>'+safe(text)+'</span><details class="milestone-evidence"><summary>'+(record?'Crossing details':'Arrival estimate details')+'</summary><small>'+safe(note)+'</small></details></div>'+(record?'<b aria-label="Crossing recorded">✓</b>':'')+'</div>';
    }).join('');
  }
  function posterMoment(point){
    if(!posterReleased(point,snapshot))return '';
    const stop=typeof stops!=='undefined'?stops.find(item=>item.id===point.id):null;
    const path=stop&&typeof posterPath==='function'?posterPath(stop,'preview'):'';
    return '<div class="milestone-poster-moment">'+(path?'<button type="button" class="poster-thumb" data-poster="'+point.id+'" aria-label="Open '+safe(point.label)+' celebration poster"><img src="'+safe(path)+'" alt="'+safe(point.id==='marathon'?'Emily and Jeff’s marathon':point.label)+' celebration poster" width="80" height="120" loading="lazy"></button>':'')+'<div><strong>'+(point.id==='marathon'?'Emily & Jeff · 42.195 km ♡':'A moment to keep ♡')+'</strong><button type="button" class="text-button" data-replay-cheer="'+point.id+'">Enjoy this moment again ♡</button></div></div>';
  }
  function distanceSummary(point){
    const route=Number.isFinite(point.routeKm)?'~'+point.routeKm.toFixed(1)+' km':'Not reached by mapped route';
    const crow=Number.isFinite(point.crowKm)?'~'+point.crowKm.toFixed(1)+' km':'Not available';
    return '<p class="milestone-distances"><span>On foot · planned route: <strong>'+safe(route)+'</strong></span>'+ 
      '<span>As the crow flies from Meriden: <strong>'+safe(crow)+'</strong></span></p>';
  }
  function render(){
    const list=q('#race-milestone-list');if(!list)return;
    const points=(root.raceMap?.getMilestones?.()||[]).filter(point=>visiblePoint(point,snapshot)).sort((a,b)=>(a.routeKm??Infinity)-(b.routeKm??Infinity));
    if(!points.length){list.innerHTML='<p class="paper-card">Loading route milestones…</p>';return;}
    const card=point=>{
      const status=presentation(point,snapshot),route=Number.isFinite(point.routeKm)?'At approx. route km '+point.routeKm.toFixed(1):'Crossing is outside this planned route';
      return '<article id="race-milestone-'+point.id+'" class="paper-card milestone-card milestone-'+point.id+(activeId===point.id?' is-highlighted':'')+'"><div class="milestone-card-heading"><span class="milestone-badge" aria-hidden="true">'+(status.completed?'✓':'✦')+'</span><div><h2>'+safe(point.label)+'</h2><p>'+safe(point.basis==='route'?(point.thresholdKm??point.routeKm)+' km along the route':point.id==='silver'?'30 miles from Meriden':'60 miles from Meriden')+'</p></div></div>'+distanceSummary(point)+(point.basis==='crow'?'<p class="milestone-route-note">'+safe(route)+'</p>':'')+milestoneRows(point)+posterMoment(point)+'<button type="button" class="text-button milestone-map-action" data-focus-milestone="'+point.id+'">Show crossing on map →</button></article>';
    };
    const earned=points.filter(point=>presentation(point,snapshot).completed).reverse();
    const upcoming=points.filter(point=>!presentation(point,snapshot).completed);
    const html=(earned.length?'<h2 class="moments-group-title">Moments to keep ♡</h2>'+earned.map(card).join(''):'')+(upcoming.length?'<h2 class="moments-group-title">Along the way</h2>'+upcoming.map(card).join(''):'')+(records(snapshot).length&&!snapshot.achievements?.persisted?'<p class="small muted">Crossings detected. Retrying the shared record…</p>':'');
    if(list.innerHTML!==html)list.innerHTML=html;
  }
  function closeToast(){clearTimeout(toastTimer);toastTimer=null;const toast=q('#race-moment-toast');if(toast)toast.hidden=true;}
  function flush(){
    if(!doc||doc.hidden||root.guideIntro?.isBlocking?.()||q('dialog[open]')||!q('#race-moment-toast')?.hidden)return;
    const active=new Set(activeRunnerIds(snapshot));
    for(const [id,record]of queue)if(POSTER_MILESTONES.has(record.milestoneId)||!active.has(record.runnerId)||!eligible(record,{startedAt,seen})){seen.add(id);queue.delete(id);}
    const next=queue.values().next().value;if(!next){saveSeen();return;}
    const group=[...queue.values()].filter(record=>record.milestoneId===next.milestoneId);
    const names=group.map(record=>NAMES[record.runnerId]).join(' & '),label=LABELS[next.milestoneId];
    q('#race-moment-toast-title').textContent=names+' · '+label+'!';
    q('#race-moment-toast-copy').textContent='Crossing recorded. Look how far you’ve come ♡';
    q('#race-moment-toast').hidden=false;
    for(const record of group){seen.add(record.id);queue.delete(record.id);}saveSeen();
    toastTimer=setTimeout(()=>{closeToast();flush();},6500);
  }
  function accept(value){
    snapshot=value||root.liveGuide?.getSnapshot?.()||{};
    const history=records(snapshot);
    // Opening the guide replays no historical celebration. Only a new,
    // saved, current crossing detected during this visit enters the queue.
    if(!baseline&&snapshot.achievements?.persisted){for(const record of history)seen.add(record.id);baseline=true;saveSeen();}
    else if(baseline&&snapshot.achievements?.persisted)for(const record of history){
      if(!POSTER_MILESTONES.has(record.milestoneId)&&activeRunnerIds(snapshot).includes(record.runnerId)&&eligible(record,{startedAt,seen}))queue.set(record.id,record);else seen.add(record.id);
    }
    render();flush();
  }
  function open(id=null){snapshot=root.liveGuide?.getSnapshot?.()||snapshot;const point=root.raceMap?.getMilestones?.()?.find(item=>item.id===id);activeId=point&&Object.hasOwn(LABELS,id)&&visiblePoint(point,snapshot)?id:null;accept();if(typeof switchTab==='function')switchTab('milestones');}
  if(doc){
    q('#race-moment-toast-close')?.addEventListener('click',()=>{closeToast();flush();});
    q('#race-moment-toast')?.querySelector('[data-tab-target]')?.addEventListener('click',closeToast);
    root.addEventListener('liveupdate',event=>accept(event.detail));
    root.addEventListener('viewchange',event=>{if(event.detail?.tab==='milestones')accept();});
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)accept();});
    setInterval(()=>{if(!doc.hidden){if(typeof currentTab!=='undefined'&&currentTab==='milestones')accept();else flush();}},2000);
    accept();
  }
  return {presentation,recordText,eligible,visiblePoint,open,refresh:accept};
});
