import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Rebuild the researched enrichment without changing existing stable IDs or kinds.
// Coordinates are taken only from research records; this script does not geocode.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const target=path.join(root,'public/data/facilities.json');
const data=read('public/data/facilities.json');
const before=structuredClone(data.pois);
const byId=new Map(data.pois.map(p=>[p.id,p]));
const aliases={'tesco-towcester-toilet':'tesco-towcester'};
const skipped=[];
const added=[];
const refreshed=new Set();
const daily=(start,end)=>Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),[[start,end]]]));
const unknown=()=>Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),null]));
const weekWithSunday=(start,end,sunday)=>({...daily(start,end),'0':sunday});
const venue=weekly=>({timeZone:'Europe/London',basis:'venue',weekly});

// Existing source-backed hours, already retained with the facilities data.
// Forecourt/retail schedules remain venue hours, never guaranteed toilet hours.
const existingSchedules={
  'binley-road-toilet':venue(daily('00:00','24:00')),
  'mfg-coventry':venue(daily('00:00','24:00')),
  'morrisons-binley-toilet':venue(weekWithSunday('07:00','22:00',[['10:00','16:00']])),
  'wolston-library-toilet':{...venue({'0':[],'1':[['14:30','17:00']],'2':[['14:30','17:00']],'3':[['14:30','17:00']],'4':[['10:30','13:00']],'5':[['10:30','13:00']],'6':[['10:30','13:00']]}),bankHolidaysClosed:true},
  'mangrove-texaco-toilet':venue(daily('00:00','24:00')),
  'waitrose-daventry':venue(weekWithSunday('07:30','20:00',[['10:00','16:00']])),
  'coffee1-daventry':venue({...daily('07:00','19:00'),'0':[['09:00','17:00']],'6':[['08:00','18:00']]}),
  'osprey-daventry':venue(daily('05:00','23:45')),
  'tove-long-stay':venue(daily('00:00','24:00')),
  'tove-short-stay':venue(daily('00:00','24:00')),
  'cofferidge-close':{timeZone:'Europe/London',basis:'unknown',weekly:unknown()},
  'starbucks-bletchley':venue({...daily('06:00','20:00'),'0':[['08:00','19:00']],'6':[['07:00','20:00']]}),
  'starbucks-checkley':venue(weekWithSunday('06:00','20:00',[['07:30','20:00']]))
};
for(const [id,opening] of Object.entries(existingSchedules))if(byId.has(id))byId.get(id).opening=opening;

// Combine overlapping entries while retaining parking/charging/cafe conditions.
const combinedAccess={
  'tesco-towcester':'Standard and accessible customer toilets, step-free toilet facilities and baby changing are listed. AccessAble places the toilets to the right on entering, about 20 metres from the entrance. Parking and EV charging are listed; check Pod for connector, power and availability. Facilities can have different hours from the shop; ask staff for toilet access.',
  'cherry-lane-roman-way':'Customer toilets, baby changing, free customer parking and Wellington’s café are listed by the operator. Separate toilet-door times are not published and café service times can differ. Confirm vegan choices and allergens at the café.',
  'silver-street-toilets':'Public toilets are confirmed by The Parks Trust. Opening hours, price and any key/access requirements remain unconfirmed; check the door. An ETA alone cannot confirm that these toilets will be open.',
  'costa-stony-stratford':'The official store page lists an accessible toilet and baby changing. Customer facility; check access with staff. Opening times are café hours, not a separate toilet-door schedule.',
  'sainsburys-shenley':'The official Argos/Sainsbury’s listing confirms accessible customer toilets and parking. Follow parking signs and ask staff about access. Opening times are store hours; individual facilities can close earlier.',
  'ashton-square-toilets':'Council public toilets with male/female facilities, baby changing and an accessible toilet. AccessAble lists RADAR access for the accessible cubicle. This is a town-centre backup beyond the planned Chalk Hill endpoint, not an on-route stop. Current council hours start at 09:30; older sources give earlier opening, so use the later time and check locally. Closed Sundays and bank holidays.'
};
const mergeSources=(a=[],b=[])=>Array.from(new Map([...a,...b].map(s=>[s.url,s])).values());
for(const file of ['docs/research/toilets-north-20261114.json','docs/research/toilets-south-20261114.json']){
  for(const proposed of read(file)){
    const id=aliases[proposed.id]||proposed.id;
    const old=byId.get(id);
    if(!old&&(!Number.isFinite(proposed.lat)||!Number.isFinite(proposed.lng))){skipped.push(id);continue;}
    if(!old){
      const p={...structuredClone(proposed),id,nearPointIds:[],mapQuery:proposed.name+' '+proposed.address};
      byId.set(id,p);data.pois.push(p);added.push(id);
      continue;
    }
    const stable={id:old.id,name:old.name,mapLabel:old.mapLabel,kinds:[...new Set([...old.kinds,...proposed.kinds])],lat:old.lat,lng:old.lng,nearPointIds:old.nearPointIds,routeKm:old.routeKm,routeOffsetM:old.routeOffsetM,coordinateNote:old.coordinateNote};
    const oldAccess=old.access,oldSources=old.sources;
    const restricted=id==='esso-dunchurch-toilet'?{hours:old.hours,hoursLabel:old.hoursLabel,access:old.access}:null;
    Object.assign(old,structuredClone(proposed),stable);
    if(!old.mapLabel)old.mapLabel=proposed.mapLabel||old.name;
    if(!old.coordinateNote)old.coordinateNote=proposed.coordinateNote;
    old.sources=mergeSources(oldSources,proposed.sources);
    old.access=combinedAccess[id]||oldAccess||proposed.access;
    if(restricted)Object.assign(old,restricted);
    refreshed.add(id);
  }
}

