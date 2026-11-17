import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/live.js', import.meta.url), 'utf8');
const etaSource = readFileSync(new URL('../public/arrival-eta.js', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-13T22:00:00Z');
const viewToken = 'v'.repeat(43), publishToken = 'p'.repeat(43), locationToken='l'.repeat(43);
const REGISTERED_RUNNERS = [
  {id:'emily',name:'Emily Simmons',shortName:'Emily',bib:'247'},
  {id:'jeff',name:'Jeff Simmons',shortName:'Jeff',bib:'133'}
];
const nextTick = () => new Promise(resolve => setImmediate(resolve));

const achievementRecord=(runnerId='emily',changes={})=>({id:`35950:${runnerId}:marathon`,eventId:35950,runnerId,bib:runnerId==='emily'?'247':'133',milestoneId:'marathon',crossedAt:new Date(NOW-120000).toISOString(),firstSeenBeyondAt:new Date(NOW-60000).toISOString(),recordedAt:new Date(NOW).toISOString(),estimated:true,backfilled:false,evidence:{beforeAt:new Date(NOW-180000).toISOString(),afterAt:new Date(NOW-60000).toISOString()},...changes});
const achievementFeed=(records,persisted)=>({status:'waiting',participants:[],achievements:{eventId:35950,records,persisted}});

test('ended public sharing keeps earned Emily posters and crossing history without restoring GPS or write controls',async()=>{
  const f=await load({publicEnded:true,registered:true});
  const at=new Date(NOW-120000).toISOString();
  const earned=achievementRecord('emily',{id:'35950:emily:km-50',milestoneId:'km-50'});
  f.setCrewReply(Response.json({public:true,status:'ended',room:null,releases:[{id:'km-50',releasedAt:at},{id:'km-100',releasedAt:at},{id:'unknown',releasedAt:at}],achievements:{eventId:35950,records:[earned,achievementRecord('jeff',{id:'35950:jeff:km-50',milestoneId:'km-50'})],persisted:true}}));
  await f.api.refresh();
  const snapshot=f.api.getSnapshot();
  assert.deepEqual(Array.from(snapshot.releases,r=>r.id).sort(),['km-100','km-50']);
  assert.equal(snapshot.achievements.records.length,1);assert.equal(snapshot.achievements.records[0].id,earned.id);
  assert.equal(snapshot.room.status,'ended');assert.equal(snapshot.room.canShareLocation,false);
  assert.equal(snapshot.supporters.huiyan,null);assert.equal(snapshot.supporters.graham,null);assert.equal(snapshot.supporters.jeff,null);
  assert.equal((await f.api.setSupporterPlan('huiyan','walking')).ok,false);
  assert.equal(f.gpsRequests.length,0);
});

test('shared saved crossing facts cannot be replaced by a newer temporary inference or unknown-time backfill',async()=>{
  const saved=achievementRecord(),room={achievements:{eventId:35950,records:[saved],persisted:true},meetup:{id:'point-7'},releases:[]};
  const f=await load({registered:true,room});
  assert.equal(f.api.getSnapshot().achievements.persisted,true);
  const temporary={...saved,crossedAt:null,backfilled:true,recordedAt:new Date(NOW+60000).toISOString(),evidence:{beforeAt:null,afterAt:saved.firstSeenBeyondAt}};
  f.feeds['247']=achievementFeed([temporary],false);await f.api.refresh();
  const snapshot=f.api.getSnapshot(),retained=snapshot.achievements.records[0];
  assert.equal(retained.crossedAt,saved.crossedAt);assert.equal(retained.recordedAt,saved.recordedAt);assert.equal(retained.backfilled,false);
  assert.equal(snapshot.achievements.persisted,true);assert.equal(snapshot.meetup.id,'point-7');assert.deepEqual(Array.from(snapshot.releases),[]);
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0,'achievement reads never release posters or change checkpoints');
});

test('authoritative saved crossing replaces a newer unsaved candidate regardless of recordedAt',async()=>{
  const saved=achievementRecord(),pending={...saved,crossedAt:null,backfilled:true,recordedAt:new Date(NOW+60000).toISOString(),evidence:{beforeAt:null,afterAt:saved.firstSeenBeyondAt}};
  const f=await load({registered:true,feeds:{'247':achievementFeed([pending],false)}});
  assert.equal(f.api.getSnapshot().achievements.persisted,false);assert.equal(f.api.getSnapshot().achievements.records[0].crossedAt,null);
  f.feeds['247']=achievementFeed([saved],true);await f.api.refresh();
  const ledger=f.api.getSnapshot().achievements;
  assert.equal(ledger.persisted,true);assert.equal(ledger.records[0].crossedAt,saved.crossedAt);assert.equal(ledger.records[0].recordedAt,saved.recordedAt);
  f.feeds['247']=achievementFeed([{...saved,crossedAt:new Date(NOW-30000).toISOString(),recordedAt:new Date(NOW+120000).toISOString()}],true);await f.api.refresh();
  assert.equal(f.api.getSnapshot().achievements.records[0].crossedAt,saved.crossedAt,'once confirmed, the first shared record remains immutable');
});

test('the combined achievement ledger is pending until every new crossing is confirmed saved',async()=>{
  const emily=achievementRecord(),jeff=achievementRecord('jeff');
  const f=await load({registered:true,feeds:{'247':achievementFeed([emily],true),'133':achievementFeed([jeff],false)}});
  assert.equal(f.api.getSnapshot().achievements.records.length,2);assert.equal(f.api.getSnapshot().achievements.persisted,false);
  f.feeds['133']=achievementFeed([emily,jeff],true);await f.api.refresh();
  assert.equal(f.api.getSnapshot().achievements.records.length,2);assert.equal(f.api.getSnapshot().achievements.persisted,true);
  f.feeds['133']=new Error('Offline');f.feeds['247']=new Error('Offline');await f.api.refresh();
  assert.equal(f.api.getSnapshot().achievements.records.length,2);assert.equal(f.api.getSnapshot().achievements.persisted,true,'a later poll failure does not erase saved history');
});

test('a public viewer cannot publish checkpoint stamps just by choosing Supporting',async()=>{
  const f=await load({mode:'supporter'});
  assert.equal(f.api.getSnapshot().room.canManageCheckpoints,false);
  assert.equal((await f.api.completeCheckpoint('point-1')).ok,false);
  assert.equal((await f.api.skipCheckpoint('point-1')).ok,false);
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  assert.equal(f.gpsRequests.length,0);
});

test('a connected supporter stamps and receives the shared next point without starting GPS',async()=>{
  const done={status:'met',at:new Date(NOW).toISOString()};
  const next={id:'point-2',label:'Point 2 · Willoughby',routeKm:37.1,lat:52.3,lng:-1.2,mapUrl:'https://www.google.com/maps/search/?api=1&query=52.3,-1.2',note:'Café'};
  const f=await load({locationOwner:true,mode:'supporter',patchReply:(patch,room)=>{
    assert.deepEqual(patch,{checkpoint:{action:'complete',pointId:'point-1'}});
    Object.assign(room,{meetup:next,completedPointIds:['meetup-mfg-coventry','point-1'],checkpointStatuses:{'point-1':done},lastCheckpointAction:{pointId:'point-1',action:'complete',completedAt:done.at}});
    return Response.json(room);
  }});
  assert.equal(f.api.getSnapshot().room.canManageCheckpoints,true);
  assert.equal((await f.api.completeCheckpoint('point-1')).ok,true);
  const patch=f.requests.find(r=>r.options?.method==='PATCH');
  assert.equal(patch.options.headers.Authorization,'Bearer '+locationToken);
  assert.equal(f.api.getSnapshot().meetup.id,'point-2');
  assert.equal(f.api.getSnapshot().checkpointStatuses['point-1'].status,'met');
  assert.equal(f.checkpointHydrate.at(-1).checkpointStatuses['point-1'].status,'met');
  assert.equal(f.hydrate.at(-1).value.id,'point-2');
  assert.equal(f.gpsRequests.length,0);
  assert.equal(f.api.getSnapshot().checkpointActionBusy,false);
});

test('checkpoint save failure leaves confirmed plan and stamps untouched',async()=>{
  const f=await load({locationOwner:true,room:{meetup:{id:'point-1'},checkpointStatuses:{},completedPointIds:['meetup-mfg-coventry']},patchReply:Response.json({code:'checkpoint_conflict',error:'Plan changed'},{status:409})});
  assert.equal((await f.api.skipCheckpoint('point-1')).ok,false);
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.meetup.id,'point-1');
  assert.equal(Object.keys(snapshot.checkpointStatuses).length,0);
  assert.match(snapshot.checkpointActionError,/changed on another phone/);
  assert.equal(snapshot.checkpointActionBusy,false);
  assert.equal(f.gpsRequests.length,0);
});

test('rapid checkpoint taps issue one request and preserve a concurrent GPS sharing session',async()=>{
  let resolve;
  const f=await load({owner:true,mode:'supporter',room:{sharing:true,position:{lat:52,lng:-1,accuracy:8,recordedAt:new Date(NOW).toISOString(),updatedAt:new Date(NOW).toISOString()}},patchReply:(patch,room)=>new Promise(done=>{resolve=()=>done(Response.json({...room,completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'skipped',at:new Date(NOW).toISOString()}},lastCheckpointAction:{pointId:'point-1',action:'skip',completedAt:new Date(NOW).toISOString()}}));})});
  const first=f.api.skipCheckpoint('point-1');await nextTick();
  assert.equal(f.api.getSnapshot().checkpointActionBusy,true);
  assert.equal((await f.api.completeCheckpoint('point-1')).reason,'busy');
  resolve();assert.equal((await first).ok,true);
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,1);
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString());
  assert.equal(f.api.getSnapshot().crew.sharing,true);
});
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }

