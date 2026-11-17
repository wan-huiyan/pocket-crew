import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8')),write=(p,v)=>writeFileSync(new URL(p,root),JSON.stringify(v,null,2)+'\n');
const north=read('docs/research/ev-north-20261114.json'),south=read('docs/research/ev-south-20261114.json');
const facilities=read('public/data/facilities.json'),plan=read('public/data/support-points.json');
const mergeIds={'podpoint-tesco-bletchley':'tesco-bletchley-toilets','osprey-starbucks-watling':'starbucks-bletchley','aw-checkley-wood':'checkley-wood-toilets','osprey-white-lion':'white-lion-chalk-hill-toilets'};
const links={Osprey:'https://www.ospreycharging.co.uk/find-our-ev-charging-stations',Pod:'https://go.podenergy.com/','Pod Point':'https://go.podenergy.com/','Shell Recharge':'https://find.shell.com/gb/fuel/12038619-shell-co-op-towcester',GRIDSERVE:'https://www.gridserve.com/electric-vehicle-charging/find-an-ev-charger/'};
const known=new Map(facilities.pois.map(p=>[p.id,p]));
plan.groups=plan.groups.filter(g=>!g.evAddedGroup);
for(const g of plan.groups){g.options=g.options.filter(p=>!p.evAddedOption);g.optionIds=g.options.map(p=>p.id);}
const regular=plan.groups.filter(g=>!g.beyondPlannedFinish&&g.routeKm<=plan.planningEndKm);
const sourcesFor=s=>(s.sources||[]).filter(x=>x.url&&!x.url.includes('/nearby.json')).map(x=>({label:x.label||x.publisher||'Checked charging source',url:x.url}));
const unknown=()=>({timeZone:'Europe/London',basis:'unknown',weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),null]))});
const allDay=()=>({timeZone:'Europe/London',basis:'operator',weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),[['00:00','24:00']]]))});
let options=0;
for(const s of [...north.stations,...south.stations]){
  const id=s.existingFacilityId||mergeIds[s.id]||s.id,old=known.get(id),sources=sourcesFor(s);
  const name=s.operator&&!s.name.toLowerCase().includes(s.operator.toLowerCase())?s.operator+' · '+s.name:s.name;
  const p=old||{id,name,mapLabel:name,kinds:['charger'],lat:s.lat,lng:s.lng,routeKm:s.routeKm,routeOffsetM:s.routeOffsetM,address:[s.address,s.postcode].filter(Boolean).join(', ')||s.name,nearPointIds:[],sources,coordinateNote:s.coordinateNote||s.coordinateSource?.type||'Charging site pin; exact bays may differ.',opening:unknown()};
  if(!old){facilities.pois.push(p);known.set(id,p);}
  p.kinds=[...new Set([...p.kinds,'charger'])];p.town=s.town;p.checkedOn='2026-11-14';
  const twentyFour=s.operatorHours||/24\/7|24.hours/i.test(s.access||'');
  const accessHours=s.chargingHours||(twentyFour?'Charging listed 24 hours; venue / parking conditions apply':'Charger access hours to check');
  const connectorSummary=s.powerText||((s.connectors||[]).join(' · ')+(Number.isFinite(s.maxPowerKw)&&!(s.connectors||[]).some(x=>/kW/i.test(x))?' · up to '+s.maxPowerKw+' kW':''))||'Connector / power: check operator';
  const eligible=Boolean(s.meetingEligible??s.meetupCandidate)&&s.routeOffsetM<=300;
  p.charging={name,operator:s.operator||'Check on site',connectorSummary,connectors:s.connectors||[],maxPowerKw:s.maxPowerKw||null,accessHours,accessNote:[s.access,s.notes,s.availabilityCaution].filter(Boolean).join(' '),availabilityCaution:s.availabilityCaution||null,opening:s.chargingOpening||(twentyFour?allDay():unknown()),preferredStop:Boolean(s.preferredNextEV),meetupEligible:eligible,meetingNote:s.meetingNote||(eligible?'Optional near-route meeting place; use the signed entrance.':'Charging detour; keep the agreed runner meet-up.'),operatorUrl:links[s.operator]||sources[0]?.url||null,sources,checkedOn:'2026-11-14',coordinateNote:s.coordinateNote||s.coordinateSource?.type||p.coordinateNote};
  if(!old){p.hours=p.hoursLabel=accessHours;p.access=p.charging.accessNote;p.mapQuery=name+' '+p.address;}
  // Existing WC, cafe and parking locations keep their independent access,
  // opening schedules and pins. Charging specifics live in a separate field.
  if(!eligible){delete p.meetupPointId;continue;}
  if(id==='mfg-coventry'){p.meetupPointId='meetup-mfg-coventry';continue;}
  const nearest=regular.map(g=>({g,gap:Math.min(...g.options.filter(x=>!x.optionalMeetup).map(x=>Math.abs(x.routeKm-p.routeKm)))})).sort((a,b)=>a.gap-b.gap)[0];
  const attached=nearest?.gap<=1.5;
  let group=attached?nearest.g:null;
  if(!group){const number='ev-'+id;group={id:'ev-group-'+id,number,label:'EV option',routeKm:p.routeKm,routeKmEnd:p.routeKm,optional:true,evAddedGroup:true,beyondPlannedFinish:false,optionIds:[],groupingBasis:'Optional charging stop; never selected automatically',options:[],town:s.town};plan.groups.push(group);}
  const pointId='ev-meetup-'+id;
  const option={id:pointId,label:name,pointNumber:'ϟ',groupNumber:group.number??group.id,kind:'ev-support-option',optionalMeetup:true,evAddedOption:true,facilityId:id,town:s.town,lat:p.lat,lng:p.lng,routeKm:p.routeKm,routeOffsetM:p.routeOffsetM,beyondPlannedFinish:false,isOfficialCheckpoint:false,detail:p.charging.meetingNote,landmark:{name,mapLabel:name,nearbyLabel:id==='osprey-daventry'?'Bowen Square · near Costa & Waitrose':s.town,meetingNote:p.charging.meetingNote+' '+accessHours+'. '+(s.availabilityCaution||''),sources:sources.map(x=>x.url),checkedOn:'2026-11-14'}};
  group.options.push(option);group.optionIds.push(pointId);p.meetupPointId=pointId;p.nearPointIds=[...new Set([...(p.nearPointIds||[]),...group.options.filter(x=>!x.optionalMeetup).map(x=>x.id)])];options++;
}
plan.groups.sort((a,b)=>a.routeKm-b.routeKm);
plan.counts.evMeetingOptions=options;
plan.evChargingNote='Checked chargers close to the route are optional supporter meeting choices. Their addition does not change the default next stop. Only an explicit crew selection is shared as the destination.';
facilities.evCoverage={checkedOn:'2026-11-14',scope:'Checked public charging sites along the retained Coventry–Daventry–Dunstable route, primarily within 1 km of the route. Remaining-route view follows runner progress.',notLiveAvailability:true,note:'A researched station list, not a guaranteed exhaustive live-network feed. Venue access and parking restrictions apply. Offsets are straight-line distances; they do not establish a walking route.',chargerCount:facilities.pois.filter(p=>p.kinds.includes('charger')).length,meetingOptionCount:options+1,unverified:[...(north.excludedOrUnverified||[]),...(south.excludedOrPending||[])]};
write('public/data/facilities.json',facilities);write('public/data/support-points.json',plan);
console.log(JSON.stringify({facilities:facilities.pois.length,chargers:facilities.evCoverage.chargerCount,newEvOptions:options,toilets:facilities.pois.filter(p=>p.kinds.includes('toilet')).length}));
