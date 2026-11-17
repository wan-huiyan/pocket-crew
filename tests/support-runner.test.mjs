import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const supportSource=readFileSync(new URL('../public/support.js',import.meta.url),'utf8');
const plannerSource=readFileSync(new URL('../public/upcoming-points.js',import.meta.url),'utf8');
const etaSource=readFileSync(new URL('../public/arrival-eta.js',import.meta.url),'utf8');
const publishedPlan=JSON.parse(readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const key='meriden-meeting-points-v1';

test('server Met and Skipped stamps hydrate every view and survive the move to the next point',async()=>{
  const at=new Date().toISOString();
  for(const mode of ['runner','supporter']){
    const f=await load({mode});
    f.api.setSharedCheckpointState({completedPointIds:['point-1','point-2'],checkpointStatuses:{'point-1':{status:'met',at},'point-2':{status:'skipped',at}}});
    f.api.setSharedMeetup(points[2]);
    assert.equal(f.plan().statuses['point-1'].status,'met');
    assert.equal(f.plan().statuses['point-2'].status,'skipped');
    assert.equal(f.plan().selected.id,'point-3');
    assert.match(f.q('#support-now').innerHTML,/Point 3/);
    if(mode==='supporter'){
      assert.match(f.q('#support-list').innerHTML,/support-stamp-met[^>]*>✓ Met/);
      assert.match(f.q('#support-list').innerHTML,/support-stamp-skipped[^>]*>↷ Skipped/);
    }
    assert.equal(f.writes.length,0,'receiving a shared stamp must not echo a local write');
  }
});

test('server undo clears shared stamps without resurrecting old phone-only completion flags',async()=>{
  const f=await load({mode:'supporter',stored:{statuses:{'point-3':{status:'met',at:Date.now()}}}});
  f.api.setSharedCheckpointState({completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'met',at:new Date().toISOString()}}});
  f.api.setOwnedMeetup(points[1]);
  assert.equal(f.plan().statuses['point-3'],undefined);
  f.api.setSharedCheckpointState({completedPointIds:[],checkpointStatuses:{}});
  f.api.setOwnedMeetup(points[0]);
  assert.equal(f.plan().statuses['point-1'],undefined);
  assert.match(f.q('#support-now').innerHTML,/Point 1/);
  assert.equal(f.writes.length,0);
});

test('shared town names are displayed once and a passed agreement no longer pins the old meet-up panel',async()=>{
  const f=await load({mode:'supporter'});
  f.api.setSharedMeetup({...points[0],label:'Point 1 · Exampletown',town:'Exampletown'});
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Exampletown · Exampletown/);
  f.progress(12);
  assert.match(f.q('#support-now').innerHTML,/Point 2/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Village Hall/);
});
const points=[
  {id:'point-1',label:'Point 1',pointNumber:'1',groupNumber:1,routeKm:10,lat:52,lng:-1,landmark:{mapLabel:'Village Hall',nearbyLabel:'Church Street'},detail:'Village entrance'},
  {id:'point-2',label:'Point 2',pointNumber:'2',groupNumber:2,routeKm:20,lat:51.95,lng:-.9,landmark:{mapLabel:'Town Café'},detail:'Outside the café'},
  {id:'point-3',label:'Point 3',pointNumber:'3',groupNumber:3,routeKm:30,lat:51.9,lng:-.8,landmark:{mapLabel:'Library'},detail:'Library gate'}
];
const evPoint={id:'ev-bowen',label:'Osprey charging',town:'Daventry',pointNumber:'ϟ',groupNumber:2,routeKm:20.1,lat:51.95,lng:-.899,optionalMeetup:true,kind:'ev-support-option',landmark:{mapLabel:'Bowen Square'},detail:'Signed charging bays'};
const planWithEv=(...options)=>({planningEndKm:40,groups:points.map(p=>({id:p.id,label:p.label,routeKm:p.routeKm,options:[p,...options.filter(option=>option.groupNumber===p.groupNumber)]}))});

test('meeting sheets and supporter options lead with the early-to-late arrival range',async()=>{
  const forecast={status:'ready',formattedTime:'12:00',earliestFormattedTime:'12:00',latestFormattedTime:'12:30',rangeText:'12:00–12:30',readyByText:'Be ready by 12:00'};
  for(const mode of ['runner','supporter']){
    const calls=[],emily={id:'emily'},jeff={id:'jeff'};
    const f=await load({mode,snapshot:{runner:jeff,runners:{emily,jeff}},forecast:options=>{calls.push(options);return forecast;}});
    f.api.setSharedMeetup(points[0]);
    const html=f.q('#support-now').innerHTML;
    assert.match(html,/<strong>ETA 12:00–12:30<\/strong>/);
    if(mode==='supporter'){
      assert.doesNotMatch(html,/Be ready/);
      assert.match(f.q('#support-list').innerHTML,/<strong>ETA 12:00–12:30<\/strong>/);
      assert.doesNotMatch(f.q('#support-list').innerHTML,/Be ready/);
    }else{
      assert.doesNotMatch(html,/Be ready/);
      assert.equal(f.q('#support-list').innerHTML,'');
    }
    assert(calls.length>0);
    assert(calls.every(call=>Object.keys(call.snapshot.runners).join(',')==='emily'&&call.snapshot.runner===emily),'cached Jeff data cannot supply an active meeting forecast');
    assert.equal(f.writes.length,0,'showing arrival information never changes the shared meeting choice');
  }
});

