'use strict';
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.crewTravel=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const MINUTE=60000,MAX_AGE=5*MINUTE,MIN_REFRESH=2*MINUTE,BATCH_SIZE=40,MAX_DESTINATIONS=160,BATCH_GAP=1250;
  let state={status:'idle',checkedAt:null,origin:null,destinations:[],message:'Choose crew arrival to calculate road travel.'},inflight=null,lastAttempt=0,lastIds='';
  const finite=Number.isFinite;
  const SUPPORTERS={huiyan:'Huiyan',graham:'Graham',jeff:'Jeff',ben:'Ben'};
  function distance(a,b){const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad,x=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
  function driver(snapshot,now=Date.now()){
    const positions=snapshot&&Object.hasOwn(snapshot,'supporters')?snapshot.supporters||{}:{huiyan:snapshot?.crew};
    const plans=snapshot?.supporterPlans||{},hasPlans=Object.keys(SUPPORTERS).some(id=>['walking','meeting'].includes(plans[id]?.mode));
    const candidates=Object.entries(SUPPORTERS).flatMap(([id,name])=>{
      if(hasPlans?plans[id]?.mode!=='meeting':id!=='huiyan')return [];
      const p=positions[id],at=typeof p?.recordedAt==='string'?Date.parse(p.recordedAt):NaN;
      return p&&finite(p.lat)&&finite(p.lng)&&p.lat>=49&&p.lat<=61&&p.lng>=-9&&p.lng<=3&&p.fresh!==false&&p.sharing!==false&&finite(at)&&at>=now-MAX_AGE&&at<=now+30000?[{id,name,position:p}]:[];
    });
    return candidates.find(person=>person.id===snapshot?.sharing?.personId)||candidates.sort((a,b)=>Date.parse(b.position.recordedAt)-Date.parse(a.position.recordedAt))[0]||null;
  }
  function emit(){root.dispatchEvent?.(new root.CustomEvent('crewtravelupdate',{detail:getSnapshot()}));}
  function getSnapshot(){return {...state,destinations:state.destinations.map(p=>({...p}))};}
  function unavailable(message,reason='travel-unavailable'){return {status:'unavailable',arrivalTime:null,earliestArrivalTime:null,formattedTime:null,rangeText:'',source:'crew',note:message,reason};}
  async function refresh({pois=[],snapshot,force=false}={}){
    const now=Date.now(),person=driver(snapshot,now),crew=person?.position;
    if(!crew){state={...state,status:'unavailable',message:'A supporter meeting at the next stop needs a fresh shared position to calculate driving arrival.'};emit();return getSnapshot();}
    if(root.document?.hidden)return getSnapshot();
    // Load the nearest upcoming route stops first. Every destination still
    // resolves to a fixed deployed catalogue ID at the server.
    const candidates=pois.filter(p=>(p?.kinds?.includes('toilet')||p?.possibleToilet===true)&&typeof p.id==='string').sort((a,b)=>(finite(a.routeKm)?a.routeKm:Infinity)-(finite(b.routeKm)?b.routeKm:Infinity)||a.id.localeCompare(b.id));
    const ids=[...new Set(candidates.map(p=>p.id))].slice(0,MAX_DESTINATIONS);
    if(!ids.length)return getSnapshot();
    if(inflight)return inflight;
    const idKey=ids.join(','),cached=state.status==='ready'&&state.driverId===person.id&&state.complete!==false&&now-Date.parse(state.checkedAt)<MAX_AGE&&state.origin&&distance(crew,state.origin)<250&&idKey===lastIds;
    if(!force&&cached)return getSnapshot();
    if(now-lastAttempt<MIN_REFRESH&&state.driverId===person.id)return getSnapshot();
    lastAttempt=now;lastIds=idKey;state={...state,status:'loading',driverId:person.id,driverName:person.name,complete:false,pendingCount:ids.length,message:'Calculating road travel from '+person.name+'’s position…'};emit();
    const work=Promise.resolve().then(async()=>{
      const rows=new Map();let oldest=null,complete=true;
      try{
        for(let start=0;start<ids.length;start+=BATCH_SIZE){
          if(start)await new Promise(resolve=>root.setTimeout(resolve,BATCH_GAP));
          if(root.document?.hidden){complete=false;break;}
          const batchIds=ids.slice(start,start+BATCH_SIZE);
          const response=await root.fetch('/api/toilet-arrivals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:{lat:crew.lat,lng:crew.lng,recordedAt:crew.recordedAt},ids:batchIds}),signal:AbortSignal.timeout(11000)});
          if(!response.ok)throw Error('unavailable');
          const data=await response.json(),at=Date.parse(data.computedAt),received=Date.now();
          if(data.status!=='ready'||!finite(at)||at<received-MAX_AGE||at>received+30000||!data.origin||!finite(data.origin.lat)||!finite(data.origin.lng)||!Array.isArray(data.destinations))throw Error('unavailable');
          oldest=oldest===null?at:Math.min(oldest,at);
          for(const p of data.destinations)if(batchIds.includes(p.id))rows.set(p.id,{id:p.id,durationSeconds:finite(p.durationSeconds)&&p.durationSeconds>=0&&p.durationSeconds<=21600?p.durationSeconds:null,distanceMetres:finite(p.distanceMetres)&&p.distanceMetres>=0&&p.distanceMetres<=400000?p.distanceMetres:null});
          const remaining=Math.max(0,ids.length-start-batchIds.length);
          state={status:'ready',driverId:person.id,driverName:person.name,checkedAt:new Date(oldest).toISOString(),origin:data.origin,destinations:[...rows.values()],complete:remaining===0,pendingCount:remaining,message:remaining?'Calculating more café and toilet stops…':'Road travel if you leave now; no live traffic. Allow time to park and enter.'};
          emit();
        }
      }catch{complete=false;}
      if(!complete)state=rows.size?{...state,complete:false,message:'Some road estimates are still unavailable. The available estimates remain visible; try again shortly.'}:{...state,status:'unavailable',complete:false,message:'Road travel is unavailable. Toilet hours remain visible; no driving ETA has been guessed.'};
      return getSnapshot();
    });
    inflight=work;
    try{return await work;}finally{if(inflight===work)inflight=null;emit();}
  }
  function estimate({poi,snapshot,now=Date.now()}={}){
    const person=driver(snapshot,now),crew=person?.position;
    if(!crew)return unavailable('A supporter meeting at the next stop needs a fresh shared position for a driving ETA.','stale-crew');
    if(state.status!=='ready'||state.driverId!==person.id||!state.origin||now-Date.parse(state.checkedAt)>MAX_AGE||distance(crew,state.origin)>300)return unavailable(state.status==='loading'?'Calculating '+person.name+'’s road travel…':'Waiting for a current road-travel estimate.','travel-unavailable');
    const row=state.destinations.find(p=>p.id===poi?.id);
    if(!row)return unavailable(state.complete===false?'This café or toilet’s road estimate is still pending.':'No usable driving route is available to this stop.','travel-unavailable');
    if(!finite(row.durationSeconds)||!finite(row.distanceMetres))return unavailable('No usable driving route is available to this stop.','no-road-route');
    const early=now+row.durationSeconds*1000,late=early+5*MINUTE,clock=root.toiletHours?.clock||((at)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at));
    return {status:'ready',earliestArrivalTime:early,arrivalTime:late,formattedTime:clock(late,now),rangeText:clock(early,now)+'–'+clock(late,now),source:'crew',driverId:person.id,driverName:person.name,checkedAt:Date.parse(state.checkedAt),durationSeconds:row.durationSeconds,distanceMetres:row.distanceMetres,note:'Driving if '+person.name+' leaves now, from their latest shared position. Includes up to 5 min for parking and walking in. Road estimate by OSRM / FOSSGIS; no live traffic or guaranteed parking.'};
  }
  return {refresh,getSnapshot,estimate,driver};
});
