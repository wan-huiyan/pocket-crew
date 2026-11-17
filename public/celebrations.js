'use strict';
(() => {
  const IDS=new Set(['start','marathon','km-50','km-60','km-70','km-80','km-90','km-100','gold','km-110','km-120','km-123']);
  const q=s=>document.querySelector(s);
  const releaseTime=value=>typeof value==='number'?value:Date.parse(value||'');
  const releaseKey=release=>release.id+':'+releaseTime(release.releasedAt);
  const SEEN_KEY='crow-seen-celebrations-v2';
  const dialog=q('#cheer-dialog');
  const MOMENTS={
    start:{style:'cheer-proud',subtitle:'Powered by tofu. Cheered on with a whole lot of love.'},
    marathon:{style:'cheer-proud',subtitle:'42.195 kilometres each. Two brilliant siblings and one very proud crow crew. ♡'},
    'km-50':{style:'cheer-proud',subtitle:'Fifty kilometres. Your whole crow crew is cheering you on. ♡'},
    'km-60':{style:'cheer-toast-moment',subtitle:'A toast to every step you have taken. ♡'},
    'km-70':{style:'cheer-proud',subtitle:'Every step has been yours. We are so proud of you.'},
    'km-80':{style:'cheer-mk',subtitle:'A little laugh from your very enthusiastic crew.'},
    'km-90':{style:'cheer-hooray',subtitle:'You have come so far. We are right here, cheering you on.'},
    'km-100':{style:'cheer-gold',subtitle:'One hundred kilometres. What an extraordinary adventure. ♡'},
    gold:{style:'cheer-gold',subtitle:'An estimated gold-ring crossing. Your crow crew is cheering! The official tracker confirms the award.'},
    'km-110':{style:'cheer-hooray',subtitle:'Emily’s extraordinary grit, Graham’s steady steps, Ben’s support. One remarkable team. ♡'},
    'km-120':{style:'cheer-proud',subtitle:'One hundred and twenty. Emily, Graham and Ben: you have all been extraordinary. ♡'},
    'km-123':{style:'cheer-gold',subtitle:'One hundred and twenty-three! The crow crew is beside itself with pride. ♡'}
  };
  let activeId=null,preview=false,timer,returnTimer,releasing=false,legacyPlayed=0;
  const seen=new Set();
  try{
    const stored=localStorage.getItem(SEEN_KEY);
    if(stored){for(const key of JSON.parse(stored))if(typeof key==='string')seen.add(key);}
    else legacyPlayed=Number(localStorage.getItem('crow-last-celebration-v1'))||0;
  }catch{}
  const ready=()=>typeof stops!=='undefined'&&stops.length>0;
  const allowed=id=>IDS.has(id)&&ready()&&stops.some(s=>s.id===id);
  function remember(release){
    seen.add(releaseKey(release));
    try{localStorage.setItem(SEEN_KEY,JSON.stringify([...seen].slice(-64)));}catch{}
    window.liveGuide?.acknowledgeCelebration(release.id,release.releasedAt);
  }
  function confetti(id){
    const container=q('#cheer-confetti');container.replaceChildren();
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const colours=id==='gold'||id==='km-100'?['#ca982d','#63965e','#e87f61']:['#75a279','#e88470','#628e9d','#bca0ca'];
    const marks=['♡','❧','✦','♡','❧'];
    for(let i=0;i<19;i++){
      const span=document.createElement('span');span.textContent=marks[i%marks.length];
      span.style.cssText=`--x:${5+(i*43%91)}%;--s:${15+i%4*5}px;--c:${colours[i%colours.length]};--d:${i%7*.11}s;--drift:${i%2?45:-37}px;--r:${i%2?170:-145}deg`;
      container.append(span);
    }
  }
  function keepMoment(id,at){
    if(!IDS.has(id))return;state.unlocked[id]=Number.isFinite(releaseTime(at))?releaseTime(at):Date.now();if(id==='gold')state.goldConfirmed=true;
    persist();renderPosters();syncRevealedCache();
  }
  function cleanup(){
    clearTimeout(timer);clearTimeout(returnTimer);dialog.classList.remove('settled','has-poster');q('#cheer-confetti').replaceChildren();
    q('#cheer-poster')?.removeAttribute('src');if(q('#cheer-poster'))q('#cheer-poster').alt='';activeId=null;
  }
  function close(){if(dialog.open)dialog.close();cleanup();}
  function crossingCopy(id){
    const snapshot=window.liveGuide?.getSnapshot?.();
    if(id==='marathon')return 'Emily & Jeff · 42.195 km each';
    const record=window.raceMilestones?.mergeRecords?.(snapshot?.achievements?.records)?.find(item=>item.runnerId==='emily'&&item.milestoneId===id);
    return record&&window.raceMoments?.recordText?'Emily · '+window.raceMoments.recordText(record):'';
  }
  function play(id,options={}){
    if(!allowed(id)||(!options.preview&&!state.unlocked[id]))return false;
    if(dialog.open)close();
    activeId=id;preview=options.preview===true;
    const stop=stops.find(s=>s.id===id),copy=chapter(stop),moment=MOMENTS[id];
    dialog.className='cheer-dialog '+moment.style;
    q('#cheer-eyebrow').textContent=id==='start'?'Emily & Jeff':crossingCopy(id)||'Emily · '+(id==='gold'?'Gold ring':stop.routeKm+' km along the route');
    q('#cheer-title').textContent=id==='start'?copy.cheer:id==='marathon'?'Emily & Jeff · a marathon!':id==='gold'?'Emily · gold-ring crossing!':'Emily, '+stop.routeKm+' km!';
    q('#cheer-subtitle').textContent=moment.subtitle;
    q('#cheer-open-poster').hidden=preview;
    q('#cheer-preview-note').hidden=!preview;
    q('#cheer-back').textContent=preview?'Back to crew tools':'Back to our map';
    const frame=q('#cheer-poster-frame'),image=q('#cheer-poster'),status=q('#cheer-poster-status'),saved=q('#cheer-saved-note');
    const path=!preview&&typeof posterPath==='function'?posterPath(stop,'preview'):'';
    frame.hidden=!path;status.hidden=true;saved.hidden=preview;
    saved.textContent=options.release?'Saved in Moments & milestones · back to map shortly ♡':'Saved in Moments & milestones ♡';
    if(path){
      image.alt=copy.cheer+' Celebration poster for '+(id==='start'?'Emily and Jeff':id==='marathon'?'Emily and Jeff’s marathon':"Emily’s "+(id==='gold'?'gold ring':stop.routeKm+' km milestone'))+'.';
      image.src=path;dialog.classList.add('has-poster');
    }else image.removeAttribute('src');
    confetti(id);dialog.showModal();
    timer=setTimeout(()=>dialog.classList.add('settled'),4500);
    if(options.release){remember(options.release);returnTimer=setTimeout(close,14000);}
    return true;
  }
  function flushPending(){
    if(!ready())return;
    const history=window.liveGuide?.getSnapshot?.()?.releases||[];
    let changed=false;
    for(const release of history){
      if(IDS.has(release.id)&&Number.isFinite(releaseTime(release.releasedAt))&&state.unlocked[release.id]!==releaseTime(release.releasedAt)){state.unlocked[release.id]=releaseTime(release.releasedAt);if(release.id==='gold')state.goldConfirmed=true;changed=true;}
    }
    if(changed){persist();renderPosters();syncRevealedCache();}
    if(document.hidden||dialog.open||q('#poster-dialog')?.open||window.guideIntro?.isBlocking?.())return;
    const pending=(window.liveGuide?.pendingReleases?.()||[]).filter(r=>allowed(r.id)&&Number.isFinite(releaseTime(r.releasedAt))&&!seen.has(releaseKey(r)));
    for(const release of pending.filter(r=>releaseTime(r.releasedAt)<=legacyPlayed))remember(release);
    const fresh=pending.filter(r=>!seen.has(releaseKey(r))).sort((a,b)=>releaseTime(b.releasedAt)-releaseTime(a.releasedAt)||stops.find(s=>s.id===b.id).routeKm-stops.find(s=>s.id===a.id).routeKm);
    // All releases stay in shared history. A late join or catch-up batch opens
    // only its newest moment, without a queue of past full-screen interruptions.
    if(fresh.length&&play(fresh[0].id,{release:fresh[0]}))for(const earlier of fresh.slice(1))remember(earlier);
  }
  async function release(id){
    if(releasing||state.mode!=='supporter'||!allowed(id))return;
    const snapshot=window.liveGuide?.getSnapshot?.()||{};
    if(snapshot.room?.joined&&!snapshot.room.owner){notify('The support crew can release this from their supporter controls.');return;}
    if(snapshot.room?.joined&&!snapshot.room.loaded){notify('Reconnect to the crew room before releasing this cheer.');return;}
    const stop=stops.find(s=>s.id===id),r=snapshot.runners?.emily||snapshot.runner;
    if(id!=='start'&&id!=='gold'&&Number.isFinite(r?.routeKm)&&r.fresh&&r.routeKm<stop.routeKm-.3){notify(`Emily’s tracker is at about ${r.routeKm.toFixed(1)} km. Keep this cheer until she reaches ${stop.routeKm} km.`);return;}
    const reached=id==='start'?'Ready to give Emily & Jeff their send-off cheer?':id==='marathon'?'Have both Emily and Jeff reached 42.195 km along the route?':id==='gold'?'Have you checked the official tracker and confirmed that Emily has earned gold?':`Has Emily actually reached ${stop.routeKm} km?`;
    const destination=snapshot.room?.owner?'This releases the celebration to everyone watching the race guide.':'This opens the celebration on this phone only. Use supporter controls to share a released cheer with everyone.';
    if(!confirm(reached+'\n\n'+destination))return;
    releasing=true;
    try{
      if(snapshot.room?.owner){
        const result=await window.liveGuide.releaseCelebration(id);
        if(!result?.ok){notify('That cheer was not released. Please check the connection and try again.');return;}
        if(result.release)keepMoment(id,result.release.releasedAt);
        flushPending();notify('Your cheer is on its way to the family. ♡');
      }else{keepMoment(id,Date.now());play(id);}
    }finally{releasing=false;}
  }
  function openPoster(){const id=activeId;close();if(id)showPoster(id);}
  q('#close-cheer').addEventListener('click',close);
  q('#cheer-back').addEventListener('click',()=>{const wasPreview=preview;close();if(!wasPreview)switchTab('now');});
  dialog.addEventListener('close',cleanup);
  q('#cheer-open-poster').addEventListener('click',openPoster);
  q('#cheer-poster-frame')?.addEventListener('click',openPoster);
  q('#cheer-poster')?.addEventListener('error',()=>{const status=q('#cheer-poster-status');status.hidden=false;status.textContent='Your moment is saved. Open it again when the connection improves.';});
  document.addEventListener('click',event=>{
    const previewId=event.target.closest('[data-preview-cheer]')?.dataset.previewCheer;
    if(previewId&&state.mode==='supporter'&&window.liveGuide?.getSnapshot?.().room?.owner===true)play(previewId,{preview:true});
    const replayId=event.target.closest('[data-replay-cheer]')?.dataset.replayCheer;
    if(replayId&&state.unlocked[replayId])play(replayId);
  });
  window.addEventListener('celebrationrelease',flushPending);
  window.addEventListener('liveupdate',()=>{renderPosters();flushPending();});
  window.addEventListener('guideready',flushPending);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){dialog.classList.add('settled');if(dialog.open)close();}else flushPending();});
  window.crowCelebrations={release,preview(id='km-90'){if(state.mode==='supporter'&&window.liveGuide?.getSnapshot?.().room?.owner===true)play(id,{preview:true});},flushPending};
  flushPending();
})();