test('the meet-up list keeps UK dates without ready-now text and omits ETA for stamped stops',async()=>{
  const forecast={status:'ready',earliestFormattedTime:'23:45',latestFormattedTime:'15 Nov 00:15',readyByText:'Be ready now'};
  const f=await load({mode:'supporter',forecast});
  f.api.setSharedCheckpointState({completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'met',at:new Date().toISOString()}}});
  f.api.setSharedMeetup(points[1]);
  assert.match(f.q('#support-now').innerHTML,/<strong>ETA 23:45–15 Nov 00:15<\/strong>/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Be ready/);
  const cards=f.q('#support-list').innerHTML.match(/<article\b[\s\S]*?<\/article>/g);
  const met=cards.find(card=>/Village Hall/.test(card)),future=cards.find(card=>/Town Café/.test(card));
  assert.match(met,/✓ Met/);assert.doesNotMatch(met,/support-forecast|Be ready/);
  assert.match(future,/ETA 23:45–15 Nov 00:15/);assert.doesNotMatch(future,/Be ready/);
});

test('older and unavailable meeting forecasts do not leave undefined times or readiness promises',async()=>{
  for(const [forecast,expected] of [
    [{status:'ready',formattedTime:'12:00'},'ETA 12:00'],
    [{status:'ready'},'ETA time pending'],
    [{status:'unavailable'},'ETA · waiting for usable pace']
  ]){
    const f=await load({mode:'supporter',forecast});f.api.setSharedMeetup(points[0]);
    const html=f.q('#support-now').innerHTML;
    assert(html.includes(expected));assert.doesNotMatch(html,/Be ready|NaN|ETA undefined/);
  }
});

async function load({mode='runner',stored={},snapshot={},beforeReady,planData,selectResult={ok:true},evResult={ok:true},forecast=null}={}) {
  const elements=new Map(),documentListeners=new Map(),windowListeners=new Map(),writes=[],events=[],focused=[],selections=[],evActions=[];
  const q=selector=>{
    if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:'',hidden:false,querySelector:()=>null,focus(){},scrollIntoView(){}});
    return elements.get(selector);
  };
  const add=(list,type,handler)=>list.set(type,[...(list.get(type)||[]),handler]);
  const dispatch=(list,type,event)=>(list.get(type)||[]).forEach(fn=>fn(event));
  let live=snapshot;
  const context={
    console,Date,URL,Intl,queueMicrotask,state:{mode},notify(){},switchTab(){},shareText(){},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    document:{querySelector:q,activeElement:null,addEventListener(type,handler){add(documentListeners,type,handler);}},
    localStorage:{getItem:name=>name===key?JSON.stringify(stored):null,setItem(name,value){writes.push({name,value});}},
    fetch:async path=>{
      assert.equal(path,'data/support-points.json');
      return Response.json(planData || {planningEndKm:40,sourceNote:'Original pins',earlyCheckIns:[],groups:points.map(p=>({id:p.id,label:p.label,routeKm:p.routeKm,options:[p]}))});
    },
    window:{
      meetingForecast:{estimate:options=>typeof forecast==='function'?forecast(options):forecast},
      addEventListener(type,handler){add(windowListeners,type,handler);},
      dispatchEvent(event){events.push(event);dispatch(windowListeners,event.type,event);},
      liveGuide:{
        getSnapshot:()=>live,
        async selectCheckpoint(id){selections.push(id);if(selectResult.ok){const selected=context.window.supportGuide.getPoint(id);context.window.supportGuide.setSharedMeetup(selected);}return selectResult;},
        async addEvMeetup(id){
          evActions.push({action:'add-ev',id});
          if(evResult.ok){live={...live,addedEvPointIds:[...new Set([...(live.addedEvPointIds||[]),id])]};context.window.supportGuide.setSharedCheckpointState(live);}
          return evResult;
        },
        async removeEvMeetup(id){
          evActions.push({action:'remove-ev',id});
          if(evResult.ok){live={...live,addedEvPointIds:(live.addedEvPointIds||[]).filter(value=>value!==id)};context.window.supportGuide.setSharedCheckpointState(live);}
          return evResult;
        }
      },
      raceMap:{follow(){},focusPoint(p){focused.push(p);}}
    }
  };
  vm.runInNewContext(plannerSource,context,{filename:'upcoming-points.js'});
  vm.runInNewContext(etaSource,context,{filename:'arrival-eta.js'});
  vm.runInNewContext(supportSource,context,{filename:'support.js'});
  beforeReady?.(context.window.supportGuide);
  await tick();await tick();
  const api=context.window.supportGuide;
  return {q,api,writes,events,focused,selections,evActions,
    plan:()=>JSON.parse(JSON.stringify(api.getMapPlanData())),
    progress(routeKm){live={runner:{routeKm}};api.setTrackerProgress({routeKm,fresh:true});},
    action(action,id='point-1'){
      const target={dataset:{supportAction:action,pointId:id},closest:selector=>selector==='[data-support-action]'?target:null};
      dispatch(documentListeners,'click',{target});
    },
    submit(id){let prevented=false;dispatch(documentListeners,'submit',{target:{id},preventDefault(){prevented=true;}});return prevented;},
    openMeeting(){dispatch(windowListeners,'viewchange',{detail:{tab:'meetup'}});}
  };
}

