/**
 * One-off post-race archive builder. Inputs are official Trail Live JSON
 * downloads obtained through the event's public participant/path endpoints.
 * Publishes only the subset with substantial geographic overlap with Emily,
 * preserving their recorded timestamps for honest historical playback.
 *
 * Usage: node scripts/build-peer-crows.mjs <download-dir> <roster-file>
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const inputDir=process.argv[2];
const rosterPath=process.argv[3];
if(!inputDir||!rosterPath)throw new Error('Expected download directory and roster path');
const replay=JSON.parse(readFileSync('public/data/emily-replay-2026.json','utf8'));
const participants=JSON.parse(readFileSync(rosterPath,'utf8'));
const start=Date.parse(replay.firstAt);
const toRadians=x=>x*Math.PI/180;
const distance=(a,b,c,d)=>{
 const x=toRadians(d-b)*Math.cos(toRadians((a+c)/2));
 const y=toRadians(c-a);
 return Math.hypot(x,y)*6371.0088;
};
const reference=replay.fixes.map(p=>[p[1],p[2]]);
// Point-to-segment distance in a locally projected kilometre plane, rather
// than just the nearest timestamp, since peers may be hours ahead or behind.
const nearKm=(lat,lng)=>{
 let min=Infinity;
 for(let i=1;i<reference.length;i++){
  const a=reference[i-1],b=reference[i];
  const c=Math.cos(toRadians(lat)),x1=(a[1]-lng)*111.195*c,y1=(a[0]-lat)*111.195;
  const x2=(b[1]-lng)*111.195*c,y2=(b[0]-lat)*111.195;
  const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,-(x1*dx+y1*dy)/(dx*dx+dy*dy||1)));
  const d=Math.hypot(x1+t*dx,y1+t*dy);
  if(d<min)min=d;
 }
 return min;
};
const tracks=[];const audit=[];
for(const p of participants){
 if(p.id===208495)continue;
 const file=join(inputDir,`peer-${p.id}.json`);
 if(!existsSync(file))continue;
 let raw;
 try{raw=JSON.parse(readFileSync(file,'utf8'));}catch{audit.push({bib:p.bib,result:'invalid-download'});continue;}
 if(!Array.isArray(raw)){audit.push({bib:p.bib,result:'not-a-path'});continue;}
 const points=[];const seen=new Set();
 for(const row of raw.sort((a,b)=>Date.parse(a.gnssTime)-Date.parse(b.gnssTime))){
  const t=(Date.parse(row.gnssTime)-start)/1000,lat=Number(row.lat),lng=Number(row.lon);
  if(!Number.isFinite(t)||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<51||lat>54||lng<-4||lng>1||seen.has(Math.round(t)))continue;
  seen.add(Math.round(t));
  if(points.length){
   const previous=points.at(-1),gap=t-previous[0];
   if(gap<=0||gap<600&&distance(lat,lng,previous[1],previous[2])>gap/3600*25+0.35)continue;
  }
  points.push([Math.round(t),+lat.toFixed(6),+lng.toFixed(6)]);
 }
 if(points.length<20){audit.push({bib:p.bib,result:'too-few-fixes',fixes:points.length});continue;}
 let overlapKm=0,overlapMinutes=0;
 let prevNear=nearKm(points[0][1],points[0][2]);
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],near=nearKm(b[1],b[2]),segment=distance(a[1],a[2],b[1],b[2]);
  if(prevNear<=.75&&near<=.75&&segment<3){overlapKm+=segment;overlapMinutes+=(b[0]-a[0])/60;}
  prevNear=near;
 }
 const included=overlapKm>=15;
 audit.push({bib:p.bib,name:p.name,overlapKm:+overlapKm.toFixed(2),included,fixes:points.length});
 if(included)tracks.push({bib:String(p.bib),name:p.name,group:p.group||'Other',ageCategory:p.ageCategory||'',overlapKm:+overlapKm.toFixed(1),overlapMinutes:Math.round(overlapMinutes),firstAt:new Date(start+points[0][0]*1000).toISOString(),lastAt:new Date(start+points.at(-1)[0]*1000).toISOString(),fixes:points});
}
tracks.sort((a,b)=>b.overlapKm-a.overlapKm);
const archived={source:'Trail Live · public Escape from Meriden 2026 tracker',eventId:35950,method:'Official GPS fix sequences; >=15 km of travelled segments with both ends within 750 m of Emily’s recorded route. Candidate screening used final report within 30 km of Emily’s route; runners who diverged farther may be absent.',screenedPaths:audit.length,matchingTracks:tracks.length,firstAt:replay.firstAt,tracks};
writeFileSync('public/data/emily-peer-crows-2026.json',JSON.stringify(archived));
writeFileSync('archive/peer-crow-screening-2026.json',JSON.stringify({source:archived.source,method:archived.method,screenedPaths:audit.length,matchingTracks:tracks.length,details:audit},null,2));
const bibCounts=new Map();
participants.forEach(p=>bibCounts.set(String(p.bib),(bibCounts.get(String(p.bib))||0)+1));
const rows=participants.filter(p=>/^\d{1,4}$/.test(String(p.bib))&&bibCounts.get(String(p.bib))===1&&p.name).map(p=>({bib:String(p.bib),name:p.name,group:p.group||'Other',ageCategory:p.ageCategory||'',crowKm:Number.isFinite(p.routes?.[0]?.dist)?p.routes[0].dist:null,trackedHours:p.routes?.[0]?.durn||null,retired:!!p.retired}));
const categories={all:()=>true,'female-solo':p=>p.group==='Solo'&&p.ageCategory==='F','male-solo':p=>p.group==='Solo'&&p.ageCategory==='M',pair:p=>p.group==='Pair',chained:p=>p.group==='Chained',other:p=>!(p.group==='Pair'||p.group==='Chained'||p.group==='Solo'&&['F','M'].includes(p.ageCategory))};
const leaders={};
for(const [category,fn] of Object.entries(categories))leaders[category]=rows.filter(fn).sort((a,b)=>(b.crowKm??-1)-(a.crowKm??-1)||Number(a.bib)-Number(b.bib)).map((p,i)=>({...p,rank:p.crowKm==null?null:i+1}));
writeFileSync('public/data/meriden-final-standings-2026.json',JSON.stringify({event:'Escape from Meriden',date:'2026-11-14',source:'Trail Live public tracker',metric:'km from Meriden as the crow flies',note:'Archived tracker snapshot, not an organiser-certified final results sheet. Cross-category ordering is an informal distance comparison.',totalUniqueEntrants:rows.length,categories:leaders}));
console.log(`Screened ${audit.length} GPS tracks; ${tracks.length} overlap Emily by at least 15 km. Standings: ${rows.length} unique entrants.`);
console.log(tracks.map(p=>`${p.bib.padStart(3)} ${p.name.padEnd(27)} ${p.overlapKm.toFixed(1)} km, ${p.fixes.length} fixes`).join('\n'));
