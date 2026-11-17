/** Reproducible, offline snapshot of Emily's official 2026 race GPS and crew checks. */
import {readFile,writeFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const gps=await read('archive/emily-tracker-raw-2026.json');
const crew=await read('archive/emily-crew-history-2026.json');
const points=(await read('public/data/support-points.json')).groups.flatMap(g=>g.options.map(p=>({...p,town:p.town||g.town})));
const start=(await read('public/data/guide-data.json')).start;
const rad=Math.PI/180;
const haversine=(a,b)=>{
 const dLat=(b.lat-a.lat)*rad,dLon=((b.lng??b.lon)-(a.lng??a.lon))*rad;
 const x=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
 return 12742*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};
const fix=gps.map(item=>({t:Date.parse(item.gnssTime),lat:item.lat,lng:item.lon})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).sort((a,b)=>a.t-b.t);
if(fix.length<700||fix.at(-1).t-fix[0].t<23*3600000)throw new Error('Complete official GPS archive required');
let distance=0;
for(let i=0;i<fix.length;i++){if(i)distance+=haversine(fix[i-1],fix[i]);fix[i].routeKm=distance;}
const startTime=fix[0].t,endTime=fix.at(-1).t;
const byTime=t=>{
 const index=fix.findIndex(p=>p.t>=t);
 if(index<0)return fix.at(-1);
 if(!index)return fix[0];
 const a=fix[index-1],b=fix[index],fraction=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t||1)));
 return {t,lat:a.lat+(b.lat-a.lat)*fraction,lng:a.lng+(b.lng-a.lng)*fraction,routeKm:a.routeKm+(b.routeKm-a.routeKm)*fraction};
};
const meetingEntries=Object.entries(crew.checkpointStatuses||{}).filter(([,v])=>v.status==='met').sort((a,b)=>Date.parse(a[1].at)-Date.parse(b[1].at));
const meetings=meetingEntries.map(([id,value])=>{
 const pin=points.find(p=>p.id===id),t=Date.parse(value.at);
 const around=fix.map((p,i)=>({i,p,d:pin?haversine(pin,p):Infinity})).filter(({p})=>Math.abs(p.t-t)<=45*60000);
 const closest=around.sort((a,b)=>a.d-b.d)[0];
 // A crew check-in records arrival, not departure. Estimate only a continuous
 // nearby cluster around the closest fix; otherwise report duration unknown.
 let low=closest?.i,high=closest?.i;
 if(closest&&closest.d<=0.4){
  while(low>0&&fix[low].t-fix[low-1].t<=8*60000&&haversine(fix[low-1],fix[closest.i])<=0.14)low--;
  while(high<fix.length-1&&fix[high+1].t-fix[high].t<=8*60000&&haversine(fix[high+1],fix[closest.i])<=0.14)high++;
 }
 const duration=closest&&closest.d<=0.4&&high>low?(fix[high].t-fix[low].t)/60000:null;
 return {
  id,title:pin?.label||id,place:pin?.town||'Along the route',at:value.at,
  lat:closest?.d<=0.8?closest.p.lat:(pin?.lat??byTime(t).lat),
  lng:closest?.d<=0.8?closest.p.lng:(pin?.lng??byTime(t).lng),
  recorded:'crew check-in',
  durationMinutes:duration!=null&&duration>=3?Math.round(duration):null,
  durationNote:duration!=null&&duration>=3?'Approximate time within 140 m of the GPS stop; not a stopwatch reading.':'A separate stopped duration cannot be confirmed from two-minute GPS fixes.',
  distanceFromPinM:closest?Math.round(closest.d*1000):null
 };
});
const labels={marathon:'A marathon together!',silver:'Silver distance',gold:'Gold distance! ✨',...Object.fromEntries([50,60,70,80,90,100,110].map(x=>['km-'+x,x+' km on foot']))};
const milestones=(crew.achievements?.records||[]).filter(x=>x.runnerId==='emily').map(record=>{
 const gpsAt=byTime(Date.parse(record.crossedAt));
 return {id:record.milestoneId,title:labels[record.milestoneId]||record.milestoneId,at:record.crossedAt,lat:gpsAt.lat,lng:gpsAt.lng,routeKm:gpsAt.routeKm,recorded:'estimated crossing from official tracker',estimated:Boolean(record.estimated)};
}).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
const stories=[
 {at:'2026-11-13T23:59:03Z',title:'Two siblings. One enormous escape. 🧡',text:'Emily and Jeff set off together from Meriden. Some siblings just go for coffee.',people:['emily','jeff'],kind:'crew story'},
 {at:'2026-11-14T06:44:24Z',title:'A marathon in the bag! 👟',text:'Emily and Jeff shared the first marathon. Jeff later swapped running shoes for cheering duty.',people:['emily','jeff'],kind:'crew story'},
 {at:'2026-11-14T10:08:25Z',title:'Walking company, delivered 🥾',text:'Graham joined Emily on foot for long stretches. Those miles were a team effort.',people:['emily','graham'],kind:'crew story — timing illustrative'},
 {at:'2026-11-14T15:00:56Z',title:'The getaway crew rolls on 🚙',text:'Ben helped with the driving and rendezvous. Jeff and Huiyan coordinated the support-car hellos and supplies.',people:['ben','jeff','huiyan'],kind:'crew story — timing illustrative'},
 {at:'2026-11-14T21:49:26Z',title:'A cheer from the warmest seat 💛',text:'Susan followed Emily’s little moving dot from home, cheering all the way. Hi, Mum!',people:['susan'],kind:'crew story — timing illustrative'},
 {at:new Date(endTime).toISOString(),title:'The great escape is complete! 🏆',text:'Freezing fingers, warm hugs, unstoppable heart. Emily finishes with a gold-distance escape and 2nd female solo!',people:['emily','jeff','graham','ben','susan','huiyan'],kind:'recorded GPS finish + crew story'}
];
const archive={
 event:'Escape from Meriden 2026',runner:'Emily Simmons',bib:'247',date:'2026-11-14',
 sources:{gps:'Official Trail Live participant 208495 path, downloaded 15 November 2026',meetings:'Crow Crew public check-in state archived 15 November 2026',milestones:'Saved estimated official tracker crossings',crewStories:'Family recollections; times illustrative unless otherwise indicated'},
 firstAt:new Date(startTime).toISOString(),lastAt:new Date(endTime).toISOString(),
 final:{fixes:fix.length,elapsedMinutes:Math.round((endTime-startTime)/60000),gpsPathKm:Math.round(distance*100)/100,crowKm:106.498,femaleSoloPlace:2,award:'Gold distance'},
 start:{lat:start.lat,lng:start.lng},
 fixes:fix.map(p=>[Math.round((p.t-startTime)/1000),Number(p.lat.toFixed(6)),Number(p.lng.toFixed(6)),Number(p.routeKm.toFixed(3))]),
 meetings,milestones,stories
};
await writeFile(new URL('public/data/emily-replay-2026.json',root),JSON.stringify(archive));
console.log(`Saved ${fix.length} GPS fixes, ${meetings.length} crew check-ins and ${milestones.length} Emily milestones`);
console.log(`GPS sampled path ${distance.toFixed(2)} km; crow distance ${archive.final.crowKm} km; ${archive.final.elapsedMinutes} min elapsed`);
for(const m of meetings)console.log(`${m.at.slice(11,16)} ${m.title} ${m.place} · ${m.durationMinutes??'?'} min GPS dwell · nearest ${m.distanceFromPinM} m`);