test('before any confirmed passed stops Coventry remains the original first meeting without a fabricated agreement',async()=>{
  for(const role of ['runner','supporter','public-viewer']){
    const f=await load({mode:role==='runner'?'runner':'supporter',planData:{...publishedPlan,confirmedPassedPointIds:[]}});
    if(role==='public-viewer')f.api.setSharedMeetup(null);
    if(role==='supporter')f.api.setOwnedMeetup(null);
    const current=f.q('#support-now').innerHTML;
    assert.match(current,/NEXT MEET-UP/,role);
    assert.match(current,/First meet-up/,role);
    assert.match(current,/MFG Coventry/,role);
    assert.match(current,/Approx\. route km 17\.3/,role);
    assert.match(current,/Roughly 2 hours in · planning estimate/,role);
    assert.doesNotMatch(current,/Waiting for the crew|CREW’S AGREED|Dunchurch|10 km or 20 km/);
    assert.doesNotMatch(f.q('#support-list').innerHTML,/Location not confirmed|Early check-ins · agree the spots/);
    assert.equal(f.api.getSelected(),null,'the shared empty agreement remains empty');
    assert.equal(f.plan().selected,null);
    assert.equal(f.writes.length,0,'showing the default must not create or publish a choice');
  }
});

test('the public confirmed passed stop advances every view to Dunchurch without GPS or a saved agreement',async()=>{
  assert.deepEqual(publishedPlan.confirmedPassedPointIds,['meetup-mfg-coventry']);
  for(const role of ['runner','supporter','public-viewer']){
    const f=await load({mode:role==='runner'?'runner':'supporter',planData:publishedPlan,snapshot:{runner:null,runners:{emily:null,jeff:null}}});
    if(role==='public-viewer')f.api.setSharedMeetup(null);
    if(role==='supporter')f.api.setOwnedMeetup(null);
    const current=f.q('#support-now').innerHTML,plan=f.plan();
    assert.match(current,/Point 1 · Dunchurch/,role);
    assert.match(current,/By Market Cross/,role);
    assert.doesNotMatch(current,/MFG Coventry|route km to go|This pin is about/,role);
    assert.deepEqual(plan.statuses['meetup-mfg-coventry'],{status:'passed'});
    assert.equal(plan.progressKm,null,'a passed stop must not create a GPS distance');
    assert.equal(plan.selected,null,'the default next stop is not a crew agreement');
    assert(plan.points.some(p=>p.id==='meetup-mfg-coventry'),'All stops retains Coventry');
    if(role!=='runner')assert.match(f.q('#support-list').innerHTML,/First meet-up · Coventry/);
    assert.equal(f.writes.length,0,'a published passed fact does not write a new crew agreement');
  }
});

test('a current shared or owned agreement takes precedence over a source-confirmed passed stop',async()=>{
  const coventry=publishedPlan.groups.flatMap(g=>g.options).find(p=>p.id==='meetup-mfg-coventry');
  for(const method of ['setSharedMeetup','setOwnedMeetup']){
    const f=await load({mode:'supporter',planData:publishedPlan,snapshot:{runner:null,runners:{emily:null,jeff:null}}});
    f.api[method](coventry);
    assert.equal(f.plan().selected.id,coventry.id);
    assert.equal(f.plan().statuses[coventry.id],undefined);
    assert.match(f.q('#support-now').innerHTML,/MFG Coventry/);
    assert.equal(f.writes.length,0);
  }
});

test('unknown, stale or off-route reports cannot supply selected progress',async()=>{
  const report={lat:52.3,lng:-1.2,routeKm:35,offRouteM:0,fresh:true,recordedAt:Date.now()};
  const summary={...report,projectedRouteKm:40};
  const cases=[
    {name:'no reports',runner:null,runners:{emily:null,jeff:null}},
    {name:'unknown route progress',runner:{...summary,routeKm:null},runners:{emily:{...report,routeKm:null},jeff:null}},
    {name:'expired report',runner:summary,runners:{emily:null,jeff:{...report,recordedAt:Date.now()-600000}}},
    {name:'stale flag',runner:summary,runners:{emily:null,jeff:{...report,fresh:false}}},
    {name:'off-route individual',runner:summary,runners:{emily:null,jeff:{...report,offRouteM:700}}},
    {name:'explicitly unavailable individual feeds',runner:summary,runners:null}
  ];
  for(const mode of ['runner','supporter'])for(const snapshot of cases){
    const f=await load({mode,snapshot,stored:{progressKm:35},planData:publishedPlan});
    f.api.setTrackerProgress({routeKm:35,fresh:true});
    f.openMeeting();
    const current=f.q('#support-now').innerHTML;
    assert.match(current,/Point 1 · Dunchurch/,mode+': '+snapshot.name);
    assert.doesNotMatch(current,/MFG Coventry|Willoughby|This pin is about|route km to go/,mode+': '+snapshot.name);
    assert.equal(f.api.getSelected(),null);
    assert.equal(f.writes.length,0);
  }
});