async function load({ owner = false, legacy = false, runner = null, registered = false, configuredRunners=REGISTERED_RUNNERS, feeds = {}, room: initialRoom = {}, storage = new Map(), hash = '', initialBib = 'old-local', active = true, invalidControl = false, crewReply = null, now = NOW, throwMeetupRender = false, locationOwner = false, invalidLocationControl = false, patchReply = null, mode = 'runner', routeCoordinates = [[-1, 52], [-0.9, 52]] } = {}) {
  const events = [], requests = [], shared = [], notices = [], tabs=[], gpsRequests=[], gpsCallbacks=[], oneShotCallbacks=[], listeners = new Map(), documentListeners = new Map(), hydrate = [], checkpointHydrate=[], opened = [], gpsClears = [], intervals=new Map();
  let gpsStarts = 0, gpsCallback = null, oneShotCallback = null, oneShotError = null, roomExists = active, currentBib = initialBib,publicEnded=false,nextInterval=1;
  class TestDate extends ClockDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  let room = { expiresAt: new Date(NOW + 86400000).toISOString(), updatedAt: new Date(NOW).toISOString(), position: null, bib: '123', meetup: null, sharing: false, releases: [], googleMapsUrl:null, ...initialRoom };
  const supporterState=id=>room.supporters?.[id]||(id==='huiyan'?{position:room.position,sharing:room.sharing}:{position:null,sharing:false});
  const setRoom=value=>{
    if(Object.hasOwn(value,'position')||Object.hasOwn(value,'sharing')){
      const id=value.personId||'huiyan',entry={...supporterState(id)};
      if(Object.hasOwn(value,'position'))entry.position=value.position;
      if(Object.hasOwn(value,'sharing'))entry.sharing=value.sharing;
      if(value.sharing===false)entry.position=null;
      const other=Object.fromEntries(Object.entries(value).filter(([key])=>!['personId','position','sharing'].includes(key)));
      room={...room,...other,supporters:{...(room.supporters||{}),[id]:entry},...(id==='huiyan'?{position:entry.position,sharing:entry.sharing}:{})};
    }else room={...room,...value};
  };
  if(legacy)storage.set('meriden-private-crew-v1', JSON.stringify({ viewToken, ...(owner ? { publishToken } : {}), expiresAt: room.expiresAt }));
  else if(owner)storage.set('meriden-public-crew-v1',JSON.stringify({publishToken,expiresAt:room.expiresAt}));
  if(locationOwner)storage.set('meriden-public-location-v1',JSON.stringify({token:locationToken,expiresAt:room.expiresAt}));
  const dispatchEvent = event => { events.push(event); for (const listener of listeners.get(event.type) || []) listener(event); };
  const addEventListener = (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]);
  const panel={innerHTML:'',querySelector(){return null;}},setupDisclosure={open:false},codeInput={value:'',focused:false,scrolled:false,focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;}};
  const location={hash:hash||(legacy?'#crew='+viewToken:''),pathname:'/',search:'',origin:'https://crew.example.test'};
  const context = {
    Date: TestDate, URL, AbortController, console, queueMicrotask, setTimeout, clearTimeout,
    setInterval(callback,ms){const id=nextInterval++;intervals.set(id,{callback,ms,next:now+ms});return id;},
    clearInterval(id){intervals.delete(id);},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    location, history: { replaceState(a,b,url) {location.hash=new URL(url,location.origin).hash;} },
    document: { hidden: false, activeElement: null, querySelector: selector => selector==='#live-sharing-panel'?panel:selector==='#live-location-code'?codeInput:selector==='#live-location-setup'?setupDisclosure:null, addEventListener(type,listener){documentListeners.set(type,[...(documentListeners.get(type)||[]),listener]);} },
    navigator: { geolocation: { getCurrentPosition(callback,error,options){oneShotCallback=callback;oneShotError=error;oneShotCallbacks.push(callback);gpsRequests.push({kind:'once',options});}, watchPosition(callback,error,options) { gpsCallback=callback;gpsCallbacks.push(callback);gpsRequests.push({kind:'watch',options}); return ++gpsStarts; }, clearWatch(id) {gpsClears.push(id);gpsCallback=null;} } },
    notify(value) {notices.push(value);}, state:{mode}, switchTab(tab) {tabs.push(tab);}, shareText(...args) {shared.push(args);},
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === 'data/route.geojson') return Response.json({ type: 'LineString', coordinates: routeCoordinates });
      if (path.startsWith('/api/tracker')) {
        if(registered){
          const bib=new URL(path,'https://crew.example.test').searchParams.get('bib'),feed=feeds[bib];
          if(feed instanceof Error)throw feed;
          if(feed instanceof Response)return feed.clone();
          return Response.json(feed||{status:'waiting',participants:[]});
        }
        return Response.json({ status: runner ? 'live' : 'waiting', participants: runner ? [runner] : [] });
      }
      if ((path==='/api/crew?public=1'||path==='/api/crew')&&(!options?.method||options.method==='GET')&&crewReply){if(crewReply instanceof Error)throw crewReply;if(typeof crewReply==='function')return crewReply();return crewReply.clone();}
      if (path === '/api/crew?public=1')return Response.json({public:true,status:publicEnded?'ended':roomExists?'active':'waiting',room:publicEnded?null:roomExists?room:null});
      if (path === '/api/crew') {
        if (options?.method === 'POST'&&JSON.parse(options.body).action==='activate-public'){
          if(invalidControl)return Response.json({error:'Invalid control'},{status:403});
          roomExists=true;return Response.json({public:true,status:'active',room});
        }
        if(options?.method==='POST'&&JSON.parse(options.body).action==='activate-location'){
          if(invalidLocationControl)return Response.json({error:'Invalid location control',code:'location_access_required'},{status:403});
          if(!roomExists||Date.parse(room.expiresAt)<=now)return Response.json({error:'Session ended',code:'public_session_ended'},{status:410});
          return Response.json({public:true,status:'active',room,capability:'location'});
        }
        if (options?.method === 'PATCH') {
          const patch = JSON.parse(options.body);
          if(patchReply){if(patchReply instanceof Error)throw patchReply;if(typeof patchReply==='function')return patchReply(patch,room);return patchReply.clone();}
          if(patch.position&&!supporterState(patch.personId||'huiyan').sharing&&patch.sharing!==true)return Response.json({code:'sharing_stopped',error:'Location sharing is stopped.'},{status:409});
          setRoom(Object.fromEntries(Object.entries(patch).filter(([key])=>key!=='celebration')));
          if (patch.celebration && !room.releases.some(r => r.id === patch.celebration)) room = { ...room, releases: [...room.releases, { id: patch.celebration, releasedAt: new Date(NOW).toISOString() }] };
        }
        if(options?.method==='DELETE'){publicEnded=true;roomExists=false;return Response.json({revoked:true});}
        return Response.json(room);
      }
      throw new Error('Unexpected network request');
    }
  };
  context.window = { isSecureContext: true, addEventListener, dispatchEvent, open(...args){opened.push(args);},confirm:()=>true,crewGuide: { getBib: () => currentBib, setSharedBib(value){currentBib=value;} }, supportGuide: { setSharedCheckpointState(value){checkpointHydrate.push(value);}, setSharedMeetup(value){hydrate.push({kind:'shared',value});if(throwMeetupRender&&value)throw new Error('Test view failed');},setOwnedMeetup(value){hydrate.push({kind:'owned',value});}, setTrackerProgress() {} } };
  if(registered)context.window.crewGuide.getRunners=()=>configuredRunners;
  const focused=[];
  context.window.raceMap={focusPerson(id){focused.push(id);}};
  vm.runInNewContext(etaSource, context, { filename: 'arrival-eta.js' });
  vm.runInNewContext(source, context, { filename: 'live.js' });
  await nextTick(); await nextTick();
  const click=async(action,personId)=>{for(const fn of documentListeners.get('click')||[])await fn({target:{closest(){return {dataset:{liveAction:action,personId}};}}});await nextTick();};
  const emitPosition=async()=>{gpsCallback?.({coords:{latitude:52,longitude:-.94,accuracy:8},timestamp:NOW});await nextTick();await nextTick();};
  const emitOneShotPosition=async(position={coords:{latitude:52,longitude:-.92,accuracy:7},timestamp:now})=>{await oneShotCallback?.(position);await nextTick();await nextTick();};
  const emitOneShotError=async error=>{oneShotError?.(error);await nextTick();await nextTick();};
  const connect=async code=>{codeInput.value=code;for(const fn of documentListeners.get('submit')||[])await fn({target:{id:'live-location-form'},preventDefault(){}});await nextTick();};
  const emitWindow=async(type,details={})=>{dispatchEvent({type,...details});await nextTick();await nextTick();};
  const setVisibility=async hidden=>{context.document.hidden=hidden;for(const fn of documentListeners.get('visibilitychange')||[])fn();await nextTick();await nextTick();};
  const advanceTimers=async ms=>{
    const end=now+ms;
    while(true){
      const next=Math.min(...[...intervals.values()].map(timer=>timer.next));
      if(next>end)break;
      now=next;
      for(const [id,timer] of [...intervals])if(intervals.has(id)&&timer.next===next){timer.next+=timer.ms;timer.callback();}
      await nextTick();await nextTick();
    }
    now=end;
  };
  return { emitOldOneShot:async index=>{await oneShotCallbacks[index]?.({coords:{latitude:51,longitude:-.7,accuracy:9},timestamp:now});await nextTick();await nextTick();},emitOldWatch:async index=>{gpsCallbacks[index]?.({coords:{latitude:51,longitude:-.7,accuracy:9},timestamp:now});await nextTick();await nextTick();},tabs,gpsRequests,connect,codeInput,setupDisclosure,emitOneShotPosition,emitOneShotError,advanceTimers,advanceTime:ms=>now+=ms,setPatchReply:reply=>patchReply=reply,getRoom:()=>structuredClone(room), api: context.window.liveGuide, events, requests, storage, shared, notices, panel, location, hydrate, checkpointHydrate, click, focused, feeds, opened, gpsClears, emitPosition, emitWindow, setVisibility, gpsStarts: () => gpsStarts, setRoom,setCrewReply:reply=>crewReply=reply };
}

test('snapshot has fresh route distance without exposing room credentials or starting GPS', async () => {
  const f = await load({ runner: { lat: 52, lng: -0.95, name: 'Emily and Jeff', bib: '123', updatedAt: new Date(NOW - 10000).toISOString() } });
  const snapshot = f.api.getSnapshot();
  assert.equal(snapshot.runner.fresh, true);
  assert(snapshot.runner.routeKm > 3 && snapshot.runner.routeKm < 4);
  assert.equal(snapshot.room.owner, false);
  assert.equal(JSON.stringify(snapshot).includes(viewToken), false);
  assert.equal(f.gpsStarts(), 0);
  assert(f.events.some(event => event.type === 'liveupdate'));
});

test('old or off-route reports have no current running-distance claim', async () => {
  const stale = await load({ runner: { lat: 52, lng: -0.95, updatedAt: new Date(NOW - 10 * 60000).toISOString() } });
  assert.equal(stale.api.getSnapshot().runner.routeKm, null);
  assert.equal(stale.api.getSnapshot().runner.fresh, false);
  const offRoute = await load({ runner: { lat: 52.1, lng: -0.95, updatedAt: new Date(NOW - 10000).toISOString() } });
  assert.equal(offRoute.api.getSnapshot().runner.routeKm, null);
  assert(offRoute.api.getSnapshot().runner.offRouteM > 500);
});

test('celebrations acknowledge per device, do not replay on polling/reload, and never start GPS', async () => {
  const release = { id: 'km-60', releasedAt: new Date(NOW - 1000).toISOString() };
  const f = await load({ owner: true, room: { releases: [release] } });
  assert.equal(f.api.pendingReleases().length, 1);
  assert.equal(f.events.filter(e => e.type === 'celebrationrelease').length, 1);
  assert.equal(f.api.acknowledgeCelebration(release.id, release.releasedAt), true);
  f.api.refresh(); await nextTick();
  assert.equal(f.api.pendingReleases().length, 0);
  assert.equal(f.events.filter(e => e.type === 'celebrationrelease').length, 1);
  const again = await load({ owner: true, room: { releases: [release] }, storage: f.storage });
  assert.equal(again.api.pendingReleases().length, 0);
  const sent = await again.api.releaseCelebration('km-70'); await nextTick();
  assert.equal(sent.ok, true);
  assert.equal(again.api.pendingReleases()[0].id, 'km-70');
  const patches = again.requests.filter(r => r.options?.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.deepEqual(JSON.parse(patches[0].options.body), { celebration: 'km-70' });
  assert.equal(again.gpsStarts(), 0);
});


test('a fresh visitor gets the public crew position and shared bib without a key or GPS permission', async()=>{
  const position={lat:52,lng:-0.94,accuracy:8,recordedAt:new Date(NOW-5000).toISOString(),updatedAt:new Date(NOW-5000).toISOString()};
  const f=await load({room:{position,sharing:true,bib:'456'},runner:{lat:52,lng:-0.95,bib:'456',updatedAt:new Date(NOW-10000).toISOString()}});
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.room.public,true);assert.equal(snapshot.room.joined,true);assert.equal(snapshot.room.owner,false);
  assert.equal(snapshot.bib,'456');assert.equal(snapshot.crew.lat,52);assert.equal(snapshot.crew.fresh,true);assert.equal(snapshot.runner.bib,'456');
  assert.equal(f.gpsStarts(),0);
  const reads=f.requests.filter(r=>r.path==='/api/crew?public=1');assert(reads.length>0);assert(reads.every(r=>!r.options.headers.Authorization));
  assert(f.requests.some(r=>r.path==='/api/tracker?bib=456'));
  assert.equal(f.requests.some(r=>r.options?.method==='POST'||r.options?.method==='PATCH'),false);
  assert.equal(f.panel.innerHTML.includes('Create private crew link'),false);
  assert.equal((await f.api.releaseCelebration('km-60')).ok,false);
});

test('a saved legacy private room cannot intercept a normal public visit',async()=>{
  const storage=new Map([['meriden-private-crew-v1',JSON.stringify({viewToken,publishToken,expiresAt:'2020-01-01T00:00:00Z'})]]);
  const f=await load({storage,active:false});
  assert.equal(f.api.getSnapshot().room.public,true);assert.equal(f.api.getSnapshot().room.owner,false);
  assert(f.requests.some(r=>r.path==='/api/crew?public=1'));
  assert.equal(f.requests.some(r=>r.path==='/api/crew'),false);
  assert.match(f.panel.innerHTML,/Waiting for supporters/);assert.doesNotMatch(f.panel.innerHTML,/Create private|expired link/);
});

test('public supporter setup validates control, strips the fragment and never publishes stale local settings',async()=>{
  const meetup={id:'point-6',label:'Point 6',lat:52,lng:-0.94,mapUrl:'https://www.google.com/maps/search/?api=1&query=52,-.94'};
  const f=await load({hash:'#support='+publishToken,initialBib:'OLD',room:{bib:'789',meetup}});
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.room.owner,true);assert.equal(snapshot.bib,'789');assert.equal(f.gpsStarts(),0);
  assert.equal(f.location.hash,'#live');assert.equal(f.hydrate.some(h=>h.kind==='owned'&&h.value?.id==='point-6'),true);
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  const activation=f.requests.find(r=>r.options?.method==='POST');assert.equal(activation.options.headers.Authorization,'Bearer '+publishToken);
  assert.equal(JSON.stringify(snapshot).includes(publishToken),false);assert.equal(f.panel.innerHTML.includes(publishToken),false);
  await f.click('invite');assert.equal(f.shared[0][2],'https://crew.example.test/#now');assert.equal(JSON.stringify(f.shared).includes(publishToken),false);
});

test('invalid supporter credentials do not hide the public feed or grant publishing controls',async()=>{
  const f=await load({hash:'#support='+publishToken,invalidControl:true,room:{bib:'789'}});
  assert.equal(f.api.getSnapshot().room.owner,false);assert.equal(f.api.getSnapshot().bib,'789');assert.equal(f.gpsStarts(),0);
  assert.equal((await f.api.releaseCelebration('km-70')).ok,false);
  assert.match(f.panel.innerHTML,/public map still works/);
});

test('an explicit legacy private invitation still reads only its private room',async()=>{
  const f=await load({legacy:true,owner:true});
  assert.equal(f.api.getSnapshot().room.public,false);assert.equal(f.api.getSnapshot().room.owner,true);
  assert(f.requests.some(r=>r.path==='/api/crew'&&r.options.headers.Authorization==='Bearer '+viewToken));
  assert.equal(f.requests.some(r=>r.path==='/api/crew?public=1'),false);
  assert.equal(f.gpsStarts(),0);
});


test('public publisher GPS starts only after its explicit Start action',async()=>{
  const f=await load({owner:true});
  assert.equal(f.gpsRequests.length,0);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  await f.click('start');
  assert.equal(f.gpsRequests.length,1);assert.equal(f.gpsRequests[0].kind,'once');
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0,'Start waits for the phone’s first real fix');
  await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH');
  assert.equal(patches.length,1);assert.equal(JSON.parse(patches[0].options.body).sharing,true);
  assert.equal(patches[0].options.headers.Authorization,'Bearer '+publishToken);
  assert.equal(f.api.getSnapshot().sharing.requested,true);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  assert.equal(f.gpsStarts(),0,'watchPosition is not needed for a fresh periodic sample');
});

test('saved Maps data remains compatible without a click-out link or a fabricated site position',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  for(const owner of [false,true]){
    const f=await load({owner,room:{googleMapsUrl,position:null,sharing:false}});
    assert.equal(f.api.getSnapshot().googleMapsUrl,googleMapsUrl);
    assert.equal(f.api.getSnapshot().crew,null);assert.equal(f.gpsRequests.length,0);
    assert.doesNotMatch(f.panel.innerHTML,/Google Maps|maps.app.goo.gl|crew-location/);
    f.api.showCrewOnMap();assert.deepEqual(f.opened,[]);assert.equal(f.tabs.at(-1),'live');
  }
});

test('stale and fresh site positions both stay on this map and show true report ages',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  for(const owner of [false,true]){
    for(const secondsOld of [1,3600]){
      const position={lat:52,lng:-.94,accuracy:8,recordedAt:new Date(NOW-secondsOld*1000).toISOString()};
      const f=await load({owner,room:{googleMapsUrl,position,sharing:true}});
      f.api.showCrewOnMap();
      assert.deepEqual(f.opened,[]);assert.deepEqual(f.focused,['crew']);
      assert.equal(f.api.getSnapshot().crew.fresh,secondsOld<300);
      assert.match(f.panel.innerHTML,secondsOld<300?/just now|1 second ago/:/1h 0m ago/);
      assert.doesNotMatch(f.panel.innerHTML,/Google Maps|maps.app.goo.gl/);assert.equal(f.gpsRequests.length,0);
      f.api.showCrewLocationControls();assert.equal(f.tabs.at(-1),'live');assert.equal(f.gpsRequests.length,0);
    }
  }
});

