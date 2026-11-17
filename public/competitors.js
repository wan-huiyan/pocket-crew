'use strict';
(() => {
  // A read-only category and follow view. Never feed competitor progress or
  // crow-flight distance into Emily's GPS, pacing or meeting-point ETA.
  const KEY='crow-competitors-35950-v1', EMILY='247', MATT='210';
  const MAX_FOLLOWED=8, FRESH_MS=5*60000, LIKELY_OUT_MS=60*60000;
  const ARCHIVE_URL='data/meriden-final-standings-2026.json', ARCHIVE_DATE='14 November 2026';
  const categoryNames={'female-solo':'Female solo','male-solo':'Male solo',pair:'Pairs',chained:'Chained teams',other:'Other / uncategorised',all:'Everyone'};
  const q = selector => document.querySelector(selector);
  const safe = value => String(value??'').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const validBib = value => /^\d{1,24}$/.test(String(value??''));
  const isLocation = p => typeof p?.lat==='number'&&Math.abs(p.lat)<=90&&typeof p?.lng==='number'&&Math.abs(p.lng)<=180;
  const clock = value => typeof value==='string'?Date.parse(value):NaN;
  const ageMs = p => Math.max(0,Date.now()-clock(p?.updatedAt));
  const isFresh = p => (isLocation(p)||p?.hasValidLocation===true)&&Number.isFinite(clock(p?.updatedAt))&&clock(p.updatedAt)<=Date.now()+30000&&ageMs(p)<=FRESH_MS;
  const distanceText = p => typeof p?.crowKm==='number'&&Number.isFinite(p.crowKm)?p.crowKm.toFixed(1)+' km':'—';
  const paceText = p => {
    if(!isFresh(p)||p?.finished||p?.retired||typeof p?.paceMinPerKm!=='number'||!Number.isFinite(p.paceMinPerKm)||p.paceMinPerKm<3||p.paceMinPerKm>40||Math.abs(clock(p.paceAsOf)-clock(p.updatedAt))>120000)return '';
    const seconds=Math.round(p.paceMinPerKm*60);
    return '~'+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+'/km';
  };
  const paceTag = p => paceText(p)?`<span class="competitor-pace" title="Approximate pace from recent moving GPS points; excludes stops">${safe(paceText(p))} moving</span>`:'';
  const ageText = p => status==='archived'?'':!p?.updatedAt||!Number.isFinite(clock(p.updatedAt))?'No report time':ageMs(p)<60000?'Just now':ageMs(p)<3600000?Math.floor(ageMs(p)/60000)+' min ago':Math.floor(ageMs(p)/3600000)+'h ago';
  // The organiser's retired/finished flags are the only confirmed outcomes.
  // After an hour without GPS, remove a racer from our *informal chase shortlist*,
  // but keep the provisional result and explicitly avoid claiming official DNF.
  const likelyOut = p => Number.isFinite(clock(p?.updatedAt))&&ageMs(p)>LIKELY_OUT_MS;
  const raceState = p => status==='archived'?(p?.retired?{kind:'retired',label:'⛔ Marked retired',note:'Retired flag in saved tracker snapshot'}:
    Number.isFinite(p?.crowKm)?{kind:'archive',label:'',note:''}:
    {kind:'unconfirmed',label:'— No recorded distance',note:'No crow-flight distance in saved tracker snapshot'}):p?.retired?{kind:'retired',label:'⛔ Dropped out',note:'Official tracker: retired'}:
    p?.finished?{kind:'finished',label:'✓ Finished',note:'Official tracker: finished'}:
    isFresh(p)?{kind:'active',label:'● Still in race',note:'Recent GPS · not marked retired'}:
    likelyOut(p)?{kind:'presumed-out',label:'⏸ Likely out',note:'No GPS for over one hour · not an official withdrawal; signal may be lost'}:
    {kind:'unconfirmed',label:'? Still entered',note:'No confirmed withdrawal · GPS may be old'};
  // One archive date and provenance note describe the entire saved batch. Only
  // exceptional individual states (retired / no recorded score) need a badge.
  const statusBadge = p => {const state=raceState(p);return !state.label?'':`<span class="competitor-race-state state-${state.kind}" title="${safe(state.note)}">${safe(state.label)}</span>`;};
  const defaults = () => ({showFemaleSoloOnMap:false,followed:{[MATT]:true},leaderboardCategory:'female-solo',compareOverall:false});
  function readPreferences(){
    try {
      const saved=JSON.parse(localStorage.getItem(KEY)||'null');
      if(!saved||typeof saved!=='object')return defaults();
      const followed={};
      for(const [bib,shown] of Object.entries(saved.followed||{})){
        if(Object.keys(followed).length>=MAX_FOLLOWED)break;
        if(validBib(bib)&&typeof shown==='boolean')followed[bib]=shown;
      }
      // Retire legacy broad-map setting even for phones that had it enabled.
      return {showFemaleSoloOnMap:false, followed,
        leaderboardCategory:typeof saved.leaderboardCategory==='string'&&Object.hasOwn(categoryNames,saved.leaderboardCategory)&&saved.leaderboardCategory!=='all'?saved.leaderboardCategory:'female-solo',
        compareOverall:saved.compareOverall===true};
    } catch {return defaults();}
  }
  let preferences=readPreferences(), data=null, status='waiting', checkedAt=null, pending=null;
  let searchTerm='';
  function savePreferences(){try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch{ /* Settings remain in memory. */ }}
  function getSnapshot(){return {status,checkedAt,femaleSolo:data?.femaleSolo||[],allCompetitors:data?.allCompetitors||[],roster:data?.roster||[],followed:(data?.allCompetitors||[]).filter(p=>Object.hasOwn(preferences.followed,p.bib)),preferences,stale:status==='unavailable'};}
  function isShown(bib){return preferences.followed[String(bib)]===true;}
  function emit(){window.dispatchEvent(new CustomEvent('competitorupdate',{detail:getSnapshot()}));}
  function update(){savePreferences();render();emit();}
  function setFemaleSoloMap(){preferences.showFemaleSoloOnMap=false;update();}
  function setLeaderboardCategory(value){if(!Object.hasOwn(categoryNames,value)||value==='all')return false;preferences.leaderboardCategory=value;preferences.compareOverall=false;update();refresh();return true;}
  function setCompareOverall(value){preferences.compareOverall=value===true;update();refresh();}
  function setShown(bib,value){bib=String(bib);if(Object.hasOwn(preferences.followed,bib)){preferences.followed[bib]=value===true;update();return true;}return false;}
  function follow(bib){
    bib=String(bib);
    if(!validBib(bib)||bib===EMILY||!data?.roster?.some(p=>p.bib===bib))return false;
    if(Object.hasOwn(preferences.followed,bib))return true;
    if(Object.keys(preferences.followed).length>=MAX_FOLLOWED)return false;
    preferences.followed[bib]=true;update();refresh();return true;
  }
  function unfollow(bib){bib=String(bib);if(!Object.hasOwn(preferences.followed,bib))return false;delete preferences.followed[bib];update();refresh();return true;}

  function mapType(p){
    if(Object.hasOwn(preferences.followed,String(p?.bib)))return 'followed';
    if(p?.group==='Solo'&&p?.ageCategory==='F'){
      const emily=data?.femaleSolo?.find(person=>person.bib===EMILY);
      if(isFresh(emily)&&Number.isFinite(emily?.crowKm)&&Number.isFinite(p?.crowKm)){
        if(p.crowKm>emily.crowKm+.05)return 'ahead';
        if(p.crowKm<emily.crowKm-.05)return 'behind';
      }
      return 'alongside';
    }
    return 'other';
  }
  const crowLabels={ahead:'Female solo · ahead of Emily on last fresh reports',behind:'Female solo · behind Emily on last fresh reports',alongside:'Female solo · relative distance uncertain or very close',other:'Other race category',followed:'Marked by family or supporters'};
  function mapCrowMarker(p){
    const type=mapType(p), n=Number(p?.bib)||0, tilt=(n%5-2)*2;
    const eyebrows=type==='ahead'?'<path d="M20 19l-5 3m21-3 5 3" class="crow-brow"/>':type==='other'||type==='alongside'?'<path d="M18 18q4-3 7-1" class="crow-brow"/>':'';
    const eyes=type==='followed'?'<path class="crow-wink" d="M16 24q4-4 8 0"/><ellipse class="crow-eye" cx="35" cy="24" rx="4.9" ry="6"/><circle class="crow-pupil" cx="36" cy="25" r="2"/>':
      '<ellipse class="crow-eye" cx="20" cy="24" rx="5" ry="6"/><ellipse class="crow-eye" cx="36" cy="24" rx="5" ry="6"/><circle class="crow-pupil" cx="21" cy="25" r="2"/><circle class="crow-pupil" cx="37" cy="25" r="2"/>';
    const beak='<path class="crow-beak" d="M23 30q5-4 10 0l-5 5z"/>';
    const wing=type==='ahead'?'<path class="crow-wing" d="M14 34Q3 29 4 16q12 0 20 16"/>':type==='behind'?'<path class="crow-wing" d="M42 33Q55 24 50 12q-12 2-18 21"/>':type==='followed'?'<path class="crow-wing" d="M42 34Q53 27 50 18q-11 3-18 16"/>':'<path class="crow-wing" d="M43 33Q55 29 52 21q-10 0-18 11"/>';
    const mood=type==='followed'?'<path class="crow-extra" d="M45 8c-2-5-8-2-5 2l5 5 5-5c3-4-3-7-5-2z"/>':type==='ahead'?'<path class="crow-extra" d="M7 12l6-2m-5 6 5-1"/>':type==='behind'?'<path class="crow-extra" d="M47 10l2-4m4 10 3-1"/>':'<path class="crow-extra" d="M48 9q3-4 5 0m-2 3v1"/>';
    const svg='<svg viewBox="0 0 58 57" class="crow-doodle" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'+
      '<g transform="rotate('+tilt+' 28 28)">'+
      '<path class="crow-feet" d="M21 44l-2 8-6 2m6-2 5 2m12-10 2 8 6 2m-6-2-4 2"/>'+
      '<path class="crow-tail" d="M15 38 7 34 9 42 18 44"/>'+
      wing+'<path class="crow-body" d="M14 15Q25 7 37 13Q47 18 45 34Q44 47 29 48Q14 49 11 34Q8 22 14 15Z"/>'+
      '<path class="crow-feathers" d="M16 35q5 5 12 6m7-1 4-3"/>'+eyebrows+eyes+beak+
      '<path class="crow-smile" d="M25 37q4 3 8 0"/>'+mood+'</g></svg>';
    const fresh=isFresh(p), currentPace=paceText(p);
    const bubble=currentPace?`<span class="crow-pace">${safe(currentPace)}</span>`:!fresh?`<span class="crow-last-seen">Last seen ${safe(ageText(p))}</span>`:'';
    return {type,label:crowLabels[type],html:'<div class="crow-marker crow-'+type+(!fresh?' crow-stale':'')+'">'+svg+'<span class="crow-bib">#'+safe(p?.bib)+'</span>'+bubble+'</div>'};
  }

  const byBib=bib => data?.femaleSolo?.find(p=>p.bib===bib)||data?.followed?.find(p=>p.bib===bib)||data?.roster?.find(p=>p.bib===bib)||null;
  const currentCategory=()=>preferences.compareOverall?'all':preferences.leaderboardCategory;
  function inCategory(p,category){return category==='all'||category==='female-solo'&&p.group==='Solo'&&p.ageCategory==='F'||category==='male-solo'&&p.group==='Solo'&&p.ageCategory==='M'||category==='pair'&&p.group==='Pair'||category==='chained'&&p.group==='Chained'||category==='other'&&!(p.group==='Pair'||p.group==='Chained'||p.group==='Solo'&&['F','M'].includes(p.ageCategory));}
  function checkedRows(){
    if(currentCategory()==='female-solo')return Array.isArray(data?.femaleSolo)?data.femaleSolo:[];
    const rows=(data?.allCompetitors||[]).filter(p=>inCategory(p,currentCategory()));
    return rows.map((p,i)=>({...p,rank:p.crowKm===null?null:i+1}));
  }
  function categoryLabel(p){return p.group==='Solo'?(p.ageCategory==='F'?'Female solo':p.ageCategory==='M'?'Male solo':'Solo · uncategorised'):p.group==='Pair'?'Pair':p.group==='Chained'?'Chained':p.group||'Uncategorised';}
  // Three tiny, original ink-and-paper cheering crows, now celebrating archived ranks.
  // The decorations are deliberately drawn here rather than tied to GPS state.
  function podiumCrow(place){
    const eyes=place===2?'<path d="M38 50q5-5 10 0" class="podium-wink"/><ellipse cx="67" cy="49" rx="7" ry="9" class="podium-eye"/><circle cx="69" cy="51" r="3" class="podium-pupil"/>':
      '<ellipse cx="42" cy="49" rx="7" ry="9" class="podium-eye"/><ellipse cx="67" cy="49" rx="7" ry="9" class="podium-eye"/><circle cx="44" cy="51" r="3" class="podium-pupil"/><circle cx="69" cy="51" r="3" class="podium-pupil"/>';
    const hat=place===1?'<path d="M35 28 30 7 42 15 52 2 63 15 77 7 73 29Z" fill="#f8c95d" stroke="#624322" stroke-width="2.8" stroke-linejoin="round"/><circle cx="52" cy="20" r="3" fill="#fff7dc"/>':place===2?
      '<path d="M45 29 58 5 72 30" fill="#e6a1bb" stroke="#644a66" stroke-width="2.8" stroke-linejoin="round"/><path d="m51 20 16 3m-13-9 9 2" stroke="#fff5d8" stroke-width="3"/><circle cx="58" cy="6" r="5" fill="#f2c653"/>':
      '<path d="M39 28 57 9 72 32" fill="#a3ced1" stroke="#44636d" stroke-width="2.8" stroke-linejoin="round"/><path d="m50 17 12 7m-17 0 17 6" stroke="#fff7db" stroke-width="3"/><path d="M57 9q10-7 13-1" fill="none" stroke="#d77c61" stroke-width="2.5"/>';
    const cheek='<circle cx="32" cy="61" r="4" fill="#ee9679"/><circle cx="78" cy="61" r="4" fill="#ee9679"/>';
    return `<svg class="podium-crow-art" viewBox="0 0 108 111" role="img" aria-label="Hand-drawn crow cheering for place ${place}" xmlns="http://www.w3.org/2000/svg">
      <g class="podium-sparks" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m10 20-5-7m10 3 2-7m76 12 6-6m-7 0-2-7"/><path d="m8 48-5-2m96 1 6-2"/></g>
      <path class="podium-feet" d="m43 90-3 11-8 3m8-3 6 3m21-14 3 11 8 3m-8-3-6 3" fill="none" stroke="#cc874d" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M25 77 7 69 17 84 31 86" class="podium-wing" stroke-linejoin="round"/>
      <path d="M28 66Q8 58 12 36q17 2 28 23M79 66q22-8 18-30Q80 39 69 59" class="podium-wing" stroke-linejoin="round"/>
      <path d="M31 30Q53 16 74 31Q90 44 84 70Q80 92 56 93Q31 93 24 72Q18 46 31 30Z" class="podium-body" stroke-linejoin="round"/>
      <path d="M35 74q17 13 38 0" fill="none" stroke="#d8e3ed" stroke-width="2" stroke-linecap="round"/>
      ${hat}${eyes}
      <path d="m47 60q8-7 16 0l-8 9z" fill="#f0b65c" stroke="#69452c" stroke-width="2" stroke-linejoin="round"/>
      ${cheek}<path d="M47 74q9 7 17 0" fill="none" stroke="#f8dfbd" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }
  function podiumCard(p,place){
    const me=p.bib===EMILY, followed=Object.hasOwn(preferences.followed,p.bib),stale=status!=='archived'&&!isFresh(p),state=raceState(p);
    return `<article class="podium-card podium-place-${place}${me?' is-emily':''}${stale?' is-stale':''} is-${state.kind}" id="competitor-${safe(p.bib)}">
      ${me?'<img class="podium-emily-art" src="assets/avatars-v5/emily.webp" alt="Emily’s illustrated portrait">':podiumCrow(place)}
      <div class="podium-step"><span class="podium-medal">${place===1?'🥇':place===2?'🥈':'🥉'} <b>${place}</b></span><strong class="podium-name">${safe(p.name)}${me?' ♡':''}</strong><span class="podium-bib">#${safe(p.bib)}${currentCategory()==='all'?' · '+safe(categoryLabel(p)):''}</span>
      <strong class="podium-distance">${safe(distanceText(p))}</strong><span class="podium-distance-label">crow-flight</span>${paceTag(p)}</div>
      ${statusBadge(p)}${status==='archived'?'':`<small class="podium-report">${safe(ageText(p))+(stale?' · older report':' · fresh GPS')}</small>`}
      ${me?'<span class="podium-you">Our Emily ♡</span>':`<button class="podium-follow" type="button" data-competitor-follow="${safe(p.bib)}" aria-label="${followed?'Stop following':'Follow'} ${safe(p.name)}">${followed?'♥ Following':'＋ Follow'}</button>`}
    </article>`;
  }
  function render(){
    const summary=q('#leaderboard-summary');
    const rows=checkedRows(), category=currentCategory(), overall=category==='all';
    const emily=rows.find(p=>p.bib===EMILY), femaleEmily=(data?.femaleSolo||[]).find(p=>p.bib===EMILY);
    const categorySelect=q('#leaderboard-category');if(categorySelect)categorySelect.value=preferences.leaderboardCategory;
    const compareToggle=q('#leaderboard-overall');if(compareToggle)compareToggle.checked=preferences.compareOverall;
    const overallSpot=q('#leaderboard-emily-overall');
    if(overallSpot){
      overallSpot.hidden=!overall;
      overallSpot.innerHTML=overall&&data?`<strong>Emily’s place across every category</strong><span>${emily?.rank?`#${safe(emily.rank)} of ${rows.length} · ${safe(distanceText(emily))} crow-flight`:'No comparable score in this snapshot'}</span><small>Unofficial comparison: solo runners, pairs and chained teams race in different categories.</small>${emily?.rank>3?'<button type="button" id="leaderboard-find-emily">Find Emily in the results ↓</button>':''}`:'';
    }
    if(summary) {
      if(!data)summary.innerHTML=status==='unavailable'?'<strong>Saved standings could not load.</strong><span>Please reconnect and reopen this page. The archive is safely stored in the Site.</span>':'<strong>Opening the saved race rankings…</strong>';
      else {
        const intro=category==='female-solo'?(emily?.rank?`<strong>Emily: 🥈 ${ordinal(emily.rank)} of ${rows.length} female solo</strong>`:`<strong>Female solo · ${rows.length} entrants</strong>`):overall?
          `<strong>All categories · ${rows.length} entrants</strong><span>Emily: ${emily?.rank?`${ordinal(emily.rank)} of ${rows.length}`:'no comparable score'} by crow-flight distance (informal comparison)</span>`:
          `<strong>${safe(categoryNames[category])} · ${rows.length} entrants</strong><span>Emily’s own category: ${femaleEmily?.rank?`female solo #${femaleEmily.rank}`:'female solo'}</span>`;
        summary.innerHTML=`${intro}<span>Saved Trail Live race snapshot · ${ARCHIVE_DATE}</span><small>Historical distances · no live tracker needed</small>`;
      }
    }
    const podium=q('#leaderboard-podium');
    if(podium){podium.hidden=!rows.length;podium.setAttribute?.('aria-label','Archived top three '+categoryNames[category].toLowerCase()+' competitors');podium.innerHTML=rows.slice(0,3).map((p,index)=>podiumCard(p,index+1)).join('');}
    const rest=q('#leaderboard-list'),restHeading=q('#leaderboard-rest-heading');
    if(restHeading){restHeading.hidden=rows.length<=3;restHeading.textContent=categoryNames[category]+' · the rest of the field';}
    if(rest){rest.setAttribute?.('aria-label','Remaining '+categoryNames[category].toLowerCase()+' competitors');rest.innerHTML=rows.slice(3).map(p=>{
      const state=raceState(p),followed=Object.hasOwn(preferences.followed,p.bib),delta=typeof p.crowKm==='number'&&typeof emily?.crowKm==='number'?p.crowKm-emily.crowKm:null;
      const gap=delta===null?'No comparable crow-flight score':p.bib===EMILY?'Our Emily ♡':Math.abs(delta)<.05?'Level with Emily’s crow score':(delta>0?'+':'−')+Math.abs(delta).toFixed(1)+' km vs Emily · crow-flight';
      const subline=category==='female-solo'||overall?gap:'Distance from Meriden as the crow flies';
      const details='#'+safe(p.bib)+(overall?' · '+safe(categoryLabel(p)):'')+(status==='archived'?'':' · '+safe(ageText(p)));
      return `<article class="leaderboard-row is-${state.kind}${p.bib===EMILY?' is-emily':''}" id="competitor-${safe(p.bib)}"><span class="leaderboard-rank">${safe(p.rank??'—')}</span><div class="leaderboard-person"><strong>${safe(p.name)}${p.bib===EMILY?' ♡':''}</strong><small>${details}</small><small>${safe(subline)}</small>${statusBadge(p)}</div><div class="leaderboard-km"><b>${safe(distanceText(p))}</b><small>crow-flight</small></div>${p.bib===EMILY?'<span class="leaderboard-our-emily" aria-label="Our Emily">♡</span>':`<button type="button" data-competitor-follow="${safe(p.bib)}" aria-label="${followed?'Stop following':'Follow'} ${safe(p.name)}">${followed?'♥':'＋'}</button>`}</article>`;
    }).join('');}
    const following=q('#competitor-followed');
    if(following){
      const bibs=Object.keys(preferences.followed);
      following.innerHTML=bibs.length?bibs.map(bib=>{
        const p=byBib(bib), label=p?.name||('Race '+bib), hasStats=Number.isFinite(p?.crowKm);
        return `<div class="competitor-follow-row archive-follow" id="followed-competitor-${safe(bib)}"><div><strong>${safe(label)} <small>#${safe(bib)}</small></strong><span>${hasStats?safe(distanceText(p))+' crow-flight':'No saved result'}</span>${p?statusBadge(p):'<span class="competitor-race-state state-unconfirmed">Not in saved standings</span>'}</div><button type="button" data-competitor-unfollow="${safe(bib)}" aria-label="Remove ${safe(label)} from favourites">×</button></div>`;
      }).join(''):'<p class="small muted">No individual competitors followed yet.</p>';
    }
    const limit=q('#competitor-follow-limit');if(limit)limit.textContent=`Saved ${Object.keys(preferences.followed).length} of ${MAX_FOLLOWED} favourites on this phone · archive only.`;
    renderSearchResults();
  }
  function ordinal(value){const v=value%100;return value+(v>=11&&v<=13?'th':value%10===1?'st':value%10===2?'nd':value%10===3?'rd':'th');}
  function renderSearchResults(){
    const results=q('#competitor-results');if(!results)return;
    const term=searchTerm.trim().toLocaleLowerCase();
    if(!term){results.innerHTML='<p class="small muted">Search archived competitors to add a favourite.</p>';return;}
    const matches=(data?.roster||[]).filter(p=>p.bib!==EMILY&&(p.name.toLocaleLowerCase().includes(term)||p.bib.includes(term))).slice(0,12);
    results.innerHTML=matches.length?matches.map(p=>{
      const followed=Object.hasOwn(preferences.followed,p.bib);
      return `<div class="competitor-search-row"><span><strong>${safe(p.name)}</strong><small>#${safe(p.bib)} · ${safe(p.group)}${p.ageCategory?' · '+safe(p.ageCategory):''}</small></span><button data-competitor-follow="${safe(p.bib)}" ${followed?'disabled':''}>${followed?'Following ✓':'Follow ＋'}</button></div>`;
    }).join(''):'<p class="small muted">No matching competitor found. Try a bib number.</p>';
  }
  function open(bib){
    if(typeof window.switchTab==='function')window.switchTab('leaderboard');
    else if(typeof switchTab==='function')switchTab('leaderboard');
    requestAnimationFrame(()=>(q('#competitor-'+String(bib))||q('#followed-competitor-'+String(bib)))?.scrollIntoView?.({block:'center',behavior:'smooth'}));
  }
  async function refresh(){
    if(data)return getSnapshot();
    if(pending)return pending;
    pending=(async()=>{
      try {
        // The race has finished. Use the checked-in snapshot rather than the
        // official API, which stops serving participants when tracking closes.
        const response=await fetch(ARCHIVE_URL,{cache:'force-cache',headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('Archive unavailable');
        const archive=await response.json();
        const all=archive?.categories?.all, female=archive?.categories?.['female-solo'];
        if(archive?.event!=='Escape from Meriden'||archive?.date!=='2026-11-14'||archive?.metric!=='km from Meriden as the crow flies'||
          !Array.isArray(all)||!Array.isArray(female)||all.length!==archive.totalUniqueEntrants||all.length<250||
          !female.some(p=>String(p.bib)===EMILY&&p.rank===2))throw new Error('Unexpected archive');
        const convert=p=>({
          bib:String(p.bib),name:String(p.name),group:String(p.group),ageCategory:String(p.ageCategory),
          crowKm:typeof p.crowKm==='number'&&Number.isFinite(p.crowKm)?p.crowKm:null,
          rank:Number.isInteger(p.rank)?p.rank:null,trackedHours:typeof p.trackedHours==='string'?p.trackedHours:null,
          retired:p.retired===true,finished:false,lat:null,lng:null,updatedAt:null,hasValidLocation:false,
        });
        if(all.some(p=>!validBib(p?.bib)||typeof p?.name!=='string'||!p.name||p.name.length>100))throw new Error('Invalid saved entry');
        const allCompetitors=all.map(convert),femaleSolo=female.map(convert);
        data={allCompetitors,femaleSolo,roster:allCompetitors,checkedAt:archive.date};
        status='archived';checkedAt=archive.date;
      }catch{status='unavailable';}
      finally {pending=null;render();emit();}
      return getSnapshot();
    })();
    return pending;
  }
  q('#competitor-search')?.addEventListener('input',event=>{searchTerm=event.target.value.slice(0,80);renderSearchResults();});
  document.addEventListener('click',event=>{
    if(event.target.closest('#leaderboard-find-emily')){open(EMILY);return;}
    const followBib=event.target.closest('[data-competitor-follow]')?.dataset.competitorFollow;
    if(followBib){if(Object.hasOwn(preferences.followed,followBib))unfollow(followBib);else if(!follow(followBib)){const limit=q('#competitor-follow-limit');if(limit)limit.textContent='Follow up to '+MAX_FOLLOWED+' competitors. Remove one to add another.';}return;}
    const unfollowBib=event.target.closest('[data-competitor-unfollow]')?.dataset.competitorUnfollow;if(unfollowBib)unfollow(unfollowBib);
    const locateBib=event.target.closest('[data-competitor-locate]')?.dataset.competitorLocate;
    if(locateBib){const p=byBib(locateBib);if(isLocation(p)){if(!isShown(locateBib))setShown(locateBib,true);window.dispatchEvent(new CustomEvent('competitorlocate',{detail:{bib:locateBib,lat:p.lat,lng:p.lng,stale:!isFresh(p),lastSeen:ageText(p)}}));}}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='leaderboard-category'){setLeaderboardCategory(event.target.value);return;}
    if(event.target.id==='leaderboard-overall'){setCompareOverall(event.target.checked);return;}
    const bib=event.target.dataset?.competitorVisible;if(bib)setShown(bib,event.target.checked);
  });
  window.addEventListener('online',()=>{if(!data)refresh();});
  window.addEventListener('viewchange',event=>{if(event.detail?.tab==='leaderboard'&&!data)refresh();});
  window.competitorGuide={getSnapshot,refresh,follow,unfollow,setShown,isShown,setFemaleSoloMap,setLeaderboardCategory,setCompareOverall,open,isFresh,mapType,mapCrowMarker,paceText};
  render();refresh();
})();