test('an explicit crew agreement survives unavailable progress instead of being treated as passed',async()=>{
  const report={lat:52.3,lng:-1.2,routeKm:35,offRouteM:0,fresh:true,recordedAt:Date.now()};
  const f=await load({snapshot:{runner:{...report,routeKm:null,projectedRouteKm:35},runners:{emily:{...report,routeKm:null},jeff:null}}});
  f.api.setSharedMeetup(points[1]);
  assert.match(f.q('#support-now').innerHTML,/CREW’S AGREED MEET-UP/);
  assert.match(f.q('#support-now').innerHTML,/Town Café/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/No further meeting|Village Hall|Library/);
  assert.equal(f.api.getSelected().id,'point-2');
  assert.equal(f.writes.length,0);
});

test('the most recent usable tracker advances the sheet even when its companion is missing or behind',async()=>{
  const report={lat:52.39,lng:-1.43,routeKm:17.5,offRouteM:0,fresh:true,recordedAt:Date.now()};
  for(const companion of [null,{...report,routeKm:15,recordedAt:Date.now()-60000}])for(const mode of ['runner','supporter']){
    const f=await load({mode,planData:publishedPlan,snapshot:{runner:{...report,summaryRunnerId:'emily'},runners:{emily:report,jeff:companion}}});
    f.api.setTrackerProgress({routeKm:35,fresh:true});
    assert.match(f.q('#support-now').innerHTML,/Point 1 · Dunchurch/);
    assert.match(f.q('#support-now').innerHTML,/About 14\.0 route km to go/);
    assert.doesNotMatch(f.q('#support-now').innerHTML,/MFG Coventry|This pin is about/);
    assert.equal(f.writes.length,0);
  }
  const legacy=await load({snapshot:{runner:{projectedRouteKm:12}}});
  assert.match(legacy.q('#support-now').innerHTML,/Town Café/);
});

test('supporter meeting list preserves original planned towns and leaves unchosen EV stations in the catalogue',async()=>{
  const f=await load({mode:'supporter',planData:publishedPlan});
  const planned=publishedPlan.groups.flatMap(group=>group.options).filter(p=>!p.beyondPlannedFinish);
  assert.equal(planned.filter(p=>!p.optionalMeetup).length,25,'the 2025 numbered support choices now continue through Point 23');
  for(const number of [18,19,20,21,22,23])assert(planned.some(p=>p.id==='point-'+number),'original onward Point '+number+' is in the 123 km plan');
  for(const p of planned.filter(p=>!p.optionalMeetup)){
    const expectedTitle=p.town?(p.label.includes(p.town)?p.label:p.label+' · '+p.town):p.label;
    assert(f.q('#support-list').innerHTML.includes(expectedTitle),p.id+' shows its town without repeating a town already in the place name');
  }
  for(const p of planned.filter(p=>p.optionalMeetup)){
    assert.equal(f.api.getPoint(p.id).id,p.id,'the charging catalogue retains direct lookup');
    assert.equal(f.api.isEvAdded(p.id),false);
    assert(!f.plan().points.some(option=>option.id===p.id),'unchosen chargers are absent from meeting map pins');
    assert(!f.q('#support-list').innerHTML.includes('data-point-id="'+p.id+'"'),'unchosen chargers are absent from the meeting list');
  }
  assert.match(f.q('#support-now').innerHTML,/Point 1 · Dunchurch/);
});

test('runner sheet follows one automatic next point without saving a choice or showing planning controls',async()=>{
  const f=await load();
  assert.match(f.q('#support-now').innerHTML,/NEXT MEET-UP/);
  assert.match(f.q('#support-now').innerHTML,/Village Hall/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Town Café|Choose|Meet-up options|data-support-action="(?:choose|skip|met)"/);
  assert.equal(f.q('#support-list').innerHTML,'');
  assert.equal(f.api.getSelected(),null);
  f.progress(10.3);f.openMeeting();
  assert.match(f.q('#support-now').innerHTML,/Town Café/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Village Hall|Library|Choose/);
  assert.equal(f.writes.length,0,'automatic progress must not publish a fabricated crew agreement');
});

test('runner sheet honours the shared later meeting and moves on when its pin has passed',async()=>{
  const f=await load();
  f.api.setSharedMeetup({...points[2],note:'Meet at the library gate'});
  f.progress(12);
  assert.match(f.q('#support-now').innerHTML,/CREW’S AGREED MEET-UP/);
  assert.match(f.q('#support-now').innerHTML,/Library/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Town Café|Choose|Share meet-up/);
  f.progress(30.3);
  assert.match(f.q('#support-now').innerHTML,/No further meeting point is set/);
  assert.equal(f.writes.length,0);
});