test('a server stop pauses automatic updates and requires a new explicit Start',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  const f=await load({owner:true,room:{googleMapsUrl}});
  await f.click('start');await f.emitOneShotPosition();
  await f.advanceTimers(30000);assert.equal(f.gpsRequests.length,2);
  // Another supporter tab stops sharing before this automatic sample arrives.
  f.setRoom({sharing:false,position:null});
  await f.emitOneShotPosition();
  let snapshot=f.api.getSnapshot();
  assert.equal(snapshot.sharing.requested,false);assert.equal(snapshot.sharing.gpsStatus,'paused');
  assert.equal(snapshot.room.error,null);assert.equal(snapshot.crew,null);
  assert.equal(snapshot.googleMapsUrl,googleMapsUrl);
  const sent=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(Object.hasOwn(sent.at(-1),'sharing'),false,'a timer cannot restart server sharing');
  assert.match(f.panel.innerHTML,/data-live-action="start"/);
  assert.match(f.panel.innerHTML,/location sharing is stopped/);
  const patchCount=sent.length;
  await f.advanceTimers(60000);await f.api.refresh();
  assert.equal(f.gpsRequests.length,2);
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,patchCount);
  await f.click('start');await f.emitOneShotPosition();
  snapshot=f.api.getSnapshot();
  assert.equal(f.gpsRequests.length,3);assert.equal(snapshot.sharing.gpsStatus,'sharing');
  assert.equal(snapshot.crew.fresh,true);
});

test('ordinary navigation clears sharing intent, retains the real report and does not restart on reload',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  const f=await load({owner:true,room:{googleMapsUrl}});
  await f.click('start');await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  await f.emitWindow('pagehide');
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.sharing.gpsStatus,'stopped');assert.equal(snapshot.sharing.requested,false);
  assert.equal(snapshot.crew.lng,-.92);assert.equal(snapshot.crew.recordedAt,new Date(NOW).toISOString());assert.equal(snapshot.googleMapsUrl,googleMapsUrl);
  assert.match(f.panel.innerHTML,/Share Huiyan · every 30s/);
  await f.setVisibility(false);await f.advanceTimers(90000);
  assert.equal(f.gpsRequests.length,1);
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.filter(p=>p.sharing===true).length,1);
  assert.equal(patches.filter(p=>p.sharing===false).length,0);
  const reloaded=await load({storage:f.storage,room:f.getRoom()});
  await reloaded.emitWindow('pageshow');await reloaded.setVisibility(false);await reloaded.advanceTimers(90000);
  assert.equal(reloaded.gpsRequests.length,0);assert.equal(reloaded.api.getSnapshot().sharing.requested,false);
});

test('an existing automatic session resumes on return with a fresh fix and then every 30 seconds',async()=>{
  const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
  await f.setVisibility(true);
  assert.equal(f.api.getSnapshot().sharing.requested,true);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'paused');
  assert.match(f.panel.innerHTML,/resumes automatically when you return/);
  await f.advanceTimers(120000);
  assert.equal(f.gpsRequests.length,1,'hidden time makes no GPS requests');
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString());
  await f.setVisibility(false);
  assert.equal(f.gpsRequests.length,2,'returning starts one fresh request without another click');
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString(),'returning alone cannot refresh the report age');
  await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW+120000).toISOString());
  await f.advanceTimers(29000);assert.equal(f.gpsRequests.length,2);
  await f.advanceTimers(1000);assert.equal(f.gpsRequests.length,3);await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches[0].sharing,true);
  assert(patches.slice(1).every(p=>Object.keys(p).length===2&&p.position&&p.personId==='huiyan'),'resume and ticks only send the acquired position for this person');
});

test('back-forward-cache restoration resumes once even when visibility and pageshow both fire',async()=>{
  const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
  await f.emitWindow('pagehide',{persisted:true});
  assert.equal(f.api.getSnapshot().sharing.requested,true);
  await f.advanceTimers(60000);assert.equal(f.gpsRequests.length,1);
  await f.emitWindow('pageshow',{persisted:true});await f.setVisibility(false);
  assert.equal(f.gpsRequests.length,2);
  await f.emitOneShotPosition();await f.emitWindow('pageshow',{persisted:true});
  await f.advanceTimers(30000);assert.equal(f.gpsRequests.length,3,'only one update interval is restored');
});

test('explicit Stop while paused prevents visibility and cached-page events from resuming GPS',async()=>{
  const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
  await f.setVisibility(true);await f.click('stop');
  await f.setVisibility(false);await f.emitWindow('pageshow',{persisted:true});await f.advanceTimers(90000);
  assert.equal(f.gpsRequests.length,1);assert.equal(f.api.getSnapshot().sharing.requested,false);
  assert.equal(f.api.getSnapshot().crew,null);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'stopped');
});

test('another supporter stop is respected before resume and while the resumed fix is pending',async()=>{
  for(const timing of ['before-return','after-return']){
    const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
    await f.setVisibility(true);await f.advanceTimers(60000);
    if(timing==='before-return')f.setRoom({sharing:false,position:null});
    await f.setVisibility(false);
    if(timing==='after-return'){
      f.setRoom({sharing:false,position:null});await f.emitOneShotPosition();
      const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
      assert.equal(Object.hasOwn(patches.at(-1),'sharing'),false,'resuming cannot undo the other phone’s Stop');
    }
    const requests=f.gpsRequests.length;
    assert.equal(requests,timing==='before-return'?1:2);
    assert.equal(f.api.getSnapshot().sharing.requested,false);assert.equal(f.api.getSnapshot().crew,null);
    await f.setVisibility(true);await f.setVisibility(false);await f.advanceTimers(90000);
    assert.equal(f.gpsRequests.length,requests);
  }
});

test('a Stop or a second hide during the return refresh cancels the pending resume',async()=>{
  for(const action of ['stop','hide']){
    const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
    await f.setVisibility(true);await f.advanceTimers(60000);
    let resolve;
    f.setCrewReply(()=>new Promise(done=>{resolve=()=>done(Response.json({public:true,status:'active',room:f.getRoom()}));}));
    await f.setVisibility(false);assert.equal(f.gpsRequests.length,1,'resume checks current shared state first');
    if(action==='stop')await f.click('stop');else await f.setVisibility(true);
    resolve();await nextTick();await nextTick();
    assert.equal(f.gpsRequests.length,1,'a completed refresh cannot resume a cancelled or hidden session');
    assert.equal(f.api.getSnapshot().sharing.requested,action==='hide');
    f.setCrewReply(null);
    await f.setVisibility(false);
    assert.equal(f.gpsRequests.length,action==='hide'?2:1);
  }
});

test('Update now during the return refresh restores the automatic cadence after success or a timeout',async()=>{
  for(const result of ['success','timeout']){
    const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
    await f.setVisibility(true);await f.advanceTimers(60000);
    let resolve;
    f.setCrewReply(()=>new Promise(done=>{resolve=()=>done(Response.json({public:true,status:'active',room:f.getRoom()}));}));
    await f.setVisibility(false);await f.click('update-location');
    assert.equal(f.gpsRequests.length,2);
    if(result==='success')await f.emitOneShotPosition();else await f.emitOneShotError({code:3});
    resolve();await nextTick();await nextTick();f.setCrewReply(null);
    assert.equal(f.api.getSnapshot().sharing.requested,true);
    await f.advanceTimers(29000);assert.equal(f.gpsRequests.length,2);
    await f.advanceTimers(1000);assert.equal(f.gpsRequests.length,3,'manual interaction during resume does not strand the automatic session');
    await f.emitOneShotPosition();assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  }
});

test('expiry, revoked sharing, and GPS permission denial prevent later automatic resumption',async()=>{
  for(const reason of ['expiry','revoked','denied']){
    const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
    if(reason==='denied'){
      await f.advanceTimers(30000);await f.emitOneShotError({code:1});
    }
    await f.setVisibility(true);
    if(reason==='expiry')await f.advanceTimers(86400001);
    if(reason==='revoked')f.setCrewReply(Response.json({public:true,status:'ended',room:null}));
    await f.setVisibility(false);await f.emitWindow('pageshow',{persisted:true});
    assert.equal(f.api.getSnapshot().sharing.requested,false);
    assert.equal(f.gpsRequests.length,reason==='denied'?2:1);
    await f.advanceTimers(60000);assert.equal(f.gpsRequests.length,reason==='denied'?2:1);
  }
});

test('a Start interrupted before its first shared fix does not silently enable server sharing on return',async()=>{
  const f=await load({locationOwner:true});await f.click('start');
  await f.setVisibility(true);await f.advanceTimers(60000);await f.setVisibility(false);
  assert.equal(f.gpsRequests.length,1);assert.equal(f.api.getSnapshot().sharing.requested,false);
  await f.emitOldOneShot(0);
  assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false);
  assert.match(f.panel.innerHTML,/location sharing is stopped/);
});

function report(bib,lng,secondsOld=10){
  return {status:'live',event:{active:true},participants:[{bib,name:bib==='247'?'Emily Simmons':'Jeff Simmons',lat:52,lng,updatedAt:new Date(NOW-secondsOld*1000).toISOString()}]};
}

function pacedReport(bib,lng,travelLongitude){
  const feed=report(bib,lng);
  feed.participants[0].recentReports=Array.from({length:6},(_,index)=>({
    lat:52,lng:lng-travelLongitude*(5-index)/5,
    recordedAt:new Date(NOW-10000-(5-index)*120000).toISOString()
  }));
  return feed;
}

test('each runner receives recent along-route pace from their own timed tracker samples',async()=>{
  const f=await load({registered:true,feeds:{'247':pacedReport('247',-.96,.016),'133':pacedReport('133',-.94,.009)}});
  const s=f.api.getSnapshot();
  assert(s.runners.emily.speedKmh>6&&s.runners.emily.speedKmh<7);
  assert(s.runners.jeff.speedKmh>3&&s.runners.jeff.speedKmh<4);
  assert.equal(s.runners.emily.paceSource,'recent-tracker-route');
  assert.equal(s.runners.jeff.paceSource,'recent-tracker-route');
  assert.equal(s.runners.emily.paceWindowMinutes,10);
  assert(s.runners.emily.paceMinPerKm<s.runners.jeff.paceMinPerKm);
  assert.equal(Object.hasOwn(s.runners.emily,'recentReports'),false);
  assert.equal(f.gpsStarts(),0);
});

test('a sparse new tracker fix retains Emily’s earlier measured route pace without borrowing a runner or drifting on redraw',async()=>{
  const emily=pacedReport('247',-.96,.016);
  const f=await load({registered:true,feeds:{'247':emily,'133':report('133',-.94)}});
  const before=f.api.getSnapshot().runners.emily;
  assert.equal(before.paceSource,'recent-tracker-route');
  f.advanceTime(60000);
  f.feeds['247']=report('247',-.958,0);
  f.feeds['247'].participants[0].updatedAt=new Date(NOW+60000).toISOString();
  // The location provider returned a current fix, but its path request failed.
  f.feeds['247'].participants[0].recentReports=[];
  f.feeds['247'].participants[0].paceReports=[];
  await f.api.refresh();
  const current=f.api.getSnapshot().runners.emily;
  assert.equal(current.paceSource,'held-tracker-route');
  assert.equal(current.paceMeasuredAt,before.recordedAt);
  assert.equal(current.speedKmh,before.speedKmh);
  assert.equal(f.api.getSnapshot().runners.jeff.paceSource,null);
  assert.equal(f.api.getSnapshot().runners.emily.paceSource,'held-tracker-route');
  f.advanceTime(5*60000);
  assert.equal(f.api.getSnapshot().runners.emily.paceSource,null,'a five-minute-old GPS position cannot supply a new ETA');
});

test('a new visitor can recover earlier measured pace from a long GPS path when short history is missing',async()=>{
  const emily=pacedReport('247',-.96,.016);
  emily.participants[0].paceReports=emily.participants[0].recentReports;
  emily.participants[0].recentReports=[];
  const f=await load({registered:true,feeds:{'247':emily}});
  const current=f.api.getSnapshot().runners.emily;
  assert.equal(current.paceSource,'held-tracker-route');
  assert(current.speedKmh>6&&current.speedKmh<7);
  assert.equal(current.paceMeasuredAt,new Date(NOW-130000).toISOString());
  assert.equal(f.gpsStarts(),0);
});

test('a page reload can reuse only a short-lived, same-bib verified pace without storing coordinates',async()=>{
  const storage=new Map();
  const first=await load({registered:true,storage,feeds:{'247':pacedReport('247',-.96,.016)}});
  assert.equal(first.api.getSnapshot().runners.emily.paceSource,'recent-tracker-route');
  const raw=storage.get('meriden-verified-route-pace-event-35950-v1');
  assert(raw);
  assert.doesNotMatch(raw,/"lat"|"lng"|"publishToken"/);
  const fresh=report('247',-.958);
  fresh.participants[0].updatedAt=new Date(NOW+60000).toISOString();
  const reloaded=await load({registered:true,storage,now:NOW+60000,feeds:{'247':fresh}});
  assert.equal(reloaded.api.getSnapshot().runners.emily.paceSource,'held-tracker-route');
  const wrongBib=await load({registered:true,storage,now:NOW+60000,configuredRunners:[{id:'emily',bib:'555',name:'Emily',shortName:'Emily'}],feeds:{'555':{...fresh,participants:[{...fresh.participants[0],bib:'555'}]}}});
  assert.equal(wrongBib.api.getSnapshot().runners.emily.paceSource,null,'another number must never inherit Emily’s pace');
  const expired=await load({registered:true,storage,now:NOW+16*60000,feeds:{'247':{...fresh,participants:[{...fresh.participants[0],updatedAt:new Date(NOW+16*60000).toISOString()}]}}});
  assert.equal(expired.api.getSnapshot().runners.emily.paceSource,null);
});

