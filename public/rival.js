'use strict';
(() => {
  // A separate, read-only feed. It never contributes to the family's route,
  // pace, ETA, next meet-up or location-sharing controls.
  const IDENTITY={id:'madlis',name:'Matt Leese',shortName:'Matt',bib:'210',icon:'😈',avatar:'/assets/avatars-v5/matt.webp'};
  const INTERVAL_MS=30000,FRESH_MS=300000,MAX_FUTURE_MS=30000;
  const HISTORY_MS=120*60000,RECENT_MS=20*60000,MAX_HISTORY=120;
  const STATUSES=new Set(['waiting','live','not-found','unavailable','wrong-event','ambiguous','need-number']);
  let participant=null,status='waiting',checkedAt=null,cached=false,pending=null;
  let routeCoords=[],routeCumulative=[];
  const projectedReports=new WeakMap();
  const time=value=>typeof value==='string'?Date.parse(value):NaN;
  const validCoordinates=p=>p&&typeof p.lat==='number'&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&typeof p.lng==='number'&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180;
  const normaliseBib=value=>String(value??'').trim().replace(/^0+(?=\d)/,'');
  const cleanName=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120):'';
  const validReport=p=>validCoordinates(p)&&Number.isFinite(time(p.updatedAt))&&time(p.updatedAt)<=Date.now()+MAX_FUTURE_MS;
  const crowDistance=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000?value:null;

  function haversine(a,b){const rad=Math.PI/180,dy=(b[1]-a[1])*rad,dx=(b[0]-a[0])*rad,s=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
  function project(p){
    if(!validCoordinates(p)||routeCoords.length<2)return null;
    const previous=projectedReports.get(p);if(previous?.route===routeCoords)return previous.value;
    let best=null;const scale=Math.cos(p.lat*Math.PI/180);
    for(let i=0;i<routeCoords.length-1;i++){
      const a=routeCoords[i],b=routeCoords[i+1],x=(a[0]-p.lng)*scale,y=a[1]-p.lat,dx=(b[0]-a[0])*scale,dy=b[1]-a[1],den=dx*dx+dy*dy;
      const fraction=den?Math.max(0,Math.min(1,-(x*dx+y*dy)/den)):0;
      const pin=[a[0]+fraction*(b[0]-a[0]),a[1]+fraction*(b[1]-a[1])],offset=haversine([p.lng,p.lat],pin);
      if(!best||offset<best.offRouteM)best={routeKm:(routeCumulative[i]+fraction*(routeCumulative[i+1]-routeCumulative[i]))/1000,offRouteM:offset};
    }
    projectedReports.set(p,{route:routeCoords,value:best});return best;
  }
  function projectReports(reports){
    return (reports||[]).map(report=>{const pin=project(report);return {...report,routeKm:pin?.routeKm??null,offRouteM:pin?.offRouteM??null};});
  }
  function retainHistory(previous,incoming,current){
    const end=time(current.updatedAt),reports=new Map();
    const combined=[...(previous?.paceReports||[]),...(previous?.recentReports||[]),
      ...(Array.isArray(incoming?.paceReports)?incoming.paceReports:[]),...(Array.isArray(incoming?.recentReports)?incoming.recentReports:[])];
    for(const report of combined){
      const at=time(report?.recordedAt||report?.updatedAt);
      if(!validCoordinates(report)||!Number.isFinite(at)||at<end-HISTORY_MS||at>end)continue;
      reports.set(at,{lat:report.lat,lng:report.lng,recordedAt:new Date(at).toISOString()});
    }
    // The participant point is authoritative at its timestamp. A response
    // without history does not erase useful samples from earlier polls.
    reports.set(end,{lat:current.lat,lng:current.lng,recordedAt:current.updatedAt});
    const paceReports=[...reports.entries()].sort((a,b)=>a[0]-b[0]).slice(-MAX_HISTORY).map(entry=>entry[1]);
    return {paceReports,recentReports:paceReports.filter(report=>time(report.recordedAt)>=end-RECENT_MS)};
  }

  function getSnapshot(){
    const recordedAt=participant?.updatedAt||null;
    const ageMs=recordedAt?Math.max(0,Date.now()-time(recordedAt)):null;
    const usable=Boolean(participant&&validReport(participant));
    const fresh=Boolean(usable&&ageMs<FRESH_MS&&!participant.finished&&!participant.retired);
    const projection=usable?project(participant):null;
    const recentReports=projectReports(participant?.recentReports),paceReports=projectReports(participant?.paceReports);
    const position=usable?{lat:participant.lat,lng:participant.lng,recordedAt,updatedAt:recordedAt,fresh,reportCached:cached,
      finished:Boolean(participant.finished),retired:Boolean(participant.retired),
      routeKm:fresh&&projection?.offRouteM<500?projection.routeKm:null,projectedRouteKm:projection?.routeKm??null,offRouteM:projection?.offRouteM??null,
      routeLengthKm:routeCumulative.length?routeCumulative.at(-1)/1000:null}:null;
    const pace=position?window.arrivalEta?.derivePace?.({runner:position,reports:recentReports,now:Date.now()}):null;
    if(position)Object.assign(position,{speedKmh:pace?.speedKmh??null,paceMinPerKm:pace?.paceMinPerKm??null,paceSource:pace?.paceSource??null,paceWindowMinutes:pace?.paceWindowMinutes??null});
    const paceMessage=pace?'Estimated moving route pace from Matt’s GPS reports, excluding stationary time.'
      :!position?'Waiting for Matt’s GPS report.':participant.retired?'Matt is marked retired.':participant.finished?'Matt is marked finished.'
      :!fresh?'Waiting for a fresh Matt tracker report.':projection?.offRouteM>=500?'Matt is away from our planned route; route pace is unavailable.'
      :!projection?'The planned route is still loading.':'Waiting for enough recent moving Matt GPS reports to estimate route pace.';
    const messages={
      waiting:'Waiting for Matt’s tracker report.',
      'not-found':'Bib 210 is not currently listed by the event tracker.',
      unavailable:position?'Matt’s tracker is temporarily unavailable. Showing his last report.':'Matt’s tracker is temporarily unavailable.',
      'wrong-event':'Matt’s tracker is unavailable for this event.',
      ambiguous:'The event tracker has more than one entry for bib 210.',
      'need-number':'Waiting for the event tracker to confirm bib 210.'
    };
    return {...IDENTITY,name:participant?.name||IDENTITY.name,status,checkedAt,position,recentReports,paceReports,
      routeKm:position?.routeKm??null,speedKmh:pace?.speedKmh??null,paceMinPerKm:pace?.paceMinPerKm??null,paceSource:pace?.paceSource??null,paceWindowMinutes:pace?.paceWindowMinutes??null,paceMessage,
      crowKm:usable?participant.crowKm:null,finished:Boolean(participant?.finished),retired:Boolean(participant?.retired),fresh,cached,ageMs,
      message:status==='live'?(participant?.retired?'Matt is marked as retired.':participant?.finished?'Matt is marked as finished.':fresh?'Matt’s latest tracker report.':'Showing Matt’s last tracker report.'):messages[status]};
  }
  function emit(){window.dispatchEvent(new CustomEvent('rivalupdate',{detail:getSnapshot()}));}

  function accept(result){
    status=STATUSES.has(result?.status)?result.status:'unavailable';
    checkedAt=new Date().toISOString();
    const matches=(Array.isArray(result?.participants)?result.participants:[]).filter(p=>normaliseBib(p?.bib)===IDENTITY.bib);
    if(matches.length>1){status='ambiguous';participant=null;cached=false;return;}
    if(result?.event?.active===false){status='waiting';participant=null;cached=false;return;}
    if(status==='live'){
      const report=matches[0];
      if(matches.length!==1){status='not-found';participant=null;cached=false;return;}
      if(!validReport(report)){status='waiting';participant=null;cached=false;return;}
      const next={lat:report.lat,lng:report.lng,updatedAt:report.updatedAt,name:cleanName(report.name)||IDENTITY.name,
        crowKm:crowDistance(report.crowKm),finished:report.finished===true,retired:report.retired===true};
      if(participant&&time(next.updatedAt)<time(participant.updatedAt)){
        // Delayed provider responses cannot move his marker backwards in time.
        // The previous timestamp also ensures a cached point ages honestly.
        participant={...participant,...retainHistory(participant,report,participant),finished:next.finished,retired:next.retired};cached=true;
      }else{participant={...next,...retainHistory(participant,report,next)};cached=false;}
      return;
    }
    if(status==='unavailable'){cached=Boolean(participant);return;}
    participant=null;cached=false;
  }

  function refresh(){
    if(document.hidden)return Promise.resolve(getSnapshot());
    if(pending)return pending;
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),15000);
    pending=(async()=>{
      try{
        const response=await fetch('/api/tracker?bib='+IDENTITY.bib,{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
        if(!response.ok)throw new Error('Tracker unavailable');
        const result=await response.json();
        accept(result);
      }catch{status='unavailable';checkedAt=new Date().toISOString();cached=Boolean(participant);}
      finally{clearTimeout(deadline);pending=null;emit();}
      return getSnapshot();
    })();
    return pending;
  }

  window.rivalGuide={getSnapshot,refresh};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('online',refresh);
  setInterval(()=>{if(!document.hidden)refresh();},INTERVAL_MS);
  fetch('/data/route.geojson').then(response=>{if(!response.ok)throw new Error('Route unavailable');return response.json();}).then(geo=>{
    const coordinates=geo.coordinates||geo.geometry?.coordinates;if(!Array.isArray(coordinates))return;
    routeCoords=coordinates.filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Math.abs(p[0])<=180&&Number.isFinite(p[1])&&Math.abs(p[1])<=90);
    routeCumulative=[0];for(let i=1;i<routeCoords.length;i++)routeCumulative.push(routeCumulative[i-1]+haversine(routeCoords[i-1],routeCoords[i]));emit();
  }).catch(()=>{});
  refresh();
})();