test('runner actions and form submissions cannot alter a saved meeting plan',async()=>{
  const f=await load({stored:{selectedId:'point-1',statuses:{'point-3':{status:'skipped'}},progressKm:2,afterMetId:'point-3',history:[{label:'Previous choice',before:{selectedId:'point-2'}}]}});
  const before=f.plan();
  f.api.select('point-2');
  for(const action of ['choose','met','skip','reopen','undo','keep-nearby','add-early'])f.action(action,'point-2');
  assert.equal(f.submit('support-distance-form'),true);
  assert.equal(f.submit('support-custom-form'),true);
  assert.deepEqual(f.plan(),before);
  assert.equal(f.writes.length,0);
  f.api.showSelectedOnMap('point-2');
  assert.equal(f.focused.at(-1).id,'point-1','old or stale map buttons still open the single current meet-up');
  assert.equal(f.api.renderMapDetail(),true);
  assert.doesNotMatch(f.q('#map-detail').innerHTML,/data-support-action="choose"|Use as next meet-up/);
});

test('supporters can choose and complete stops while a shared viewer cannot change the crew plan',async()=>{
  const f=await load({mode:'supporter'});
  assert.match(f.q('#support-list').innerHTML,/data-support-action="choose"/);
  f.api.select('point-2');
  assert.equal(f.api.getSelected().id,'point-2');
  assert.equal(f.events.at(-1).type,'supportchange');
  f.action('met','point-2');
  assert.equal(f.plan().statuses['point-2'].status,'met');
  assert.equal(f.api.getSelected(),null);
  assert.equal(f.writes.length,2);

  f.api.setSharedMeetup(points[2]);
  const before=f.plan(),writeCount=f.writes.length;
  f.api.select('point-1');f.action('skip','point-3');
  assert.equal(f.submit('support-custom-form'),true);
  assert.deepEqual(f.plan(),before);
  assert.equal(f.writes.length,writeCount);
});

test('owner hydration uses the server agreement without publishing a new choice and remains editable',async()=>{
  const f=await load({mode:'supporter',stored:{selectedId:'point-1',statuses:{'point-2':{status:'skipped'}}}});
  f.api.setSharedMeetup(null);
  const eventCount=f.events.length;
  const agreed={...points[1],label:'Town Café entrance',lat:51.951,lng:-.901,note:'Meet by the side entrance'};
  f.api.setOwnedMeetup(agreed);
  const current=f.plan();
  assert.equal(current.selected.id,'point-2');
  assert.equal(current.selected.label,'Town Café entrance');
  assert.equal(current.selected.detail,'Meet by the side entrance');
  assert.equal(current.selected.lat,51.951);
  assert.equal(current.selected.lng,-.901);
  assert.equal(current.selected.landmark.mapLabel,'Town Café');
  assert.deepEqual(current.points.find(p=>p.id==='point-2'),current.selected);
  assert.equal(current.statuses['point-2'],undefined,'a stale local skip must not hide the current server agreement');
  assert.equal(f.api.getSelected().lat,51.951);
  assert.equal(f.api.getPoint('point-2').lat,51.951);
  assert.deepEqual(f.events.slice(eventCount).map(e=>e.detail.reason),['owned-load']);
  assert.equal(f.writes.length,0,'hydration is not a local user edit');

  f.api.setOwnedMeetup(agreed);
  assert.equal(f.events.length,eventCount+1,'unchanged server snapshots should not re-render or publish');
  assert.match(f.q('#support-list').innerHTML,/data-support-action="choose"/);
  assert.match(f.q('#support-now').innerHTML,/data-support-action="met"/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/private/i);
  f.api.select('point-1');
  assert.equal(f.api.getSelected().id,'point-1');
  assert.equal(f.events.at(-1).detail.reason,'change','a deliberate owner change still publishes normally');
  assert.equal(f.writes.length,1);
});

test('server-owned custom points appear once and clearing an agreement removes the remote point',async()=>{
  const f=await load({mode:'supporter',stored:{selectedId:'point-1'}});
  const custom={id:'custom-public-stop',label:'Bridge entrance',routeKm:24,lat:51.92,lng:-.85,mapUrl:'https://maps.app.goo.gl/example',note:'Beside the blue gate'};
  const eventCount=f.events.length;
  f.api.setOwnedMeetup(custom);
  assert.equal(f.api.getSelected().id,custom.id);
  assert.equal(f.api.getSelected().kind,'custom-meetup');
  assert.equal(f.api.getSelected().name,'Bridge entrance');
  assert.equal(f.api.getPoint(custom.id).detail,'Beside the blue gate');
  assert.equal(f.plan().points.filter(p=>p.id===custom.id).length,1);
  assert.match(f.q('#support-list').innerHTML,/Bridge entrance/);
  assert.match(f.q('#support-now').innerHTML,/data-support-action="met"/);
  f.api.setOwnedMeetup(null);
  assert.equal(f.api.getSelected(),null);
  assert.equal(f.plan().selected,null);
  assert.equal(f.plan().points.some(p=>p.id===custom.id),false);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Bridge entrance/);
  assert.deepEqual(f.events.slice(eventCount).map(e=>e.detail.reason),['owned-load','owned-load']);
  assert.equal(f.writes.length,0);
  f.api.setOwnedMeetup(null);
  assert.equal(f.events.length,eventCount+2);
});