test('pace follows the bends of the planned route instead of the crow-flight displacement',async()=>{
  // The runner covers three sides of a rectangle in ten minutes. The direct
  // start-to-end displacement is only its northward side (about 556 metres).
  const routeCoordinates=[[-1,52],[-.995,52],[-.995,52.005],[-1,52.005],[-1,52.01]];
  const positions=[[-1,52],[-.9975,52],[-.995,52],[-.995,52.0025],[-.995,52.005],[-1,52.005]];
  const emily=report('247',-1);
  Object.assign(emily.participants[0],{
    lat:52.005,crowKm:.556,speedKmh:3.336,
    recentReports:positions.map(([lng,lat],index)=>({lat,lng,recordedAt:new Date(NOW-10000-(5-index)*120000).toISOString()}))
  });
  const f=await load({registered:true,routeCoordinates,feeds:{'247':emily,'133':report('133',-1)}});
  const runner=f.api.getSnapshot().runners.emily;
  assert(runner.routeKm>1.23&&runner.routeKm<1.25,'planned progress includes both east/west sides');
  assert(runner.speedKmh>7.38&&runner.speedKmh<7.5,'1.24 route kilometres in ten minutes');
  assert(runner.speedKmh>2*emily.participants[0].speedKmh,'provider crow-flight speed is not reused');
  assert.equal(runner.paceSource,'recent-tracker-route');
  assert.equal(runner.paceWindowMinutes,10);
});

test('a missing or stale pace cannot borrow from a runner or a planning speed',async()=>{
  const emily=pacedReport('247',-.96,.016),jeff=report('133',-.94);
  jeff.participants[0].speedKmh=8;
  const f=await load({registered:true,feeds:{'247':emily,'133':jeff}});
  let s=f.api.getSnapshot();
  assert(s.runners.emily.speedKmh>0);
  assert.equal(s.runners.jeff.speedKmh,null);
  assert.equal(s.runners.jeff.paceSource,null);
  f.advanceTime(5*60000);
  s=f.api.getSnapshot();
  assert.equal(s.runners.emily.fresh,false);
  assert.equal(s.runners.emily.speedKmh,null);
});

test('registered numbers are automatic for every viewer and remain separate despite an old room bib',async()=>{
  const f=await load({registered:true,room:{bib:'old-local'},feeds:{'247':report('247',-.96),'133':report('133',-.94)}});
  const s=f.api.getSnapshot();
  assert.equal(s.bib,'247,133');assert.equal(s.runnerTracking.emily.bib,'247');assert.equal(s.runnerTracking.jeff.bib,'133');
  assert.equal(s.runners.emily.lng,-.96);assert.equal(s.runners.jeff.lng,-.94);
  assert.equal(s.runners.emily.name,'Emily Simmons');assert.equal(s.runners.jeff.name,'Jeff Simmons');
  assert.equal(s.runner.summaryRunnerId,'emily');assert.equal(s.runner.routeKm,s.runners.emily.routeKm);
  assert(f.requests.some(r=>r.path==='/api/tracker?bib=247'));assert(f.requests.some(r=>r.path==='/api/tracker?bib=133'));
  assert.equal(f.requests.some(r=>r.path.includes('bib=old-local')),false);
  assert.equal(f.requests.some(r=>['POST','PATCH'].includes(r.options?.method)),false);
  assert.equal(f.gpsStarts(),0);
  f.api.showRunnerOnMap('emily');f.api.showRunnerOnMap('jeff');assert.deepEqual(f.focused,['emily'],'Jeff’s avatar belongs to his supporter phone and never falls back to his old official position');
});

test('a missing or stale runner never borrows a report while the other usable tracker supplies progress',async()=>{
  const f=await load({registered:true,active:false,feeds:{'247':report('247',-.96)}});
  let s=f.api.getSnapshot();
  assert.equal(s.runners.jeff,null);assert.equal(s.runners.emily.bib,'247');assert.equal(s.runner.routeKm,s.runners.emily.routeKm);
  assert.equal(s.runnerTracking.jeff.status,'waiting');assert.equal(s.bib,'247,133');
  f.feeds['133']=report('133',-.98,600);f.api.refresh();await nextTick();await nextTick();
  s=f.api.getSnapshot();assert.equal(s.runners.jeff.fresh,false);assert.equal(s.runners.jeff.lng,-.98);assert.equal(s.runner.routeKm,s.runners.emily.routeKm);
  f.feeds['133']=report('133',-.98,5);f.api.refresh();await nextTick();await nextTick();
  s=f.api.getSnapshot();assert.equal(s.runner.summaryRunnerId,'jeff');assert.equal(s.runner.routeKm,s.runners.jeff.routeKm);
});

test('one tracker failure retains its recent timed fix while the newer usable runner supplies progress',async()=>{
  const f=await load({registered:true,feeds:{'247':report('247',-.96),'133':report('133',-.94)}});
  f.feeds['247']=new Error('Provider unavailable');f.feeds['133']=report('133',-.93,5);
  f.api.refresh();await nextTick();await nextTick();
  const s=f.api.getSnapshot();
  assert.equal(s.runners.emily.lng,-.96);assert.equal(s.runners.emily.fresh,true);assert.equal(s.runners.emily.reportCached,true);assert.equal(s.runnerTracking.emily.status,'unavailable');
  assert.equal(s.runners.jeff.lng,-.93);assert.equal(s.runners.jeff.fresh,true);assert.equal(s.runner.routeKm,s.runners.jeff.routeKm);
  assert.equal(s.runner.summaryRunnerId,'jeff');
});

test('summary uses the freshest complete tracker and falls back without mixing position and pace',async()=>{
  const emily=pacedReport('247',-.96,.016),jeff=pacedReport('133',-.94,.009);
  jeff.participants[0].updatedAt=new Date(NOW-5000).toISOString();
  const f=await load({registered:true,feeds:{'247':emily,'133':jeff}});
  let s=f.api.getSnapshot();
  assert.equal(s.runner.summaryRunnerId,'jeff');assert.equal(s.runner.summaryRunnerName,'Jeff');
  assert.equal(s.runner.routeKm,s.runners.jeff.routeKm);assert.equal(s.runner.paceMinPerKm,s.runners.jeff.paceMinPerKm);
  assert.equal(s.runner.summarySelectionReason,'latest-route-pace');
  f.feeds['133']=report('133',-.93,1);f.api.refresh();await nextTick();await nextTick();
  s=f.api.getSnapshot();
  assert.equal(s.runner.summaryRunnerId,'emily');assert.equal(s.runner.summarySelectionReason,'route-pace-fallback');
  assert.equal(s.runner.routeKm,s.runners.emily.routeKm);assert.equal(s.runner.paceMinPerKm,s.runners.emily.paceMinPerKm);
  assert.equal(s.runners.jeff.lng,-.93);assert.equal(s.runners.jeff.paceMinPerKm,null);
});

test('recent cached tracker history survives a transient failure, then expires from its original GPS time',async()=>{
  const f=await load({registered:true,feeds:{'247':pacedReport('247',-.96,.016)}});
  const original=f.api.getSnapshot().runners.emily.recordedAt;
  f.feeds['247']=new Error('Temporary failure');f.api.refresh();await nextTick();await nextTick();
  let s=f.api.getSnapshot();
  assert.equal(s.runner.summaryRunnerId,'emily');assert.equal(s.runners.emily.fresh,true);assert.equal(s.runners.emily.reportCached,true);
  assert(s.runner.speedKmh>0);assert.equal(s.runner.recordedAt,original);assert.equal(s.runnerTracking.emily.status,'unavailable');
  f.advanceTime(5*60000);
  s=f.api.getSnapshot();
  assert.equal(s.runners.emily.recordedAt,original);assert.equal(s.runner.routeKm,null);assert.equal(s.runner.fresh,false);
  assert.equal(s.runner.speedKmh,null);assert.equal(s.runner.summarySelectionReason,'last-known-report');
});

test('an older provider response cannot replace a newer GPS fix or steer the selected summary backwards',async()=>{
  const f=await load({registered:true,feeds:{'247':pacedReport('247',-.96,.016),'133':report('133',-.94,30)}});
  const before=f.api.getSnapshot().runners.emily;
  f.feeds['247']=report('247',-.98,120);f.api.refresh();await nextTick();await nextTick();
  const s=f.api.getSnapshot();
  assert.equal(s.runners.emily.lng,before.lng);assert.equal(s.runners.emily.recordedAt,before.recordedAt);
  assert.equal(s.runners.emily.paceMinPerKm,before.paceMinPerKm);assert.equal(s.runner.summaryRunnerId,'emily');
});

test('missing path history for an unchanged GPS fix retains its previously verified timed samples',async()=>{
  const f=await load({registered:true,feeds:{'247':pacedReport('247',-.96,.016)}});
  const before=f.api.getSnapshot().runners.emily;
  f.feeds['247']=report('247',-.96);f.api.refresh();await nextTick();await nextTick();
  let s=f.api.getSnapshot();
  assert.equal(s.runner.paceMinPerKm,before.paceMinPerKm);assert.equal(s.runner.recordedAt,before.recordedAt);
  f.feeds['247']=report('247',-.95);f.api.refresh();await nextTick();await nextTick();
  s=f.api.getSnapshot();
  assert.equal(s.runners.emily.lng,-.95);assert.equal(s.runner.paceMinPerKm,null,'corrected coordinates do not reuse old history blindly');
});

test('a mismatched or ambiguous bib cannot be assigned to the wrong avatar',async()=>{
  const f=await load({registered:true,feeds:{'247':report('133',-.94),'133':report('133',-.93)}});
  assert.equal(f.api.getSnapshot().runners.emily,null);assert.equal(f.api.getSnapshot().runnerTracking.emily.status,'not-found');
  f.feeds['247']={status:'live',participants:[...report('247',-.96).participants,...report('247',-.97).participants]};
  f.api.refresh();await nextTick();await nextTick();
  assert.equal(f.api.getSnapshot().runners.emily,null);assert.equal(f.api.getSnapshot().runnerTracking.emily.status,'ambiguous');
  assert.equal(f.api.getSnapshot().runners.jeff.bib,'133');
});

test('HTTP 200 unreadable or malformed crew replies preserve the verified Maps link and last report',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  const f=await load({room:{googleMapsUrl,sharing:true,position:{lat:52,lng:-.94,updatedAt:new Date(NOW-20000).toISOString()}}});
  for(const reply of [new Response('<html>Temporary page</html>',{headers:{'Content-Type':'text/html'}}),Response.json({}),Response.json({public:true,status:'active',room:null})]){
    f.setCrewReply(reply);await f.api.refresh();await nextTick();
    const snapshot=f.api.getSnapshot();
    assert.equal(snapshot.googleMapsUrl,googleMapsUrl);assert.equal(snapshot.googleMapsSource,'saved');
    assert.equal(snapshot.room.error,'unavailable');assert.equal(snapshot.room.status,'active');
    assert.equal(snapshot.crew.lng,-.94);assert.equal(snapshot.crew.fresh,false);
    assert.match(f.panel.innerHTML,/server replied, but its update could not be read/);
    assert.match(f.panel.innerHTML,/Crew request · Error · HTTP 200/);
    assert.doesNotMatch(f.panel.innerHTML,/Saved Google Maps link|maps.app.goo.gl/);
    assert.doesNotMatch(f.panel.innerHTML,new RegExp(publishToken+'|'+viewToken));
  }
});

test('saved data survives reload while Retry stays on-site and never requests GPS',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew',storage=new Map();
  await load({storage,room:{googleMapsUrl,sharing:true,position:{lat:52,lng:-.94,updatedAt:new Date(NOW-20000).toISOString()}}});
  const f=await load({storage,registered:true,now:NOW+60000,room:{googleMapsUrl},crewReply:new TypeError('Network failed'),feeds:{'247':report('247',-.96),'133':report('133',-.94)}});
  const saved=f.api.getSnapshot();
  assert.equal(saved.googleMapsUrl,googleMapsUrl);assert.equal(saved.googleMapsSource,'saved');
  assert.equal(saved.crew,null,'the saved link never restores a cached or fabricated site GPS pin');
  assert.equal(saved.room.loaded,false);assert.equal(f.gpsStarts(),0);
  assert.doesNotMatch(f.panel.innerHTML,/Google Maps|crew-location/);assert.match(f.panel.innerHTML,/Retry live updates/);
  f.api.showCrewOnMap();assert.deepEqual(f.opened,[]);assert.equal(f.tabs.at(-1),'live');
  const before=f.requests.length;f.setCrewReply(null);await f.click('retry');
  const requests=f.requests.slice(before);
  assert(requests.some(r=>r.path==='/api/crew?public=1'));
  assert(requests.some(r=>r.path==='/api/tracker?bib=247'));assert(requests.some(r=>r.path==='/api/tracker?bib=133'));
  assert.equal(f.api.getSnapshot().googleMapsSource,'current');assert.equal(f.api.getSnapshot().room.error,null);
  assert.equal(f.gpsStarts(),0);assert.doesNotMatch(f.panel.innerHTML,/could not be loaded|Connection details/);
});

test('a first-time viewer can retry an unavailable feed without any external location link',async()=>{
  const f=await load({crewReply:new TypeError('Network failed')});
  assert.equal(f.api.getSnapshot().googleMapsUrl,null);assert.equal(f.api.getSnapshot().crew,null);
  assert.doesNotMatch(f.panel.innerHTML,/href=|Google Maps|crew-location/);
  assert.match(f.panel.innerHTML,/data-live-action="retry"/);assert.equal(f.gpsStarts(),0);
});

test('authoritative Maps removal, waiting, ended and confirmed revocation clear the saved fallback',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  for(const action of ['remove','waiting','ended','revoke']){
    const storage=new Map(),f=await load({storage,owner:action==='revoke',room:{googleMapsUrl}});
    assert(storage.has('meriden-public-maps-link-v1'));
    if(action==='remove'){f.setRoom({googleMapsUrl:null});await f.api.refresh();}
    else if(action==='revoke'){await f.click('revoke');await nextTick();}
    else{f.setCrewReply(Response.json({public:true,status:action,room:null}));await f.api.refresh();}
    assert.equal(f.api.getSnapshot().googleMapsUrl,null,action);assert.equal(storage.has('meriden-public-maps-link-v1'),false,action);
    const reopened=await load({storage,crewReply:new TypeError('Network failed')});
    assert.equal(reopened.api.getSnapshot().googleMapsUrl,null,'a later outage cannot resurrect '+action);
  }
});

