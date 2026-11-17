'use strict';
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.raceMilestones=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const definitions=Object.freeze([
    Object.freeze({id:'marathon',label:'Marathon',basis:'route',thresholdKm:42.195,radiusKm:null,posterId:'marathon',detail:'42.195 km along the planned route · approximate'}),
    Object.freeze({id:'silver',label:'Silver ring',basis:'crow',thresholdKm:48.28032,radiusKm:48.28032,detail:'30 miles from Meriden as the crow flies · estimated boundary'}),
    Object.freeze({id:'gold',label:'Gold ring',basis:'crow',thresholdKm:96.56064,radiusKm:96.56064,posterId:'gold',detail:'60 miles from Meriden as the crow flies · estimated boundary'}),
    ...[50,60,70,80,90,100,110,120,123].map(km=>Object.freeze({id:'km-'+km,label:km+' km',basis:'route',thresholdKm:km,radiusKm:null,posterId:'km-'+km,hiddenUntilReached:true,detail:km+' km along the planned route · approximate'})),
  ]);
  const originDefault=Object.freeze({lat:52.4379,lng:-1.6496});
  function distanceKm(a,b){
    const r=Math.PI/180,y=(b.lat-a.lat)*r,x=(b.lng-a.lng)*r;
    const s=Math.sin(y/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(x/2)**2;
    return 6371.0088*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));
  }
  function routePoints(route){
    let value=route;
    if(value?.type==='FeatureCollection')value=value.features?.find(f=>f.geometry?.type==='LineString')?.geometry;
    if(value?.type==='Feature')value=value.geometry;
    if(value?.type==='LineString')value=value.coordinates.map(([lng,lat])=>({lat,lng}));
    if(!Array.isArray(value))return [];
    return value.map(p=>Array.isArray(p)?{lat:p[0],lng:p[1]}:p)
      .filter(p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180);
  }
  function build(route,origin=originDefault){
    const points=routePoints(route);
    if(points.length<2||!Number.isFinite(origin?.lat)||!Number.isFinite(origin?.lng))return [];
    let total=0;
    const path=points.map((p,i)=>{if(i)total+=distanceKm(points[i-1],p);return {...p,routeKm:total};});
    const interpolate=(a,b,t)=>({lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t,routeKm:a.routeKm+(b.routeKm-a.routeKm)*t});
    return definitions.map(def=>{
      let crossing=null;
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i];
        const before=def.basis==='route'?a.routeKm:distanceKm(origin,a);
        const after=def.basis==='route'?b.routeKm:distanceKm(origin,b);
        if(before<def.thresholdKm&&after>=def.thresholdKm){
          let low=0,high=1;
          for(let step=0;step<30;step++){
            const t=(low+high)/2,p=interpolate(a,b,t),metric=def.basis==='route'?p.routeKm:distanceKm(origin,p);
            if(metric>=def.thresholdKm)high=t;else low=t;
          }
          crossing=interpolate(a,b,(low+high)/2);break;
        }
      }
      return {...def,...(crossing||{lat:null,lng:null,routeKm:null}),
        crowKm:crossing?distanceKm(origin,crossing):null,origin:{...origin},estimated:true};
    });
  }
  function estimate(input={}){
    if(!root.meetingForecast?.estimate)return {status:'unavailable',rangeText:'',reason:'engine-unavailable'};
    return root.meetingForecast.estimate({snapshot:input.snapshot,point:input.milestone||input.point,now:input.now});
  }
  // Existing records are a history, not a new celebration queue. The host
  // should acknowledge its initial set before reacting to fresh additions.
  function mergeRecords(...sets){
    const records=new Map();
    for(const set of sets)for(const record of Array.isArray(set)?set:[]){
      if(record?.eventId!==35950||!['emily','jeff'].includes(record.runnerId)||!definitions.some(d=>d.id===record.milestoneId))continue;
      if(record.milestoneId.startsWith('km-')&&record.runnerId!=='emily')continue;
      if(record.id!==`${record.eventId}:${record.runnerId}:${record.milestoneId}`||!Number.isFinite(Date.parse(record.firstSeenBeyondAt)))continue;
      if(!records.has(record.id))records.set(record.id,record);
    }
    return [...records.values()].sort((a,b)=>Date.parse(a.crossedAt||a.firstSeenBeyondAt)-Date.parse(b.crossedAt||b.firstSeenBeyondAt)||a.id.localeCompare(b.id));
  }
  return {definitions,origin:originDefault,build,estimate,distanceKm,mergeRecords};
});