test('a null owner snapshot clears a stale browser agreement and leaves owner planning enabled',async()=>{
  const f=await load({mode:'supporter',stored:{selectedId:'point-2'}});
  f.api.setSharedMeetup(null);
  f.api.setOwnedMeetup(null);
  assert.equal(f.api.getSelected(),null);
  assert.equal(f.events.at(-1).detail.reason,'owned-load');
  assert.match(f.q('#support-list').innerHTML,/id="support-custom-form"/);
  f.api.select('point-3');
  assert.equal(f.api.getSelected().id,'point-3');
  assert.equal(f.events.at(-1).detail.reason,'change');
  assert.equal(f.writes.length,1);
});

test('public supporter viewers see read-only pins and no stale browser planning choices',async()=>{
  const f=await load({mode:'supporter',stored:{
    selectedId:'custom-old-plan',
    custom:[{id:'custom-old-plan',name:'Old local café',mapUrl:'https://maps.app.goo.gl/old',routeKm:8}],
    statuses:{'point-1':{status:'skipped'},'point-3':{status:'met'}}
  }});
  f.api.setSharedMeetup({...points[2],note:'Meet at the library gate'});
  assert.equal(f.api.getSelected().id,'point-3');
  assert.equal(f.plan().points.some(p=>p.id==='custom-old-plan'),false);
  assert.deepEqual(f.plan().statuses,{});
  const list=f.q('#support-list').innerHTML;
  assert.match(list,/Village Hall|Town Café|Library/);
  assert.doesNotMatch(list,/Old local café|data-support-action="(?:choose|skip|reopen|add-early)"|support-custom-form/);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/data-support-action="(?:met|skip|choose|browse|undo)"|private/i);
  assert.match(f.q('#support-now').innerHTML,/Shared by the support crew/);
  const current=f.plan(),eventCount=f.events.length;
  f.api.select('point-1');
  for(const action of ['choose','met','skip','reopen','undo','keep-nearby','add-early'])f.action(action,'point-1');
  assert.equal(f.submit('support-custom-form'),true);
  assert.equal(f.submit('support-distance-form'),true);
  assert.deepEqual(f.plan(),current);
  assert.equal(f.events.length,eventCount);
  assert.equal(f.writes.length,0);
  f.api.setSharedMeetup(null);
  assert.equal(f.api.getSelected(),null);
  assert.doesNotMatch(f.q('#support-now').innerHTML,/Choose next|Add your agreed|data-support-action="choose"/);
});

test('an owner agreement received before point loading retains its pin and receives landmark metadata',async()=>{
  const agreed={id:'point-2',label:'Café side entrance',lat:51.951,lng:-.901,note:'Beside the door'};
  const f=await load({mode:'supporter',beforeReady:api=>api.setOwnedMeetup(agreed)});
  assert.equal(f.api.getSelected().id,'point-2');
  assert.equal(f.api.getSelected().lat,agreed.lat);
  assert.equal(f.api.getSelected().routeKm,20);
  assert.equal(f.api.getSelected().landmark.mapLabel,'Town Café');
  assert.equal(f.plan().points.filter(p=>p.id==='point-2').length,1);
  assert.deepEqual(f.events.map(e=>e.detail.reason),['owned-load','load']);
  assert.equal(f.writes.length,0);
});