test('restored Maps links are bounded by one hour, server expiry and their own room scope',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  for(const expiryMs of [86400000,10*60000]){
    const storage=new Map();await load({storage,room:{googleMapsUrl,expiresAt:new Date(NOW+expiryMs).toISOString()}});
    const f=await load({storage,now:NOW+Math.min(60*60000,expiryMs)+1,crewReply:new TypeError('Network failed')});
    assert.equal(f.api.getSnapshot().googleMapsUrl,null);assert.equal(storage.has('meriden-public-maps-link-v1'),false);
  }
  const storage=new Map();await load({legacy:true,storage,room:{googleMapsUrl}});
  const publicViewer=await load({storage,crewReply:new TypeError('Network failed')});
  assert.equal(publicViewer.api.getSnapshot().googleMapsUrl,null,'a public viewer never restores a private room link');
  const otherPrivate=await load({legacy:true,hash:'#crew='+'x'.repeat(43),storage,crewReply:new TypeError('Network failed')});
  assert.equal(otherPrivate.api.getSnapshot().googleMapsUrl,null,'a different private invitation cannot restore the former room link');
});

test('a post-fetch view failure keeps received data and is reported separately from connection failure',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  const f=await load({throwMeetupRender:true,room:{googleMapsUrl,meetup:{id:'hello',label:'Our next hello',lat:52,lng:-.94}}});
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.room.error,null);assert.equal(snapshot.room.loaded,true);
  assert.equal(snapshot.googleMapsUrl,googleMapsUrl);assert.equal(snapshot.googleMapsSource,'current');
  assert.match(f.panel.innerHTML,/update arrived, but this view could not refresh/);assert.match(f.panel.innerHTML,/Crew display/);
  assert.doesNotMatch(f.panel.innerHTML,/latest crew update could not be loaded/);
});

test('a non-JSON tracker response keeps its own recent cached report with the original timestamp',async()=>{
  const f=await load({registered:true,feeds:{'247':report('247',-.96),'133':report('133',-.94)}});
  f.feeds['247']=new Response('<html>Not JSON</html>',{headers:{'Content-Type':'text/html'}});
  await f.api.refresh();
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.runnerTracking.emily.status,'unavailable');assert.equal(snapshot.runners.emily.fresh,true);assert.equal(snapshot.runners.emily.reportCached,true);
  assert.equal(snapshot.runners.emily.lng,-.96);assert.equal(snapshot.runners.jeff.fresh,true);assert.equal(snapshot.runners.jeff.bib,'133');
});

test('an in-flight old public response cannot restore a Maps link after confirmed revocation',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/exampleCrew';
  const room={googleMapsUrl,expiresAt:new Date(NOW+86400000).toISOString(),updatedAt:new Date(NOW).toISOString(),position:null,sharing:false,bib:'123',meetup:null,releases:[]};
  const f=await load({owner:true,room});let finish;
  f.setCrewReply(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.api.refresh();await nextTick();
  await f.click('revoke');await nextTick();
  assert.equal(f.api.getSnapshot().googleMapsUrl,null);
  finish(Response.json({public:true,status:'active',room}));await pending;
  assert.equal(f.api.getSnapshot().googleMapsUrl,null);
  assert.equal(f.storage.has('meriden-public-maps-link-v1'),false);
});


test('a location setup invitation is stripped, kept separate and never grants full controls or starts GPS',async()=>{
  const f=await load({hash:'#locate='+locationToken});
  assert.equal(f.location.hash,'#live');assert.equal(f.api.getSnapshot().room.canShareLocation,true);assert.equal(f.api.getSnapshot().room.owner,false);
  assert.equal(f.storage.has('meriden-public-crew-v1'),false);assert.equal(JSON.parse(f.storage.get('meriden-public-location-v1')).token,locationToken);
  assert.equal(f.gpsRequests.length,0);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  const activation=f.requests.find(r=>r.options?.method==='POST');
  assert.deepEqual(JSON.parse(activation.options.body),{action:'activate-location'});assert.equal(activation.options.headers.Authorization,'Bearer '+locationToken);
  assert.equal((await f.api.releaseCelebration('km-60')).ok,false);
  assert.doesNotMatch(f.panel.innerHTML,new RegExp(locationToken+'|End race sharing'));assert.equal(JSON.stringify(f.api.getSnapshot()).includes(locationToken),false);
  await f.click('invite');assert.equal(f.shared[0][2],'https://crew.example.test/#now');assert.equal(JSON.stringify(f.shared).includes(locationToken),false);
  const again=await load({storage:f.storage});assert.equal(again.api.getSnapshot().room.canShareLocation,true);assert.equal(again.gpsRequests.length,0);
});

test('Connect this phone validates only on submit, never echoes the code and leaves anonymous viewing open',async()=>{
  const f=await load({crewReply:new TypeError('Network failed')});
  assert.match(f.panel.innerHTML,/Connect this phone/);assert.equal(f.requests.some(r=>r.options?.method==='POST'),false);
  f.api.showCrewLocationControls();assert.equal(f.tabs.at(-1),'live');assert.equal(f.gpsRequests.length,0);
  assert.equal(f.setupDisclosure.open,true);assert.equal(f.codeInput.focused,true);assert.equal(f.codeInput.scrolled,true);
  await f.connect('too-short');assert.match(f.panel.innerHTML,/Paste the complete private/);assert.equal(f.requests.some(r=>r.options?.method==='POST'),false);
  f.setCrewReply(null);await f.connect(locationToken);
  assert.equal(f.api.getSnapshot().room.canShareLocation,true);assert.equal(f.api.getSnapshot().room.owner,false);
  assert.equal(f.codeInput.value,'');assert.equal(f.tabs.at(-1),'live');assert.equal(f.gpsRequests.length,0);
  assert.match(f.panel.innerHTML,/Share Huiyan · every 30s/);assert.doesNotMatch(f.panel.innerHTML,new RegExp(locationToken));
});

test('invalid and expired location codes cannot publish or stop the anonymous public feed',async()=>{
  for(const invalid of ['rejected','expired']){
    const f=await load({hash:'#locate='+locationToken,invalidLocationControl:invalid==='rejected',room:invalid==='expired'?{expiresAt:new Date(NOW-1).toISOString()}: {}});
    assert.equal(f.api.getSnapshot().room.canShareLocation,false);assert.equal(f.api.getSnapshot().room.owner,false);
    assert(f.requests.some(r=>r.path==='/api/crew?public=1'&&!r.options.headers.Authorization));
    await f.click('update-location');await f.click('start');assert.equal(f.gpsRequests.length,0);
    assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false);
  }
});

test('a current one-shot GPS update works for both grant types in either display role and reaches another viewer',async()=>{
  for(const mode of ['runner','supporter']){
    for(const limited of [false,true]){
      const old={lat:52,lng:-.98,accuracy:50,recordedAt:new Date(NOW-3600000).toISOString()};
      const f=await load({owner:!limited,locationOwner:limited,mode,room:{position:old,sharing:true}});
      const expectedToken=limited?locationToken:publishToken;
      assert.equal(f.gpsRequests.length,0);assert.match(f.panel.innerHTML,/Share Huiyan · every 30s/);
      await f.click('update-location');
      assert.equal(f.gpsRequests.length,1);assert.equal(f.gpsRequests[0].kind,'once');
      assert.deepEqual(JSON.parse(JSON.stringify(f.gpsRequests[0].options)),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
      assert.equal(f.api.getSnapshot().crew.lng,old.lng);assert.equal(f.api.getSnapshot().crew.fresh,false);
      assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false,'getting GPS alone does not write a position');
      const fix={coords:{latitude:52.01,longitude:-.92,accuracy:7},timestamp:NOW-5000};
      await f.emitOneShotPosition(fix);
      const patches=f.requests.filter(r=>r.options?.method==='PATCH');assert.equal(patches.length,1);assert.equal(patches[0].options.headers.Authorization,'Bearer '+expectedToken);
      assert.deepEqual(JSON.parse(patches[0].options.body),{personId:'huiyan',sharing:true,position:{lat:52.01,lng:-.92,accuracy:7,recordedAt:new Date(NOW-5000).toISOString()}});
      const snapshot=f.api.getSnapshot();assert.equal(snapshot.sharing.gpsStatus,'updated');assert.equal(snapshot.sharing.requested,false);assert.equal(snapshot.crew.fresh,true);
      assert.equal(snapshot.crew.recordedAt,new Date(NOW-5000).toISOString());assert.match(f.panel.innerHTML,/one-time update/);
      assert.equal(f.gpsStarts(),0);assert.equal(f.notices.at(-1),'Huiyan’s GPS position is now shared on this map.');
      const viewer=await load({room:f.getRoom()});assert.equal(viewer.api.getSnapshot().crew.lng,-.92);assert.equal(viewer.api.getSnapshot().crew.fresh,true);assert.equal(viewer.gpsRequests.length,0);assert.equal(viewer.api.getSnapshot().room.canShareLocation,false);
      f.advanceTime(120000);await f.click('retry');assert.match(f.panel.innerHTML,/Position shared 2 min ago/);assert.equal(f.gpsRequests.length,1,'Retry never obtains GPS or makes its report newer');
    }
  }
});

test('one-shot success waits for matching server confirmation, not merely the GPS callback',async()=>{
  let acknowledge;
  const f=await load({locationOwner:true,patchReply:(patch,room)=>new Promise(resolve=>{acknowledge=()=>resolve(Response.json({...room,...patch}));})});
  await f.click('update-location');
  const pending=f.emitOneShotPosition();await nextTick();
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'publishing');assert.equal(f.api.getSnapshot().crew,null);assert.equal(f.notices.length,0);
  acknowledge();await pending;
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'updated');assert.equal(f.api.getSnapshot().crew.lng,-.92);
});

test('permission denial, timeout and invalid or old fixes never replace the last shared position',async()=>{
  const old={lat:52,lng:-.98,accuracy:50,recordedAt:new Date(NOW-3600000).toISOString()};
  for(const error of [{code:1,status:'denied'},{code:2,status:'unavailable'},{code:3,status:'timeout'}]){
    const f=await load({locationOwner:true,room:{position:old,sharing:true}});await f.click('update-location');await f.emitOneShotError(error);
    assert.equal(f.api.getSnapshot().sharing.gpsStatus,error.status);assert.equal(f.api.getSnapshot().sharing.updating,false);assert.equal(f.api.getSnapshot().crew.lng,old.lng);
    assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false);assert.equal(f.notices.length,0);
  }
  for(const position of [{coords:{latitude:52,longitude:-.92,accuracy:7},timestamp:NOW-3600000},{coords:{latitude:52,longitude:-.92,accuracy:7},timestamp:NaN},{coords:{latitude:52,longitude:-.92,accuracy:Infinity},timestamp:NOW}]){
    const f=await load({owner:true,room:{position:old,sharing:true}});await f.click('update-location');await f.emitOneShotPosition(position);
    assert.equal(f.api.getSnapshot().sharing.gpsStatus,'invalid-fix');assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false);assert.equal(f.api.getSnapshot().crew.lng,old.lng);
  }
});

test('failed or nonmatching publication never claims the location has been updated',async()=>{
  const old={lat:52,lng:-.98,accuracy:50,recordedAt:new Date(NOW-3600000).toISOString()};
  const validRoom={expiresAt:new Date(NOW+86400000).toISOString(),updatedAt:new Date(NOW).toISOString(),position:old,sharing:true,googleMapsUrl:null};
  for(const patchReply of [new TypeError('Network failed'),new Response('<html>Unavailable</html>',{headers:{'Content-Type':'text/html'}}),Response.json(validRoom)]){
    const f=await load({locationOwner:true,room:{position:old,sharing:true},patchReply});await f.click('update-location');await f.emitOneShotPosition();
    assert.equal(f.api.getSnapshot().sharing.gpsStatus,'publishing-error');assert.equal(f.api.getSnapshot().crew.lng,old.lng);assert.equal(f.api.getSnapshot().crew.fresh,false);
    assert.equal(f.notices.length,0);assert.doesNotMatch(f.panel.innerHTML,/Position shared just now/);
  }
});

test('hiding the page cancels an unfinished one-shot and never restarts GPS on return',async()=>{
  for(const lifecycle of ['hidden','pagehide']){
    const f=await load({locationOwner:true});await f.click('update-location');
    if(lifecycle==='hidden')await f.setVisibility(true);else await f.emitWindow('pagehide');
    await f.emitOneShotPosition();assert.equal(f.api.getSnapshot().sharing.gpsStatus,lifecycle==='hidden'?'paused':'stopped');assert.equal(f.requests.some(r=>r.options?.method==='PATCH'),false);
    await f.setVisibility(false);assert.equal(f.gpsRequests.length,1);assert.equal(f.api.getSnapshot().crew,null);
    await f.click('update-location');await f.emitOneShotPosition();assert.equal(f.gpsRequests.length,2);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'updated');
  }
});

test('a completed one-time report stays one-time while an automatic session resumes without changing stale report time',async()=>{
  const f=await load({locationOwner:true});await f.click('update-location');await f.emitOneShotPosition();
  await f.setVisibility(true);await f.setVisibility(false);
  assert.equal(f.api.getSnapshot().crew.lng,-.92);assert.equal(f.api.getSnapshot().sharing.requested,false);assert.equal(f.gpsRequests.length,1);
  f.advanceTime(1000);
  await f.click('start');await f.emitOneShotPosition({coords:{latitude:52,longitude:-.94,accuracy:8},timestamp:NOW+1000});assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  await f.setVisibility(true);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'paused');assert.equal(f.api.getSnapshot().crew.lng,-.94);
  const patchCount=f.requests.filter(r=>r.options?.method==='PATCH').length;
  await f.emitOldOneShot(1);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,patchCount);assert.equal(f.api.getSnapshot().crew.lng,-.94);
  await f.setVisibility(false);assert.equal(f.gpsRequests.length,3);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'waiting');
  const viewer=await load({room:f.getRoom(),now:NOW+6*60000});
  assert.equal(viewer.api.getSnapshot().crew.lng,-.94);assert.equal(viewer.api.getSnapshot().crew.fresh,false);assert.equal(viewer.api.getSnapshot().crew.recordedAt,new Date(NOW+1000).toISOString());
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));assert.equal(patches.some(p=>p.sharing===false),false);
});

