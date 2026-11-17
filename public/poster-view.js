'use strict';
(() => {
  const q = s => document.querySelector(s);
  const set = (selector, value) => { const element=q(selector); if(element && element.textContent!==value)element.textContent=value; };
  const time = value => typeof value==='number' ? (value<1e12?value*1000:value) : Date.parse(value||'');
  const point = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const age = p => Math.max(0,Date.now()-time(p?.recordedAt||p?.updatedAt));
  const ago = p => !Number.isFinite(age(p))?'time unknown':age(p)<60000?'just now':age(p)<3600000?Math.floor(age(p)/60000)+' min ago':Math.floor(age(p)/3600000)+' h ago';
  const isFresh = p => p?.fresh===true && age(p)<300000;
  const people=[{id:'emily',name:'Emily',feed:'runner'},{id:'jeff',name:'Jeff',feed:'crew'},{id:'huiyan',name:'Huiyan',feed:'crew'},{id:'graham',name:'Graham',feed:'crew'},{id:'ben',name:'Ben',feed:'crew'}];
  let snapshot={};
  const hasIndividualRunners=()=>Object.prototype.hasOwnProperty.call(snapshot,'runners');
  // A missing individual report must never inherit the other runner's summary pin.
  const supporterPosition=id=>Object.prototype.hasOwnProperty.call(snapshot,'supporters')?snapshot.supporters?.[id]??null:id==='huiyan'?snapshot.crew??null:null;
  const legacyRunner=()=>snapshot.runner?.summaryRunnerId==='jeff'||snapshot.runner?.bib==='133'||snapshot.bib==='133'?null:snapshot.runner;
  const personPosition=person=>person.feed==='crew'?supporterPosition(person.id):hasIndividualRunners()?snapshot.runners?.emily??null:legacyRunner();
  const emilyPosition=()=>hasIndividualRunners()?snapshot.runners?.emily??null:legacyRunner();
  const viaEmilyTracker=id=>{
    const p=emilyPosition(),at=time(p?.recordedAt||p?.updatedAt);
    return snapshot.supporterPlans?.[id]?.mode==='walking'&&point(p)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&isFresh(p)&&Number.isFinite(at)&&at<=Date.now()+30000&&!p.retired&&!p.finished?p:null;
  };
  const runnerTracking=person=>snapshot.runnerTracking?.[person.id]||(hasIndividualRunners()?{}:{...snapshot.tracker,bib:snapshot.bib});
  const runnerFresh=(person,runner)=>isFresh(runner)&&(!runnerTracking(person).status||runnerTracking(person).status==='live');
  function runnerStatus(person,runner){
    if(runner)return runner.retired?'Tracker says retired':runner.finished?'Tracker says finished':runner.offRouteM>=500?'Off the planned route':(runnerFresh(person,runner)?'Updated ':'Last seen ')+ago(runner);
    const tracking=runnerTracking(person);
    const waiting={unavailable:'Tracker unavailable','wrong-event':'Check event','not-found':'Check race number',ambiguous:'Check tracker entry',error:'Tracker unavailable',offline:'Offline · awaiting report','event-not-current':'Waiting for this event'};
    return waiting[tracking.status]||(tracking.bib?'Waiting for first report':snapshot.room?.owner?'Add their race number':'Waiting for race number');
  }
  function personControl(person,status) {
    let control=q(`[data-poster-person="${person.id}"]`);
    if(!control)return;
    let restoreFocus=false;
    const tag='BUTTON';
    if(control.tagName!==tag){
      const replacement=document.createElement(tag.toLowerCase());
      replacement.className=control.className;
      replacement.dataset.posterPerson=person.id;
      replacement.replaceChildren(...control.childNodes);
      restoreFocus=document.activeElement===control;
      control.replaceWith(replacement);control=replacement;
    }
    control.type='button';
    const tracking=person.feed==='runner'?runnerTracking(person):null;
    const plan=snapshot.supporterPlans?.[person.id]?.mode,planLabel=plan==='walking'?'Walking with Emily. ':plan==='meeting'?'Meeting at next stop. ':'';
    const feedLabel=person.feed==='crew'?(viaEmilyTracker(person.id)?`Map pin via Emily’s official tracker, not ${person.name}’s own phone GPS. Own-phone sharing controls available`:`${person.name}’s own phone location`):hasIndividualRunners()?`${tracking.name||person.name}’s runner tracker${tracking.bib?' · race number '+tracking.bib:''}`:'Emily’s runner tracker';
    control.setAttribute('aria-label',`${person.name}. ${planLabel}${status}. ${feedLabel}. ${person.feed==='crew'?'Open location details and sharing controls on this site':'Open pace and arrival details'}`);
    control.setAttribute('aria-haspopup','dialog');
    control.setAttribute('title',`${person.name} · ${planLabel}${status} · ${feedLabel}`);
    if(restoreFocus)control.focus({preventScroll:true});
  }
  function update(next) {
    snapshot=next||window.liveGuide?.getSnapshot?.()||{};
    const meet=window.raceMap?.getUpcomingPoints?.()[0];
    const landmark=meet?.landmark?.mapLabel||meet?.landmark?.name||meet?.detail||'';
    // Shared map code owns the point, distance and directions in both views.
    set('#poster-meet-detail',landmark);q('#poster-meet-detail').hidden=!landmark;
    const canShare=snapshot.room?.owner||snapshot.room?.canShareLocation;
    for(const person of people){
      const isRunner=person.feed==='runner',position=personPosition(person);
      const crewStatus=point(position)?((isFresh(position)&&position.sharing?'Sharing · ':position.sharing?'Last seen ':'Paused · ')+ago(position)):(snapshot.room?.error==='expired'||snapshot.room?.status==='ended'?'Sharing has ended':canShare?'Update location':'Awaiting location');
      const sharedTracker=isRunner?null:viaEmilyTracker(person.id);
      const status=isRunner?runnerStatus(person,position):sharedTracker?'With Emily · tracker '+ago(sharedTracker):crewStatus;
      personControl(person,status);
      set(`#poster-${person.id}-status`,status);
      q(`#poster-${person.id}-dot`).classList.toggle('fresh',isRunner?runnerFresh(person,position)&&!position.finished&&!position.retired:sharedTracker?true:isFresh(position)&&position.sharing);
    }
    q('meta[name="theme-color"]').content=document.body.classList.contains('night')?'#242642':'#C93625';
    updateClockLabel();
  }
  function updateClockLabel() {
    set('#poster-clock-label',q('#clock-caption')?.textContent||'RACE START');
    set('#poster-clock',q('#race-clock')?.textContent||'23:59 GMT');
  }
  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-poster-person]');
    const person=people.find(person=>person.id===control?.dataset.posterPerson);
    if(person){
      event.preventDefault();
      if(window.raceMap?.openPerson)window.raceMap.openPerson(person.id);
      else if(person.feed==='runner'&&point(personPosition(person))){
        if(hasIndividualRunners())window.liveGuide?.showRunnerOnMap?.(person.id);
        else window.liveGuide?.showRunnersOnMap();
      }
      else if(person.feed==='crew'){
        if(window.liveGuide?.showCrewLocationControls)window.liveGuide.showCrewLocationControls();
        else switchTab('live');
      }
      else switchTab('live');
    }
    // A root base keeps existing data/assets working; local hash links stay in this display.
    const anchor=event.target.closest('a[href^="#"]');
    if(anchor){event.preventDefault();const target=anchor.getAttribute('href').slice(1);if(target==='main')q('#main')?.focus();else switchTab(target||'now');}
  });
  q('#share-guide').addEventListener('click',event=>{
    event.stopImmediatePropagation();
    shareText('Emily & Jeff’s Great Escape','Our pocket race guide — route, meet-ups & a very supportive crow.',location.origin+'/poster/');
  },true);
  window.addEventListener('liveupdate',event=>update(event.detail));
  window.addEventListener('supportchange',()=>update());
  window.addEventListener('modechange',()=>update());
  window.addEventListener('viewchange',()=>update());
  const clock=q('#race-clock');if(clock)new MutationObserver(updateClockLabel).observe(clock,{childList:true,characterData:true,subtree:true});
  update();
})();