// Keep the original evidence conflict: published 24-hour fuel availability is
// not a guarantee of a 24-hour shop/toilet. Never infer closure or access at night.
if(byId.has('esso-dunchurch-toilet')){
  const p=byId.get('esso-dunchurch-toilet');
  p.opening={timeZone:'Europe/London',basis:'conflicting',weekly:unknown()};
  p.evidence='Esso lists customer toilets and a 24-hour station; the retained retailer-fed source lists a 06:00–22:00 shop with 24-hour fuel separately. Toilet access remains unconfirmed.';
  p.notes='Conflicting hours are deliberately excluded from a definite open-at-arrival result. Ask or call staff, particularly overnight.';
}

// Identical projection to public/live.js: equirectangular segment fraction,
// haversine offset and haversine cumulative distance with radius 6371008.8 m.
const geo=read('public/data/route.geojson');
const coords=(geo.coordinates||geo.geometry?.coordinates||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
if(coords.length<2)throw new Error('Route must contain at least two valid coordinates');
function haversine(a,b){const rad=Math.PI/180,dy=(b[1]-a[1])*rad,dx=(b[0]-a[0])*rad,s=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
const cumulative=[0];for(let i=1;i<coords.length;i++)cumulative.push(cumulative[i-1]+haversine(coords[i-1],coords[i]));
function project(p){
  let best=null;const scale=Math.cos(p.lat*Math.PI/180);
  for(let i=0;i<coords.length-1;i++){
    const a=coords[i],b=coords[i+1],x=(a[0]-p.lng)*scale,y=a[1]-p.lat,dx=(b[0]-a[0])*scale,dy=b[1]-a[1],den=dx*dx+dy*dy;
    const fraction=den?Math.max(0,Math.min(1,-(x*dx+y*dy)/den)):0;
    const projected=[a[0]+fraction*(b[0]-a[0]),a[1]+fraction*(b[1]-a[1])];
    const offset=haversine([p.lng,p.lat],projected);
    if(!best||offset<best.offRouteM)best={routeKm:(cumulative[i]+fraction*(cumulative[i+1]-cumulative[i]))/1000,offRouteM:offset};
  }
  return best;
}
for(const id of added){const p=byId.get(id),projection=project(p);p.routeKm=Math.round(projection.routeKm*10)/10;p.routeOffsetM=Math.round(projection.offRouteM);}

// Validate published records, schedule intervals and all route projections.
const ids=new Set();
const allowedBasis=new Set(['toilet','venue','conflicting','unknown']);
const minute=s=>s==='24:00'?1440:Number(s.slice(0,2))*60+Number(s.slice(3));
const validTime=s=>typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(s);
for(const p of data.pois){
  if(ids.has(p.id))throw new Error('Duplicate ID: '+p.id);ids.add(p.id);
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw new Error('Bad coordinates: '+p.id);
  if(!Array.isArray(p.kinds)||!p.kinds.length)throw new Error('Missing kinds: '+p.id);
  const opening=p.opening;
  if(!opening||opening.timeZone!=='Europe/London'||!allowedBasis.has(opening.basis))throw new Error('Invalid opening metadata: '+p.id);
  if(Object.keys(opening.weekly||{}).sort().join(',')!=='0,1,2,3,4,5,6')throw new Error('Incomplete opening week: '+p.id);
  for(const intervals of Object.values(opening.weekly)){
    if(intervals===null)continue;
    if(!Array.isArray(intervals))throw new Error('Invalid intervals: '+p.id);
    let previousEnd=-1;
    for(const interval of intervals){
      if(!Array.isArray(interval)||interval.length!==2||!interval.every(validTime)||minute(interval[0])>=minute(interval[1])||minute(interval[0])<previousEnd)throw new Error('Invalid/overlapping hours: '+p.id);
      previousEnd=minute(interval[1]);
    }
  }
  const expected=project(p);
  if(!Number.isFinite(p.routeKm)||!Number.isFinite(p.routeOffsetM)||p.routeOffsetM<0||Math.abs(expected.routeKm-p.routeKm)>.051||Math.abs(expected.offRouteM-p.routeOffsetM)>1)throw new Error('Projection mismatch: '+p.id);
}
for(const original of before){
  const result=byId.get(original.id);
  if(!result||original.kinds.some(kind=>!result.kinds.includes(kind)))throw new Error('Lost existing facility/kind: '+original.id);
  if(result.lat!==original.lat||result.lng!==original.lng||result.routeKm!==original.routeKm||result.routeOffsetM!==original.routeOffsetM)throw new Error('Existing pin/projection changed: '+original.id);
}
data.checkedOn='2026-11-14';
data.notLiveAvailability=true;
data.openingHoursNote='Schedules use Europe/London local time. Toilet-specific hours are distinguished from venue hours; venue opening does not guarantee toilet access. Unknown or conflicting hours cannot establish availability at an ETA.';
fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n');
const toilets=data.pois.filter(p=>p.kinds.includes('toilet'));
console.log(JSON.stringify({facilities:data.pois.length,toilets:toilets.length,added,refreshed:[...refreshed],researchOnly:skipped,routeKm:cumulative.at(-1)/1000,maxOffsetM:Math.max(...data.pois.map(p=>p.routeOffsetM)),maxNewOffsetM:Math.max(0,...added.map(id=>byId.get(id).routeOffsetM)),byOpeningBasis:Object.fromEntries([...allowedBasis].map(basis=>[basis,toilets.filter(p=>p.opening.basis===basis).length]))},null,2));