test('location-only Stop removes the position without exposing broader controls',async()=>{
  const f=await load({locationOwner:true});await f.click('update-location');await f.emitOneShotPosition();await f.click('stop');
  assert.equal(f.api.getSnapshot().crew,null);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'stopped');assert.equal(f.api.getSnapshot().room.owner,false);
  assert.doesNotMatch(f.panel.innerHTML,/End race sharing/);assert.equal((await f.api.releaseCelebration('gold')).ok,false);
  const patches=f.requests.filter(r=>r.options?.method==='PATCH');assert.deepEqual(JSON.parse(patches.at(-1).options.body),{personId:'huiyan',sharing:false,position:null});
  assert(patches.every(r=>Object.keys(JSON.parse(r.options.body)).every(key=>['personId','position','sharing'].includes(key))));
});

test('automatic sharing takes a fresh sample every 30 seconds and preserves the phone timestamp while stationary',async()=>{
  const f=await load({locationOwner:true});
  await f.click('start');await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.intervalSeconds,30);
  await f.advanceTimers(29000);assert.equal(f.gpsRequests.length,1);
  await f.advanceTimers(1000);assert.equal(f.gpsRequests.length,2);
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString(),'starting a GPS request does not renew the previous report');
  await f.emitOneShotPosition({coords:{latitude:52,longitude:-.92,accuracy:7},timestamp:NOW+29000});
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW+29000).toISOString(),'report time comes from the phone, not the tick');
  await f.advanceTimers(30000);assert.equal(f.gpsRequests.length,3);
  await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.length,3);assert.equal(patches[0].sharing,true);
  assert(patches.slice(1).every(p=>!Object.hasOwn(p,'sharing')));
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW+60000).toISOString());
  assert.equal(f.api.getSnapshot().sharing.automatic,true);
});

test('Update now preserves the automatic cadence and never overlaps a pending acquisition',async()=>{
  const f=await load({owner:true});await f.click('start');await f.emitOneShotPosition();
  await f.advanceTimers(10000);await f.click('update-location');
  assert.equal(f.gpsRequests.length,2);assert.equal(f.api.getSnapshot().sharing.automatic,true);
  await f.click('update-location');await f.click('start');assert.equal(f.gpsRequests.length,2);
  await f.emitOneShotPosition();
  await f.advanceTimers(20000);assert.equal(f.gpsRequests.length,3,'manual Update now leaves the original 30-second schedule intact');
  await f.advanceTimers(30000);assert.equal(f.gpsRequests.length,3,'an unfinished phone request is not duplicated by the timer');
  await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.automatic,true);
  assert.match(f.api.getLocationControls({compact:true}),/>Update Huiyan now</);
});

test('a pending server publication is not overlapped and Stop or hiding cannot turn its late acknowledgement into success',async()=>{
  for(const action of ['stop','hide']){
    const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
    let acknowledge;
    f.setPatchReply((patch,room)=>{
      if(patch.position)return new Promise(resolve=>{acknowledge=()=>{f.setRoom(patch);resolve(Response.json(f.getRoom()));};});
      f.setRoom(patch);return Response.json(f.getRoom());
    });
    await f.advanceTimers(30000);
    const pending=f.emitOneShotPosition();await nextTick();
    const noticesBefore=f.notices.length;
    await f.advanceTimers(30000);await f.click('update-location');
    assert.equal(f.gpsRequests.length,2,'pending upload blocks timer and manual duplicate GPS');
    let stopped;
    if(action==='stop'){stopped=f.click('stop');await nextTick();}else await f.setVisibility(true);
    assert.equal(f.api.getSnapshot().sharing.automatic,action==='hide');
    acknowledge();await pending;if(stopped)await stopped;
    assert.equal(f.api.getSnapshot().sharing.gpsStatus,action==='stop'?'stopped':'paused');
    assert.equal(f.notices.slice(noticesBefore).some(n=>/now shared|Automatic updates are on/.test(n)),false);
    if(action==='stop')assert.equal(f.api.getSnapshot().crew,null);
    else assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString(),'a hidden page does not apply an in-flight acknowledgement');
    await f.advanceTimers(90000);assert.equal(f.gpsRequests.length,2);
    if(action==='hide'){await f.setVisibility(false);assert.equal(f.gpsRequests.length,3);assert.equal(f.api.getSnapshot().sharing.gpsStatus,'waiting');}
  }
});

test('temporary automatic GPS failure retries next tick, but permission denial stops the timer',async()=>{
  const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
  await f.advanceTimers(30000);await f.emitOneShotError({code:3});
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'timeout');assert.equal(f.api.getSnapshot().sharing.automatic,true);
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString());
  await f.advanceTimers(30000);assert.equal(f.gpsRequests.length,3);await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'sharing');
  await f.advanceTimers(30000);await f.emitOneShotError({code:1});
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'denied');assert.equal(f.api.getSnapshot().sharing.automatic,false);
  await f.advanceTimers(90000);assert.equal(f.gpsRequests.length,4);
});

test('a repeated fix cannot refresh the report age and expired publishing access stops automatic GPS',async()=>{
  const f=await load({locationOwner:true});await f.click('start');await f.emitOneShotPosition();
  await f.advanceTimers(30000);await f.emitOneShotPosition({coords:{latitude:52,longitude:-.92,accuracy:7},timestamp:NOW});
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'invalid-fix');
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString());
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,1);
  await f.advanceTimers(30000);f.setPatchReply(Response.json({error:'Access expired',code:'location_access_required'},{status:403}));await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.automatic,false);assert.equal(f.api.getSnapshot().room.canShareLocation,false);
  assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW).toISOString());
  await f.advanceTimers(90000);assert.equal(f.gpsRequests.length,3);
  assert.match(f.api.getLocationControls({compact:true}),/Connect Huiyan’s phone/);
});

test('compact avatar controls are passive, role independent and contain no form IDs or credentials',async()=>{
  for(const mode of ['runner','supporter']){
    for(const locationOwner of [false,true]){
      const f=await load({mode,locationOwner});
      const before=f.requests.length;
      const markup=f.api.getLocationControls({compact:true});
      assert.doesNotMatch(markup,/<form|\sid=|location-setup|location-code/);
      assert.doesNotMatch(markup,new RegExp(locationToken+'|'+publishToken+'|'+viewToken));
      assert.equal(f.requests.length,before);assert.equal(f.gpsRequests.length,0);
      if(locationOwner){assert.match(markup,/Share Huiyan · every 30s/);assert.match(markup,/Update Huiyan once/);assert.match(markup,/screen awake/);}
      else{assert.match(markup,/Connect Huiyan’s phone/);assert.doesNotMatch(markup,/data-live-action="start"|data-live-action="update-location"/);}
      await f.advanceTimers(60000);assert.equal(f.gpsRequests.length,0,'viewing never starts automatic location');
    }
  }
});

test('a connected supporter chooses a canonical meeting point without GPS or arbitrary coordinates',async()=>{
  const chosen={id:'point-3',label:'Point 3 · Daventry',routeKm:43.9,lat:52.25,lng:-1.16,mapUrl:'https://www.google.com/maps/search/?api=1&query=52.25,-1.16',note:'Agreed charge stop'};
  const f=await load({locationOwner:true,mode:'supporter',room:{meetup:{id:'point-2'},completedPointIds:['point-1'],checkpointStatuses:{'point-1':{status:'met',at:new Date(NOW).toISOString()}}},patchReply:(patch,room)=>{
    assert.deepEqual(patch,{checkpoint:{action:'select',pointId:'point-3'}});
    Object.assign(room,{meetup:chosen,lastCheckpointAction:null});
    return Response.json(room);
  }});
  assert.equal((await f.api.selectCheckpoint('point-3')).ok,true);
  assert.equal(f.api.getSnapshot().meetup.id,'point-3');
  assert.equal(f.api.getSnapshot().checkpointStatuses['point-1'].status,'met');
  assert.equal(f.hydrate.at(-1).value.id,'point-3');
  assert.equal(f.gpsRequests.length,0);
  const request=f.requests.find(r=>r.options?.method==='PATCH');
  assert.equal(request.options.headers.Authorization,'Bearer '+locationToken);
  assert.match(f.notices.at(-1),/agreed next meet-up for everyone/);
  const viewer=await load({mode:'supporter'});
  assert.equal((await viewer.api.selectCheckpoint('point-3')).ok,false);
  assert.equal(viewer.requests.filter(r=>r.options?.method==='PATCH').length,0);
});

test('EV add and remove wait for shared confirmation and hydrate every view without changing destination or starting GPS',async()=>{
  const id='ev-meetup-osprey-daventry',initial={meetup:{id:'point-2'},completedPointIds:['point-1'],checkpointStatuses:{},addedEvPointIds:[]};
  const f=await load({locationOwner:true,mode:'supporter',room:initial,patchReply:(patch,room)=>{
    assert.equal(patch.checkpoint.pointId,id);
    assert.deepEqual(Object.keys(patch),['checkpoint']);
    assert(['add-ev','remove-ev'].includes(patch.checkpoint.action));
    room.addedEvPointIds=patch.checkpoint.action==='add-ev'?[id]:[];
    return Response.json(room);
  }});
  const tabs=f.tabs.length;
  assert.equal((await f.api.addEvMeetup(id)).ok,true);
  assert.deepEqual([...f.api.getSnapshot().addedEvPointIds],[id]);
  assert.deepEqual([...f.checkpointHydrate.at(-1).addedEvPointIds],[id]);
  assert.equal(f.api.getSnapshot().meetup.id,'point-2');
  assert.match(f.notices.at(-1),/added to your meeting options/);
  assert.equal((await f.api.removeEvMeetup(id)).ok,true);
  assert.deepEqual([...f.api.getSnapshot().addedEvPointIds],[]);
  assert.deepEqual([...f.checkpointHydrate.at(-1).addedEvPointIds],[]);
  assert.equal(f.api.getSnapshot().meetup.id,'point-2');
  assert.equal(f.gpsRequests.length,0);
  assert.equal(f.tabs.length,tabs,'editing possible stops stays on the current view');
  for(const request of f.requests.filter(r=>r.options?.method==='PATCH'))assert.equal(request.options.headers.Authorization,'Bearer '+locationToken);
  const viewer=await load({room:{...initial,addedEvPointIds:[id]}});
  assert.deepEqual([...viewer.api.getSnapshot().addedEvPointIds],[id]);
  assert.deepEqual([...viewer.checkpointHydrate.at(-1).addedEvPointIds],[id]);
  assert.equal((await viewer.api.addEvMeetup(id)).ok,false);
  assert.equal((await viewer.api.removeEvMeetup(id)).ok,false);
  assert.equal(viewer.requests.filter(r=>r.options?.method==='PATCH').length,0);
});

test('failed or unconfirmed EV writes retain the prior option list and explain an agreed-stop removal blocker',async()=>{
  const id='ev-meetup-osprey-daventry';
  const f=await load({locationOwner:true,room:{meetup:{id},completedPointIds:[],checkpointStatuses:{},addedEvPointIds:[id]},patchReply:Response.json({code:'ev_current_meetup',error:'Choose another meeting point first'},{status:409})});
  const removed=await f.api.removeEvMeetup(id);
  assert.equal(removed.ok,false);
  assert.equal(removed.reason,'ev_current_meetup');
  assert.match(removed.message,/Choose another meeting point before removing/);
  assert.equal(f.api.getSnapshot().meetup.id,id);
  assert.deepEqual([...f.api.getSnapshot().addedEvPointIds],[id]);
  f.setRoom({meetup:{id:'point-2'},addedEvPointIds:[]});await f.api.refresh();
  f.setPatchReply((patch,room)=>Response.json(room));
  assert.equal((await f.api.addEvMeetup(id)).ok,false,'HTTP success without confirmed inclusion is not success');
  assert.deepEqual([...f.api.getSnapshot().addedEvPointIds],[]);
  assert.equal(f.api.getSnapshot().meetup.id,'point-2');
  assert.equal(f.gpsRequests.length,0);
});

test('supporter snapshots keep independent coordinates, timestamps and freshness; legacy crew belongs only to Huiyan',async()=>{
  const huiyan={lat:52,lng:-.95,accuracy:7,recordedAt:new Date(NOW-5000).toISOString()},graham={lat:52.02,lng:-.91,accuracy:11,recordedAt:new Date(NOW-600000).toISOString()};
  const f=await load({room:{position:huiyan,sharing:true,supporters:{huiyan:{position:huiyan,sharing:true},graham:{position:graham,sharing:true}}}});
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.supporters.huiyan.fresh,true);assert.equal(snapshot.supporters.graham.fresh,false);
  assert.equal(snapshot.supporters.graham.lng,graham.lng);assert.equal(snapshot.supporters.graham.recordedAt,graham.recordedAt);
  assert.equal(snapshot.crew.lng,huiyan.lng);assert.equal(snapshot.sharing.personId,'huiyan');
  const legacy=await load({room:{position:huiyan,sharing:true}});
  assert.equal(legacy.api.getSnapshot().supporters.huiyan.lng,huiyan.lng);assert.equal(legacy.api.getSnapshot().supporters.graham,null);
  legacy.setRoom({supporters:{huiyan:{position:null,sharing:false},graham:{position:graham,sharing:true}}});await legacy.api.refresh();
  assert.equal(legacy.api.getSnapshot().crew,null,'an explicit empty Huiyan entry overrides a former legacy pin');
  assert.equal(legacy.api.getSnapshot().supporters.graham.lng,graham.lng);
  for(const supporters of [{},{huiyan:null},null]){
    legacy.setRoom({supporters});await legacy.api.refresh();
    assert.equal(legacy.api.getSnapshot().supporters.huiyan,null,'an explicit partial or malformed supporter map cannot resurrect a legacy Huiyan position');
    assert.equal(legacy.api.getSnapshot().crew,null);assert.equal(legacy.api.getSnapshot().supporters.graham,null);
  }
  assert.equal(f.gpsRequests.length,0);assert.equal(legacy.gpsRequests.length,0);
});