test('unchosen charging options stay hidden while an already agreed EV remains visible to everyone',async()=>{
  const ev={id:'ev-bowen',label:'Osprey charging',town:'Daventry',pointNumber:'ϟ',groupNumber:2,routeKm:20.1,lat:51.95,lng:-.899,optionalMeetup:true,kind:'ev-support-option',landmark:{mapLabel:'Bowen Square'},detail:'Signed charging bays'};
  const planData={planningEndKm:40,groups:points.map(p=>({id:p.id,label:p.label,routeKm:p.routeKm,options:p.id==='point-2'?[p,ev]:[p]}))};
  const runner=await load({planData});
  assert(!runner.plan().points.some(p=>p.id===ev.id));
  assert.equal(runner.q('#support-list').innerHTML,'');
  runner.api.setSharedMeetup(ev);
  assert.equal(runner.plan().points.find(p=>p.id===ev.id).landmark.mapLabel,'Bowen Square');
  assert.match(runner.q('#support-now').innerHTML,/Bowen Square/);
  assert.doesNotMatch(runner.q('#support-now').innerHTML,/data-support-action="choose"|EV option/);

  const viewer=await load({mode:'supporter',planData});
  viewer.api.setSharedMeetup(points[0]);
  assert(!viewer.plan().points.some(p=>p.id===ev.id));
  assert.doesNotMatch(viewer.q('#support-list').innerHTML,/EV option/);
  assert.doesNotMatch(viewer.q('#support-list').innerHTML,/data-support-action="choose"/);
  await viewer.api.select(ev.id);
  assert.equal(viewer.selections.length,0);
  assert.equal(viewer.api.getSelected().id,'point-1');

  const supporter=await load({mode:'supporter',planData,snapshot:{room:{canManageCheckpoints:true}}});
  supporter.api.setSharedMeetup(points[0]);
  assert.doesNotMatch(supporter.q('#support-list').innerHTML,/data-support-action="choose" data-point-id="ev-bowen"/);
  await supporter.api.select(ev.id);
  assert.deepEqual(supporter.selections,[ev.id]);
  assert.equal(supporter.api.getSelected().id,ev.id);
  assert.equal(supporter.api.isEvAdded(ev.id),true,'a previously selected canonical EV is retained');
  assert.match(supporter.q('#support-list').innerHTML,/data-support-action="met" data-point-id="ev-bowen"/);
  assert.equal(supporter.writes.length,0,'a canonical shared choice does not save or echo a stale local plan');

  const failed=await load({mode:'supporter',planData,snapshot:{room:{canManageCheckpoints:true}},selectResult:{ok:false}});
  failed.api.setSharedMeetup(points[0]);
  await failed.api.select(ev.id);
  assert.equal(failed.api.getSelected().id,'point-1','a failed save leaves the confirmed shared agreement intact');
});

test('adding an EV alternative cannot reopen an older completed meeting group',async()=>{
  const ev={id:'ev-new',label:'EV charging',town:'Test town',pointNumber:'ϟ',groupNumber:1,routeKm:10.1,lat:52,lng:-.99,optionalMeetup:true,kind:'ev-support-option'};
  const planData={planningEndKm:40,groups:points.map(p=>({id:p.id,label:p.label,routeKm:p.routeKm,options:p.id==='point-1'?[p,ev]:[p]}))};
  const f=await load({mode:'supporter',planData,snapshot:{room:{canManageCheckpoints:true}}});
  f.api.setSharedCheckpointState({completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'met',at:new Date().toISOString()}}});
  f.api.setSharedMeetup(points[1]);
  assert.equal(f.plan().statuses[ev.id].status,'skipped');
  await f.api.select(ev.id);
  assert.equal(f.selections.length,0);
  assert.equal(f.api.getSelected().id,'point-2');
  f.progress(8);
  assert.equal(f.api.getClosestUpcoming().id,'point-2');
});

test('adding and removing a local EV option persists the list without changing the next meet-up',async()=>{
  const ev={...evPoint,routeKm:15},planData=planWithEv(ev);
  const f=await load({mode:'supporter',stored:{selectedId:'point-1'},planData});
  assert.equal((await f.api.addEvMeetup(ev.id)).ok,true);
  assert.equal(f.api.isEvAdded(ev.id),true);
  assert.equal(f.api.getSelected().id,'point-1');
  assert(f.plan().points.some(p=>p.id===ev.id));
  assert.match(f.q('#support-list').innerHTML,/data-support-action="choose" data-point-id="ev-bowen"/);
  assert.equal(f.selections.length,0);
  assert.equal(f.evActions.length,0,'legacy local plans need no room request');
  const saved=JSON.parse(f.writes.at(-1).value);
  assert.deepEqual(saved.addedEvPointIds,[ev.id]);
  const reloaded=await load({mode:'supporter',stored:saved,planData});
  assert.equal(reloaded.api.isEvAdded(ev.id),true);
  assert.equal(reloaded.api.getSelected().id,'point-1');
  reloaded.progress(12);
  assert.match(reloaded.q('#support-now').innerHTML,/Town Café/,'adding an EV does not make it an automatic next destination');
  assert.doesNotMatch(reloaded.q('#support-now').innerHTML,/Bowen Square/);
  assert.equal((await f.api.removeEvMeetup(ev.id)).ok,true);
  assert.equal(f.api.isEvAdded(ev.id),false);
  assert.equal(f.api.getSelected().id,'point-1');
  assert.deepEqual(JSON.parse(f.writes.at(-1).value).addedEvPointIds,[]);
  assert(!f.plan().points.some(p=>p.id===ev.id));
  assert.equal(f.api.getPoint(ev.id).id,ev.id,'removal does not delete the catalogue entry');
  await f.api.select(ev.id);
  assert.equal((await f.api.removeEvMeetup(ev.id)).ok,false,'the agreed next destination cannot be removed');
  assert.equal(f.api.isEvAdded(ev.id),true);
});

