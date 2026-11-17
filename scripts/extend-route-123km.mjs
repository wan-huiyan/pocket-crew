// Extend only the historical 2025 planning line, not anyone's live route or GPS.
// The original ~106 km and gold geometry are left untouched at the start.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const read=async name=>JSON.parse(await readFile(new URL('../public/data/'+name,import.meta.url),'utf8'));
const write=async(name,value)=>writeFile(new URL('../public/data/'+name,import.meta.url),JSON.stringify(value)+(name==='support-points.json'?'\n':''));
const full=(await read('route-full-2025.geojson')).coordinates;
const previous=(await read('route.geojson')).coordinates.slice(0,1907);
if(previous.length!==1907||full.length!==2901||JSON.stringify(previous[0])!==JSON.stringify(full[0]))throw Error('Unexpected route data; inspect before extending');
const rad=Math.PI/180;
const distance=(a,b)=>{
 const y=(b[1]-a[1])*rad,x=(b[0]-a[0])*rad;
 const v=Math.sin(y/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(x/2)**2;
 return 12742.0176*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));
};
const oldLength=previous.slice(1).reduce((sum,p,i)=>sum+distance(previous[i],p),0);
const factor=105.9968/oldLength; // original published WGS84 length vs Haversine
const line=[...previous,...full.slice(1907)];
const cumulative=[0];
for(let i=1;i<line.length;i++)cumulative.push(cumulative[i-1]+distance(line[i-1],line[i])*factor);
const pointAt=km=>{
 const j=cumulative.findIndex(value=>value>=km);
 if(j<1)throw Error('Requested distance outside route: '+km);
 const t=(km-cumulative[j-1])/(cumulative[j]-cumulative[j-1]);
 return line[j-1].map((v,k)=>Number((v+(line[j][k]-v)*t).toFixed(7)));
};
const goal=123;
// Keep 600 m of visible line beyond the goal so two fresh GPS fixes can
// corroborate the 123 km crossing; the selectable support plan still ends at 123.
const geometryEnd=123.6;
const j=cumulative.findIndex(value=>value>=geometryEnd);
const coords=[...line.slice(0,j),pointAt(geometryEnd)];
const route={type:'LineString',coordinates:coords};
const routeBytes=JSON.stringify(route);
await writeFile(new URL('../public/data/route.geojson',import.meta.url),routeBytes);
const milestone=await read('milestone-route.json');
milestone.source='route.geojson';
milestone.sourceSha256=createHash('sha256').update(routeBytes).digest('hex');
milestone.coordinates=coords;
await write('milestone-route.json',milestone);

const guide=await read('guide-data.json');
const oldEnd=guide.historicGoldPlanningEnd||guide.plannedEnd;
const origin=guide.crowDistanceOrigin;
const crow=(p)=>{
 const dLat=(p[1]-origin.lat)*rad,dLng=(p[0]-origin.lng)*rad;
 const v=Math.sin(dLat/2)**2+Math.cos(p[1]*rad)*Math.cos(origin.lat*rad)*Math.sin(dLng/2)**2;
 return 12742.0176*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));
};
guide.historicGoldPlanningEnd={...oldEnd,context:'Jeff’s historical gold pin; not the current support planning end'};
guide.routeKm=geometryEnd;
guide.routeMiles=Number((geometryEnd/1.609344).toFixed(4));
const end=pointAt(goal);
guide.plannedEnd={lat:end[1],lng:end[0],routeKm:goal,crowKm:Number(crow(end).toFixed(4)),crowMiles:Number((crow(end)/1.609344).toFixed(4)),sourcePinName:'123 km on Jeff’s Meriden 2025 line',isOfficialFinish:false,isParkingPoint:false,notAMeetingPoint:true};
guide.stops=guide.stops.filter(s=>!['km-110','km-120','km-123'].includes(s.id));
for(const km of [110,120,123]){
 const p=pointAt(km);
 guide.stops.push({id:'km-'+km,milestoneLabel:km+' KM',routeKm:km,lat:p[1],lng:p[0],crowKm:Number(crow(p).toFixed(4)),place:km+' KM ONWARD ROUTE',locationNote:km+' km along Jeff’s 2025 planned line. This is a route-distance reference, not a confirmed meeting point, safe parking place, or official checkpoint.',kind:'calculated-route-milestone',source:'original-kml-mainline',isParkingPoint:false,isOfficialCheckpoint:false});
}
guide.geometryFiles.plannedRoute='route.geojson';
guide.sourceUrls.googleShortLink='https://maps.app.goo.gl/mBzgbJXp7cKdyFzt5?g_st=ic';
guide.sources.find(s=>s.id==='original-map').shortUrl=guide.sourceUrls.googleShortLink;
guide.sources.find(s=>s.id==='original-map').accessNote='User link rechecked 14 November 2026; resolves to Jeffrey Simmons’s Meriden 2025 map with onward Points 18–23.';
guide.provenance.plannedPolylinePoints=coords.length;
guide.provenance.sourceAgeLabel='Jeff’s 2025 route extended through 123 km as a 2026 support-planning reference';
guide.timing.plannedEndAverageKphFor24Hours=Number((123/24).toFixed(4));
const extraUncertainty='New 110, 120 and 123 km reference dots are interpolated along the 2025 source line. They do not imply three new support car parking stops. The nearest source meeting choices are existing numbered Points 18–23.';
if(!guide.uncertainties.includes(extraUncertainty))guide.uncertainties.push(extraUncertainty);
await write('guide-data.json',guide);

const plan=await read('support-points.json');
plan.planningEndKm=goal;
for(const group of plan.groups){
 group.beyondPlannedFinish=group.routeKm>goal;
 for(const option of group.options)option.beyondPlannedFinish=option.routeKm>goal;
}
const planNote=' The 14 November 2026 update includes original 2025 Points 18–23 through 121.2 km, to support a possible 123 km goal. Pins are historical possibilities, not agreed meeting places.';
if(!plan.sourceNote?.includes(planNote.trim()))plan.sourceNote=(plan.sourceNote||'')+planNote;
await write('support-points.json',plan);
console.log(JSON.stringify({planningGoalKm:goal,visibleTrackerBufferKm:geometryEnd,vertices:coords.length,oldVertices:previous.length,goldReferenceKm:guide.goldCrossing.routeKm,extendedSupportGroups:plan.groups.filter(x=>x.routeKm>105.9968&&x.routeKm<=goal).map(x=>[x.number,x.routeKm]),end}));