test('Graham can publish every 30 seconds and stop independently while the browser remembers its identity without GPS on reload',async()=>{
  const huiyan={lat:52,lng:-.97,accuracy:7,recordedAt:new Date(NOW).toISOString()};
  const f=await load({locationOwner:true,room:{position:huiyan,sharing:true,supporters:{huiyan:{position:huiyan,sharing:true},graham:{position:null,sharing:false}}}});
  await f.click('select-person','graham');assert.equal(f.gpsRequests.length,0);
  assert.equal(f.api.getSnapshot().sharing.personId,'graham');
  await f.click('start','graham');await f.emitOneShotPosition({coords:{latitude:52.02,longitude:-.91,accuracy:8},timestamp:NOW-5000});
  assert.equal(f.api.getSnapshot().supporters.graham.recordedAt,new Date(NOW-5000).toISOString(),'Graham compares timestamps only against Graham');
  assert.equal(f.api.getSnapshot().crew.recordedAt,huiyan.recordedAt);
  await f.advanceTimers(30000);await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.length,2);assert(patches.every(p=>p.personId==='graham'));assert.equal(Object.hasOwn(patches[1],'sharing'),false);
  await f.click('stop','graham');
  assert.equal(f.api.getSnapshot().supporters.graham,null);assert.equal(f.api.getSnapshot().supporters.huiyan.lng,huiyan.lng);assert.equal(f.api.getSnapshot().supporters.huiyan.sharing,true);
  const again=await load({storage:f.storage,room:f.getRoom()});
  assert.equal(again.api.getSnapshot().sharing.personId,'graham');assert.equal(again.api.getSnapshot().room.canShareLocation,true);assert.equal(again.gpsRequests.length,0);
  assert.match(again.panel.innerHTML,/Share Graham · every 30s/);assert.match(again.panel.innerHTML,/data-supporter-summary="huiyan"/);assert.match(again.panel.innerHTML,/data-supporter-summary="graham"/);
});

test('viewing another avatar never changes the transmitting identity and switching requires a new explicit Start',async()=>{
  const f=await load({locationOwner:true});await f.click('start','huiyan');await f.emitOneShotPosition();
  const patchCount=f.requests.filter(r=>r.options?.method==='PATCH').length;
  for(const [personId,name] of [['graham','Graham'],['jeff','Jeff'],['jeff','Jeff']]){
    const card=f.api.getLocationControls({compact:true,personId});
    assert.match(card,new RegExp(name+' has not shared a position yet'));assert.match(card,new RegExp('Use this phone for '+name));
    assert.doesNotMatch(card,/data-live-action="start"|data-live-action="update-location"|data-live-action="stop"/);
    assert.equal(f.api.getSnapshot().sharing.personId,'huiyan','reopening a passive avatar cannot reassign this phone');
    assert.equal(f.api.getSnapshot().sharing.automatic,true);
  }
  assert.equal(f.api.getSnapshot().sharing.personId,'huiyan');assert.equal(f.api.getSnapshot().sharing.automatic,true);
  await f.click('update-location','graham');assert.equal(f.gpsRequests.length,1,'a mismatched stale control cannot publish under its displayed name');
  await f.click('select-person','graham');
  assert.equal(f.api.getSnapshot().sharing.automatic,false);assert.equal(f.api.getSnapshot().sharing.personId,'graham');
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,patchCount,'switching identity does not stop the other remote session');
  await f.advanceTimers(60000);assert.equal(f.gpsRequests.length,1);
  assert.equal(f.api.getSnapshot().supporters.huiyan.sharing,true);assert.equal(f.api.getSnapshot().supporters.graham,null);
  assert.match(f.api.getLocationControls({compact:true,personId:'graham'}),/Share Graham · every 30s/);
  await f.click('start','graham');await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().supporters.graham.lng,-.92);assert.equal(f.api.getSnapshot().supporters.huiyan.recordedAt,new Date(NOW).toISOString());
});

test('switching identities discards a pending GPS callback and never sends its fix as the newly selected person',async()=>{
  const f=await load({owner:true});await f.click('start','huiyan');
  await f.click('select-person','graham');await f.click('update-location','graham');
  await f.emitOldOneShot(0);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.length,1);assert.equal(patches[0].personId,'graham');
  assert.equal(f.api.getSnapshot().supporters.huiyan,null);assert.equal(f.api.getSnapshot().supporters.graham.lng,-.92);
});

test('an explicitly queued Stop retains its original identity after the phone switches to another person',async()=>{
  const f=await load({locationOwner:true});await f.click('start','huiyan');await f.emitOneShotPosition();
  let acknowledge;
  f.setPatchReply((patch,room)=>{
    if(patch.position)return new Promise(resolve=>{acknowledge=()=>{f.setRoom(patch);resolve(Response.json(f.getRoom()));};});
    f.setRoom(patch);return Response.json(f.getRoom());
  });
  await f.advanceTimers(30000);const pending=f.emitOneShotPosition();await nextTick();
  await f.click('stop','huiyan');await f.click('select-person','graham');
  acknowledge();await pending;await nextTick();await nextTick();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.deepEqual(patches.at(-1),{personId:'huiyan',sharing:false,position:null});
  assert.equal(f.api.getSnapshot().supporters.huiyan,null);assert.equal(f.api.getSnapshot().supporters.graham,null);
  assert.equal(f.api.getSnapshot().sharing.personId,'graham');assert.equal(f.api.getSnapshot().sharing.automatic,false);
  await f.advanceTimers(60000);assert.equal(f.gpsRequests.length,2);
});

test('identity changes invalidate a queued GPS publication before it can reach the server',async()=>{
  const f=await load({locationOwner:true});let acknowledge;
  f.setPatchReply((patch,room)=>new Promise(resolve=>{acknowledge=()=>{f.setRoom(patch);resolve(Response.json(f.getRoom()));};}));
  await f.click('update-location','huiyan');const huiyanPending=f.emitOneShotPosition();await nextTick();
  await f.click('select-person','graham');await f.click('update-location','graham');const grahamPending=f.emitOneShotPosition();await nextTick();
  await f.click('select-person','huiyan');acknowledge();await huiyanPending;await grahamPending;
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.length,1);assert.equal(patches[0].personId,'huiyan');
  assert.equal(f.api.getSnapshot().sharing.personId,'huiyan');assert.equal(f.api.getSnapshot().sharing.automatic,false);assert.equal(f.notices.length,0);
});

test('a reply confirming Huiyan cannot acknowledge a Graham position',async()=>{
  const f=await load({locationOwner:true,patchReply:(patch,room)=>Response.json({...room,position:patch.position,sharing:true,supporters:{huiyan:{position:patch.position,sharing:true},graham:{position:null,sharing:false}}})});
  await f.click('select-person','graham');await f.click('update-location','graham');await f.emitOneShotPosition();
  assert.equal(f.api.getSnapshot().sharing.gpsStatus,'publishing-error');assert.equal(f.api.getSnapshot().supporters.graham,null);assert.equal(f.notices.length,0);
});

test('a GET begun before an acknowledged GPS write cannot roll back either person even at an equal room version',async()=>{
  const f=await load({locationOwner:true});await f.click('start','huiyan');await f.emitOneShotPosition();
  const old=f.getRoom();let reply;
  f.setCrewReply(()=>new Promise(resolve=>{reply=resolve;}));
  const pending=f.api.refresh();await nextTick();
  f.advanceTime(1000);await f.click('update-location','huiyan');await f.emitOneShotPosition({coords:{latitude:52.03,longitude:-.91,accuracy:8},timestamp:NOW+1000});
  assert.equal(f.api.getSnapshot().supporters.huiyan.lng,-.91);
  reply(Response.json({public:true,status:'active',room:old}));await pending;
  assert.equal(f.api.getSnapshot().supporters.huiyan.lng,-.91);assert.equal(f.api.getSnapshot().crew.recordedAt,new Date(NOW+1000).toISOString());
  assert.equal(f.api.getSnapshot().supporters.graham,null);
});

test('Emily-only configuration polls only her tracker and never uses Jeff or a supporter for race progress and pace',async()=>{
  const emily=pacedReport('247',-.96,.016),retiredJeff=pacedReport('133',-.91,.025);
  retiredJeff.participants[0].updatedAt=new Date(NOW-1000).toISOString();
  const jeffPhone={lat:52,lng:-.92,accuracy:8,recordedAt:new Date(NOW).toISOString()};
  const f=await load({registered:true,configuredRunners:[REGISTERED_RUNNERS[0]],room:{bib:'133',supporters:{jeff:{position:jeffPhone,sharing:true}}},feeds:{'247':emily,'133':retiredJeff}});
  let s=f.api.getSnapshot();
  assert.deepEqual(Object.keys(s.runners),['emily']);assert.deepEqual(Object.keys(s.runnerTracking),['emily']);assert.equal(s.bib,'247');
  assert.equal(s.runner.summaryRunnerId,'emily');assert.equal(s.runner.routeKm,s.runners.emily.routeKm);assert.equal(s.runner.paceMinPerKm,s.runners.emily.paceMinPerKm);
  assert.equal(s.supporters.jeff.lng,jeffPhone.lng,'Jeff’s own phone can remain visible without affecting Emily’s distance');
  await f.advanceTimers(30000);await f.api.refresh();
  assert(f.requests.filter(r=>r.path.startsWith('/api/tracker')).every(r=>r.path==='/api/tracker?bib=247'));
  f.feeds['247']={status:'waiting',participants:[]};await f.api.refresh();s=f.api.getSnapshot();
  assert.equal(s.runner,null);assert.equal(s.runners.emily,null);assert.equal(s.supporters.jeff.lng,jeffPhone.lng);
  assert.equal(s.runners.jeff,undefined,'Jeff’s old official feed cannot become an ETA fallback');assert.equal(f.gpsRequests.length,0);
});

test('Jeff has his own passive supporter card and phone session, never an old official tracker position',async()=>{
  const f=await load({locationOwner:true,registered:true,feeds:{'247':report('247',-.96),'133':report('133',-.91)}});
  assert.equal(f.api.getSnapshot().runners.jeff.lng,-.91,'historical runner data exists only in this compatibility fixture');
  assert.equal(f.api.getSnapshot().supporters.jeff,null);assert.equal(f.api.getSnapshot().sharing.personId,'huiyan');
  const card=f.api.getLocationControls({compact:true,personId:'jeff'});
  assert.match(card,/Jeff has not shared a position yet/);assert.match(card,/Use this phone for Jeff/);assert.equal(f.gpsRequests.length,0);
  await f.click('select-person','jeff');assert.equal(f.gpsRequests.length,0);
  assert.match(f.api.getLocationControls({compact:true,personId:'jeff'}),/Share Jeff · every 30s/);
  await f.click('start','jeff');await f.emitOneShotPosition({coords:{latitude:52.01,longitude:-.97,accuracy:9},timestamp:NOW});
  assert.equal(f.api.getSnapshot().supporters.jeff.lng,-.97);assert.equal(f.api.getSnapshot().crew,null);
  await f.advanceTimers(30000);await f.emitOneShotPosition();
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert(patches.every(p=>p.personId==='jeff'));assert.equal(Object.hasOwn(patches[1],'sharing'),false);
  assert.equal(f.api.getSnapshot().supporters.jeff.recordedAt,new Date(NOW+30000).toISOString());
  const again=await load({storage:f.storage,room:f.getRoom(),registered:true,configuredRunners:[REGISTERED_RUNNERS[0]]});
  assert.equal(again.api.getSnapshot().sharing.personId,'jeff');assert.equal(again.api.getSnapshot().room.canShareLocation,true);assert.equal(again.gpsRequests.length,0);
  assert.match(again.panel.innerHTML,/data-person-id="huiyan"/);assert.match(again.panel.innerHTML,/data-person-id="graham"/);assert.match(again.panel.innerHTML,/data-person-id="jeff"/);assert.match(again.panel.innerHTML,/data-person-id="ben"/);
});

test('Ben can select his own phone, share a fresh GPS fix, and leave every other supporter untouched',async()=>{
  const f=await load({locationOwner:true});
  assert.equal(f.api.getSnapshot().supporters.ben,null);
  assert.match(f.api.getLocationControls({compact:true,personId:'ben'}),/Use this phone for Ben/);
  assert.equal(f.gpsRequests.length,0);
  await f.click('select-person','ben');
  assert.equal(f.api.getSnapshot().sharing.personId,'ben');
  assert.match(f.api.getLocationControls({compact:true,personId:'ben'}),/Share Ben · every 30s/);
  await f.click('start','ben');await f.emitOneShotPosition({coords:{latitude:52.11,longitude:-1.18,accuracy:8},timestamp:NOW});
  const snapshot=f.api.getSnapshot();
  assert.equal(snapshot.supporters.ben.lat,52.11);assert.equal(snapshot.supporters.ben.lng,-1.18);
  for(const id of ['huiyan','graham','jeff'])assert.equal(snapshot.supporters[id],null);
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert(patches.length>0&&patches.every(p=>p.personId==='ben'));
  const again=await load({storage:f.storage,room:f.getRoom()});
  assert.equal(again.api.getSnapshot().sharing.personId,'ben');assert.equal(again.gpsRequests.length,0);
  assert.match(again.panel.innerHTML,/data-supporter-summary="ben"/);
});