test('connected supporter EV card actions save through the shared API without rerouting or local echo writes',async()=>{
  const ev=evPoint,planData=planWithEv(ev),snapshot={room:{joined:true,canManageCheckpoints:true},addedEvPointIds:[]};
  const f=await load({mode:'supporter',planData,snapshot});
  f.api.setSharedMeetup(points[0]);
  f.api.setSharedCheckpointState(snapshot);
  f.action('add-ev',ev.id);await tick();
  assert.deepEqual(f.evActions,[{action:'add-ev',id:ev.id}]);
  assert.equal(f.api.isEvAdded(ev.id),true);
  assert.equal(f.api.getSelected().id,'point-1');
  assert(f.plan().points.some(p=>p.id===ev.id));
  assert.equal(f.selections.length,0);
  assert.equal(f.writes.length,0);
  assert(f.events.filter(e=>e.type==='supportchange').every(e=>e.detail.reason!=='change'),'server hydration does not publish a new local agreement');
  f.action('remove-ev',ev.id);await tick();
  assert.equal(f.api.isEvAdded(ev.id),false);
  assert.equal(f.api.getSelected().id,'point-1');
  assert.equal(f.evActions.at(-1).action,'remove-ev');
  assert(!f.plan().points.some(p=>p.id===ev.id));
  assert.equal(f.writes.length,0);
  const failed=await load({mode:'supporter',planData,snapshot,evResult:{ok:false}});
  failed.api.setSharedMeetup(points[0]);failed.api.setSharedCheckpointState(snapshot);
  assert.equal((await failed.api.addEvMeetup(ev.id)).ok,false);
  assert.equal(failed.api.isEvAdded(ev.id),false,'failed requests do not optimistically expose unconfirmed choices');
  assert.equal(failed.api.getSelected().id,'point-1');
});

test('a supporter view alone cannot add or remove EV options from a shared plan',async()=>{
  const ev=evPoint,planData=planWithEv(ev);
  for(const mode of ['runner','supporter']){
    const f=await load({mode,planData,snapshot:{room:{joined:true,canManageCheckpoints:false},addedEvPointIds:[ev.id]}});
    f.api.setSharedMeetup(points[0]);
    assert.equal((await f.api.addEvMeetup(ev.id)).ok,false);
    f.api.setSharedCheckpointState({addedEvPointIds:[ev.id]});
    assert.equal((await f.api.removeEvMeetup(ev.id)).ok,false);
    assert.equal(f.api.isEvAdded(ev.id),true);
    assert.equal(f.evActions.length,0);
    assert.equal(f.writes.length,0);
    assert.equal(f.api.getSelected().id,'point-1');
  }
  const loadingViewer=await load({mode:'supporter',planData,snapshot:{room:{joined:true,canManageCheckpoints:false}}});
  assert.equal((await loadingViewer.api.addEvMeetup(ev.id)).ok,false,'a public room cannot be edited during initial hydration either');
  assert.equal(loadingViewer.evActions.length,0);
  assert.equal(loadingViewer.writes.length,0);
});

test('legacy EV migration retains current and actually met stations but never auto-skipped alternatives',async()=>{
  const current=evPoint,met={...evPoint,id:'ev-met',groupNumber:1,routeKm:10.1},skipped={...evPoint,id:'ev-skipped',groupNumber:3,routeKm:30.1};
  const planData=planWithEv(current,met,skipped),checkpointStatuses={[met.id]:{status:'met',at:new Date().toISOString()},[skipped.id]:{status:'skipped',at:new Date().toISOString()}};
  const local=await load({mode:'supporter',planData,stored:{selectedId:current.id,statuses:checkpointStatuses}});
  assert.equal(local.api.isEvAdded(current.id),true);
  assert.equal(local.api.isEvAdded(met.id),true);
  assert.equal(local.api.isEvAdded(skipped.id),false);
  const shared=await load({mode:'supporter',planData,beforeReady:api=>{
    api.setSharedCheckpointState({checkpointStatuses,completedPointIds:[met.id,skipped.id]});
    api.setSharedMeetup(current);
  }});
  assert.equal(shared.api.isEvAdded(current.id),true);
  assert.equal(shared.api.isEvAdded(met.id),true);
  assert.equal(shared.api.isEvAdded(skipped.id),false);
  assert(shared.plan().points.some(p=>p.id===current.id));
  shared.api.setSharedCheckpointState({checkpointStatuses,completedPointIds:[met.id,skipped.id],addedEvPointIds:[]});
  assert.equal(shared.api.isEvAdded(current.id),true,'current agreement survives even an older empty list');
  assert.equal(shared.api.isEvAdded(met.id),false,'an explicit empty list respects removal of a past met station');
  assert.equal(shared.api.isEvAdded(skipped.id),false);
  assert.equal(shared.writes.length,0);
});

test('an added EV list received before catalogue loading hydrates without saving or selecting a destination',async()=>{
  const ev=evPoint,f=await load({mode:'supporter',planData:planWithEv(ev),beforeReady:api=>{
    api.setSharedCheckpointState({addedEvPointIds:[ev.id,ev.id,'unknown-station','<invalid>']});
    api.setSharedMeetup(points[0]);
  }});
  assert.equal(f.api.isEvAdded(ev.id),true);
  assert.equal(f.api.isEvAdded('unknown-station'),false);
  assert.equal(f.plan().points.filter(p=>p.id===ev.id).length,1);
  assert.equal(f.api.getSelected().id,'point-1');
  assert.equal(f.writes.length,0);
  assert.equal(f.selections.length,0);
});