test('Jeff’s named avatar connection preserves his identity through authorization and starts only his GPS after an explicit Share',async()=>{
  const supporters={
    huiyan:{sharing:true,position:{lat:52.02,lng:-.98,accuracy:7,recordedAt:new Date(NOW-5000).toISOString()}},
    graham:{sharing:true,position:{lat:52.03,lng:-.96,accuracy:8,recordedAt:new Date(NOW-10000).toISOString()}},
    jeff:{sharing:false,position:null}
  };
  const f=await load({mode:'supporter',room:{position:supporters.huiyan.position,sharing:true,supporters}});
  const card=f.api.getLocationControls({compact:true,personId:'jeff'});
  assert.match(card,/Connect Jeff’s phone/);
  assert.match(card,/<button[^>]*data-live-action="location-controls"[^>]*data-person-id="jeff"/);
  assert.equal(f.api.getSnapshot().sharing.personId,'huiyan','viewing Jeff’s card is passive');
  await f.click('location-controls','jeff');
  assert.equal(f.api.getSnapshot().sharing.personId,'jeff');
  assert.equal(f.storage.get('meriden-location-person-v1'),'jeff');
  assert.equal(f.setupDisclosure.open,true);assert.equal(f.codeInput.focused,true);
  assert.match(f.panel.innerHTML,/Connect this phone for Jeff/);
  const selector=f.panel.innerHTML.indexOf('aria-label="Choose whose location this phone shares"');
  assert(selector>=0&&selector<f.panel.innerHTML.indexOf('id="live-location-code"'),'identity can be checked before entering the code');
  assert.equal(f.gpsRequests.length,0);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  await f.connect(locationToken);
  assert.equal(f.api.getSnapshot().room.canShareLocation,true);assert.equal(f.api.getSnapshot().sharing.personId,'jeff');
  assert.match(f.panel.innerHTML,/Phone connected for Jeff\. Location is not sharing yet\./);
  assert.match(f.panel.innerHTML,/Share Jeff · every 30s/);assert.doesNotMatch(f.panel.innerHTML,/Share Huiyan · every 30s/);
  assert.equal(f.gpsRequests.length,0,'authorization alone must not request GPS');
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  await f.click('start','jeff');assert.equal(f.gpsRequests.length,1);
  await f.emitOneShotPosition({coords:{latitude:52.01,longitude:-.94,accuracy:9},timestamp:NOW});
  const snapshot=f.api.getSnapshot(),patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.length,1);assert.equal(patches[0].personId,'jeff');assert.equal(patches[0].sharing,true);
  assert.equal(snapshot.supporters.jeff.lng,-.94);assert.equal(snapshot.supporters.jeff.recordedAt,new Date(NOW).toISOString());
  for(const id of ['huiyan','graham']){
    assert.equal(snapshot.supporters[id].lat,supporters[id].position.lat);assert.equal(snapshot.supporters[id].lng,supporters[id].position.lng);
    assert.equal(snapshot.supporters[id].recordedAt,supporters[id].position.recordedAt);assert.equal(snapshot.supporters[id].sharing,true);
  }
});

test('generic setup lets a new phone choose its supporter before entering a code without starting GPS',async()=>{
  for(const [personId,name] of [['graham','Graham'],['jeff','Jeff']]){
    const f=await load();
    await f.click('location-controls');
    const selector=f.panel.innerHTML.indexOf('aria-label="Choose whose location this phone shares"');
    assert(selector>=0&&selector<f.panel.innerHTML.indexOf('id="live-location-code"'));
    assert.match(f.panel.innerHTML,new RegExp('data-live-action="select-person" data-person-id="'+personId+'"'));
    await f.click('select-person',personId);
    assert.match(f.panel.innerHTML,new RegExp('Connect this phone for '+name));
    await f.connect(locationToken);
    assert.equal(f.api.getSnapshot().sharing.personId,personId);
    assert.equal(f.storage.get('meriden-location-person-v1'),personId);
    assert.match(f.panel.innerHTML,new RegExp('Phone connected for '+name+'\\. Location is not sharing yet\\.'));
    assert.match(f.panel.innerHTML,new RegExp('Share '+name+' · every 30s'));
    await f.advanceTimers(60000);
    assert.equal(f.gpsRequests.length,0);assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  }
});

test('publishing and stopping any of the three supporter identities leaves both other positions and timestamps untouched',async()=>{
  const supporters=Object.fromEntries(['huiyan','graham','jeff'].map((id,index)=>[id,{sharing:true,position:{lat:52+index*.01,lng:-.98+index*.01,accuracy:7+index,recordedAt:new Date(NOW-5000-index*1000).toISOString()}}]));
  for(const id of Object.keys(supporters)){
    const f=await load({locationOwner:true,room:{position:supporters.huiyan.position,sharing:true,supporters:structuredClone(supporters)}});
    await f.click('select-person',id);await f.click('update-location',id);await f.emitOneShotPosition();await f.click('stop',id);
    const s=f.api.getSnapshot();assert.equal(s.supporters[id],null);
    for(const other of Object.keys(supporters).filter(person=>person!==id)){
      assert.equal(s.supporters[other].lng,supporters[other].position.lng);assert.equal(s.supporters[other].recordedAt,supporters[other].position.recordedAt);assert.equal(s.supporters[other].sharing,true);
    }
    assert.equal(s.crew?.lng??null,id==='huiyan'?null:supporters.huiyan.position.lng);
    assert(f.requests.filter(r=>r.options?.method==='PATCH').every(r=>JSON.parse(r.options.body).personId===id));
  }
});

test('shared supporter plans are public, normalized and read-only without a connected phone',async()=>{
  const updatedAt=new Date(NOW-15000).toISOString();
  const plans={huiyan:{mode:'meeting',updatedAt,label:'<img src=x onerror=alert(1)>'},graham:{mode:'walking',updatedAt},jeff:{mode:'walking',updatedAt},emily:{mode:'meeting',updatedAt}};
  for(const mode of ['runner','supporter']){
    const f=await load({mode,room:{supporterPlans:plans}}),snapshot=f.api.getSnapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.supporterPlans)),{
      huiyan:{mode:'meeting',updatedAt},graham:{mode:'walking',updatedAt},jeff:{mode:'walking',updatedAt}
    });
    for(const [personId,name,label] of [['huiyan','Huiyan','Meeting at next stop'],['graham','Graham','Walking with Emily'],['jeff','Jeff','Walking with Emily']]){
      const card=f.api.getLocationControls({compact:true,personId});
      assert.match(card,new RegExp(name+'’s shared plan'));
      assert.match(card,new RegExp(label));
      assert.doesNotMatch(card,/data-live-action="supporter-plan"|data-plan-mode=|onerror=|<img/);
      assert.equal((await f.api.setSupporterPlan(personId,'meeting')).reason,'setup-required','display role never grants permission to edit a plan');
    }
    assert.equal(f.api.getSnapshot().sharing.personId,'huiyan');
    assert.equal(f.gpsRequests.length,0);
    assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
    assert.equal(JSON.stringify(snapshot).includes(locationToken),false);
    assert.equal(JSON.stringify(snapshot).includes(publishToken),false);
  }
});

test('malformed supporter plans and unknown people cannot inject public avatar labels or write requests',async()=>{
  const updatedAt=new Date(NOW).toISOString();
  const f=await load({locationOwner:true,room:{supporterPlans:{huiyan:{mode:'<script>bad</script>',updatedAt},graham:{mode:'walking',updatedAt:'not-a-time'},jeff:{mode:'meeting',updatedAt},intruder:{mode:'walking',updatedAt}}}});
  assert.deepEqual(Object.keys(f.api.getSnapshot().supporterPlans),['jeff']);
  assert.match(f.api.getLocationControls({personId:'huiyan'}),/Plan not set/);
  assert.match(f.api.getLocationControls({personId:'graham'}),/Plan not set/);
  const card=f.api.getLocationControls({compact:true,personId:'<img src=x onerror=alert(1)>'});
  assert.match(card,/Huiyan’s shared plan/);assert.doesNotMatch(card,/<script|<img|onerror=|not-a-time/);
  for(const [personId,mode] of [['emily','walking'],['constructor','walking'],['graham','<img>'],['jeff','running']]){
    assert.equal((await f.api.setSupporterPlan(personId,mode)).reason,'invalid-plan');
  }
  assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,0);
  assert.equal(f.gpsRequests.length,0);
});

test('both connected grant types can change each supporter plan and share the confirmed result without starting GPS',async()=>{
  for(const auth of [{owner:true,token:publishToken},{locationOwner:true,token:locationToken}]){
    const f=await load({...auth,mode:'supporter',patchReply:(patch,room)=>{
      assert.deepEqual(Object.keys(patch),['supporterPlan']);
      const {personId,mode}=patch.supporterPlan;
      assert(['huiyan','graham','jeff'].includes(personId));assert(['walking','meeting'].includes(mode));
      room.supporterPlans={...room.supporterPlans,[personId]:{mode,updatedAt:new Date(NOW).toISOString()}};
      return Response.json({room});
    }});
    for(const personId of ['huiyan','graham','jeff']){
      const card=f.api.getLocationControls({compact:true,personId});
      assert.match(card,new RegExp('data-person-id="'+personId+'" data-plan-mode="walking"'));
      assert.match(card,new RegExp('data-person-id="'+personId+'" data-plan-mode="meeting"'));
      for(const mode of ['walking','meeting']){
        const result=await f.api.setSupporterPlan(personId,mode);
        assert.equal(result.ok,true);assert.equal(result.personId,personId);assert.equal(result.mode,mode);
        assert.equal(f.api.getSnapshot().supporterPlans[personId].mode,mode);
        assert.equal(f.api.getSnapshot().sharing.personId,'huiyan','editing a plan is independent of this phone’s identity');
        const count=f.requests.filter(r=>r.options?.method==='PATCH').length;
        assert.equal((await f.api.setSupporterPlan(personId,mode)).unchanged,true);
        assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,count,'the confirmed current choice does not send a duplicate write');
      }
    }
    const patches=f.requests.filter(r=>r.options?.method==='PATCH');
    assert.equal(patches.length,6);assert(patches.every(r=>r.options.headers.Authorization==='Bearer '+auth.token));
    const other=await load({room:f.getRoom()}),shared=other.api.getSnapshot();
    assert.equal(shared.room.canManageCheckpoints,false);
    assert.deepEqual(JSON.parse(JSON.stringify(shared.supporterPlans)),JSON.parse(JSON.stringify(f.api.getSnapshot().supporterPlans)));
    assert.equal(f.gpsRequests.length,0);assert.equal(other.gpsRequests.length,0);
    assert.equal(f.api.getSnapshot().supporterPlanBusy.length,0);
    assert.equal(Object.keys(f.api.getSnapshot().supporterPlanErrors).length,0);
  }
});

test('saving Graham and Jeff plans preserves Huiyan’s pending GPS request and original 30-second schedule',async()=>{
  const f=await load({locationOwner:true});
  await f.click('start','huiyan');await f.emitOneShotPosition();
  const huiyanStorage=f.storage.get('meriden-location-person-v1');
  let acknowledgePlan;
  f.setPatchReply((patch,room)=>{
    if(patch.supporterPlan)return new Promise(resolve=>{
      acknowledgePlan=()=>{
        const {personId,mode}=patch.supporterPlan;
        f.setRoom({supporterPlans:{...f.getRoom().supporterPlans,[personId]:{mode,updatedAt:new Date(NOW).toISOString()}}});
        resolve(Response.json(f.getRoom()));
      };
    });
    f.setRoom(patch);return Response.json(f.getRoom());
  });
  for(const [index,personId] of ['graham','jeff'].entries()){
    await f.advanceTimers(10000);
    const pending=f.api.setSupporterPlan(personId,index?'meeting':'walking');await nextTick();
    assert.equal(f.api.getSnapshot().supporterPlanBusy.includes(personId),true);
    assert.equal((await f.api.setSupporterPlan(personId,'meeting')).reason,'busy');
    assert.equal(f.api.getSnapshot().sharing.personId,'huiyan');
    assert.equal(f.api.getSnapshot().sharing.automatic,true);
    assert.match(f.api.getLocationControls({compact:true,personId}),/Saving the shared plan/);
    await f.advanceTimers(19000);assert.equal(f.gpsRequests.length,index+1);
    await f.advanceTimers(1000);assert.equal(f.gpsRequests.length,index+2,'a plan save cannot reset or cancel the original GPS interval');
    assert.equal(f.api.getSnapshot().sharing.updating,true);
    acknowledgePlan();assert.equal((await pending).ok,true);
    assert.equal(f.api.getSnapshot().sharing.updating,true,'plan acknowledgement does not cancel the in-flight Huiyan fix');
    await f.emitOneShotPosition();
    const snapshot=f.api.getSnapshot();
    assert.equal(snapshot.supporters.huiyan.recordedAt,new Date(NOW+(index+1)*30000).toISOString());
    assert.equal(snapshot.sharing.personId,'huiyan');assert.equal(snapshot.sharing.automatic,true);
    assert.equal(snapshot.supporters.graham,null);assert.equal(snapshot.supporters.jeff,null,'a walking plan never fabricates a GPS pin');
    assert.equal(f.storage.get('meriden-location-person-v1'),huiyanStorage);
  }
  const patches=f.requests.filter(r=>r.options?.method==='PATCH').map(r=>JSON.parse(r.options.body));
  assert.equal(patches.filter(p=>p.supporterPlan).length,2);
  assert.equal(patches.filter(p=>p.position).length,3);
  assert(patches.filter(p=>p.position).every(p=>p.personId==='huiyan'));
  assert.equal(patches.some(p=>p.sharing===false),false);
  assert.equal(f.gpsClears.length,0);
});

test('failed or unconfirmed supporter-plan acknowledgements keep the old shared plan and expose a retryable error',async()=>{
  const updatedAt=new Date(NOW-60000).toISOString(),plans={graham:{mode:'meeting',updatedAt},jeff:{mode:'walking',updatedAt}};
  const replies=[
    Response.json({error:'Offline',code:'unavailable'},{status:503}),
    Response.json({error:'Expired',code:'location_access_required'},{status:403}),
    (_patch,room)=>Response.json(room),
    (_patch,room)=>Response.json({...room,supporterPlans:{...room.supporterPlans,graham:{mode:'walking',updatedAt:'not-a-time'}}}),
    (_patch,room)=>Response.json({...room,supporterPlans:{...room.supporterPlans,graham:{mode:'walking'}}})
  ];
  for(const patchReply of replies){
    const f=await load({locationOwner:true,room:{supporterPlans:structuredClone(plans)},patchReply});
    assert.equal((await f.api.setSupporterPlan('graham','walking')).ok,false);
    const snapshot=f.api.getSnapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.supporterPlans)),plans);
    assert.equal(snapshot.supporterPlanBusy.length,0);
    assert.match(snapshot.supporterPlanErrors.graham,/not saved|Reconnect/);
    assert.match(f.api.getLocationControls({personId:'graham'}),/class="supporter-plan-current"><strong>Meeting at next stop<\/strong>/);
    assert.equal(snapshot.sharing.personId,'huiyan');assert.equal(f.gpsRequests.length,0);
    assert.equal(f.requests.filter(r=>r.options?.method==='PATCH').length,1);
  }
});
