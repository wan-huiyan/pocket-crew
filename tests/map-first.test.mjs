import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/map-first.js', import.meta.url), 'utf8');
const plannerSource = readFileSync(new URL('../public/upcoming-points.js', import.meta.url), 'utf8');
const arrivalSource = readFileSync(new URL('../public/arrival-eta.js', import.meta.url), 'utf8');
const catchUpSource = readFileSync(new URL('../public/catch-up.js', import.meta.url), 'utf8');
const toiletHoursSource = readFileSync(new URL('../public/toilet-hours.js', import.meta.url), 'utf8');
const guideMarkup=readFileSync(new URL('../guide/index.html',import.meta.url),'utf8');
const posterMarkup=readFileSync(new URL('../guide/poster-home.html',import.meta.url),'utf8');
const nextTick = () => new Promise(resolve => setImmediate(resolve));
function element(rect = null) {
  const events = new Map();
  return { hidden: true, innerHTML: '', textContent: '', style: {}, attributes:{},classList:{values:new Set(),add(name){this.values.add(name);},remove(name){this.values.delete(name);},toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);},contains(name){return this.values.has(name);}},
    addEventListener(type,handler) { events.set(type,[...(events.get(type)||[]),handler]); },
    click() { for(const handler of events.get('click')||[])handler({target:this}); },
    dispatch(type,details={}) { for(const handler of events.get(type)||[])handler({target:this,...details}); },
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];delete this[name];},
    getBoundingClientRect() { return this.hidden || !rect ? { left: 0, top: 0, width: 0, height: 0 } : rect; } };
}

async function load({ mode = 'runner', snapshot = {}, selected = null, failRoute = false, pois = [], points = [], statuses = {}, addedEvPointIds = [], manualProgressKm = null, planningEndKm,
  width = 390, height = 844, followTop = 211, poster = false, hasLocationControls = true, now = null, rival = null, competitors=null, checkpointResult={ok:true}, forecast=null, toiletHours=null, crewTravel=null, milestonePoints=[], milestoneStatus={}, routeCoordinates=[[-1,52],[-0.7,52]], measuredPinHeights = { portrait: 104, meeting: 64 },actualPortraitHeights=false,roundedProjection=false } = {}) {
  const elements = new Map(), listeners = new Map(), documentListeners = new Map(), mapListeners = new Map(), fitted = [], padding = [], viewed = [], crewActions=[], controlReads=[], tabs=[], externalOpens=[],notifications=[];
  let markers = [], coordinateDots = [], circles = [];
  const milestoneOpens=[],competitorOpens=[];
  // Model actual rendered overlays rather than assuming historical CSS offsets.
  const rectangles = {
    '#race-map': { left: 0, top: 0, width, height },
    '.map-distance': { left: 12, top: 65, width: width - 24, height: followTop - 35 },
    '.map-follow-row': { left: 12, top: height - (poster ? 58 : mode === 'runner' ? height > 700 ? 155 : 145 : 149), width: width - 24, height: 44 },
    '.runner-dock': { left: 12, top: height - 96, width: width - 24, height: 76 },
    '.supporter-dock': { left: 12, top: poster ? height + 100 : height - 91, width: width - 24, height: 71 },
    ...(poster ? { '.map-control-stack': { left: width - 54, top: height - 72, width: 44, height: 44 } } : {})
  };
  const q = key => {
    if (!elements.has(key)) {
      const el = element(rectangles[key]);
      if (rectangles[key]) el.hidden = false;
      elements.set(key, el);
    }
    return elements.get(key);
  };
  const layer = () => ({ addTo() { return this; }, on() { return this; }, clearLayers() { markers = markers.filter(marker => marker.layer !== this); coordinateDots = coordinateDots.filter(dot => dot.layer !== this);circles=circles.filter(circle=>circle.layer!==this); } });
  const centre = { x: width / 2, y: height * .6 };
  const project = point => {const x=centre.x+(point[1]+.85)*20000,y=centre.y-(point[0]-52)*20000;return {x:roundedProjection?Math.round(x):x,y:roundedProjection?Math.round(y):y};};
  const map = {
    attributionControl: { setPrefix() {} },
    setView(point) { viewed.push([...point]); return this; }, fitBounds(bounds, options) { fitted.push(bounds.points); padding.push(options); },
    getSize: () => ({ x: width, y: height }), on(types,handler) { for(const type of types.split(' '))mapListeners.set(type,[...(mapListeners.get(type)||[]),handler]); }, invalidateSize() {},
    latLngToContainerPoint: project,
    containerPointToLatLng: point => [52 + (centre.y - point[1]) / 20000, -.85 + (point[0] - centre.x) / 20000]
  };
  let current = snapshot, currentRival=rival;
  const checkpointActions=[];
  const context = {
    console: { warn() {} }, Date:now===null?Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}, URL, Set, Math, Number,
    state: { mode }, currentTab:'now', ORIGINAL_MAP: 'https://www.google.com/maps/d/example',
    document: {
      hidden: false, querySelector: q, querySelectorAll: () => [], addEventListener(type,handler) { documentListeners.set(type,[...(documentListeners.get(type)||[]),handler]); },
      body: { appendChild() {}, classList: { contains: name => poster && name === 'poster-mode' } },
      createElement() { return { style: {}, remove() {}, getBoundingClientRect() {
        if(actualPortraitHeights&&this.innerHTML.includes('gps-portrait'))return {height:this.innerHTML.includes('has-plan')?96:this.innerHTML.includes('compact-poster-pin')?70:78};
        if (this.innerHTML.includes('tiny-gps-portrait')) return {height:48};
        if (this.innerHTML.includes('compact-poster-pin')) return this.className.includes('facility-map-icon') ? { width: 45, height: 44 } : { height: 64 };
        if (this.innerHTML.includes('gps-portrait')) return {height:76};
        if (this.className.includes('overview-meeting')) return {height:40};
        if (this.className.includes('toilet-ahead-icon')) return { width:112,height:52 };
        if (this.className.includes('toilet-context-meeting')) return { height:44 };
        if (this.className.includes('facility-map-icon')) return { width: this.innerHTML.includes('Toilet') ? 130 : this.innerHTML.includes('facility-mini-label') ? 91 : 60, height: 60 };
        return { height: this.className.includes('meeting-map-icon') ? (typeof measuredPinHeights.meeting === 'function' ? measuredPinHeights.meeting(this.innerHTML) : measuredPinHeights.meeting) : measuredPinHeights.portrait };
      } }; }
    },
    navigator: { onLine: true }, matchMedia: () => ({ matches: true }), ResizeObserver: class { observe() {} },
    notify(message) { notifications.push(message); }, switchTab(tab) { context.currentTab=tab;tabs.push(tab); },
    fetch: async path => {
      if (path === 'data/guide-data.json') return Response.json({ start: { lat: 52, lng: -1 } });
      if (path === 'data/route.geojson') return failRoute ? new Response('', { status: 503 }) : Response.json({ type: 'LineString', coordinates: routeCoordinates });
      if (path === 'data/facilities.json') return Response.json({ pois });
      throw new Error('Unexpected request');
    },
    L: { map: () => map, tileLayer: layer, layerGroup: layer, polyline: layer,
      marker(point, options) { const marker = { point: [...point], options, events:{},element:element(),getElement(){return this.element;},addTo(layer) { this.layer = layer; markers.push(this); return this; }, on(type,fn) { this.events[type]=fn;return this; } }; return marker; },
      circleMarker(point, options) { const dot = { point: [...point], options, addTo(layer) { this.layer = layer; coordinateDots.push(this); return this; } }; return dot; },
      circle(point, options) { const circle = {point:[...point],options,addTo(layer){this.layer=layer;circles.push(this);return this;}};return circle;},
      divIcon: value => value,
      latLngBounds: points => ({ points: [...points], isValid: () => points.length > 0, extend(point) { this.points.push(point); return this; } }) },
    window: {
      L: true,
      open(...args) { externalOpens.push(args); },
      addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) || []), handler]); },
      rivalGuide:{getSnapshot:()=>currentRival||{name:'Matt Leese',shortName:'Matt',bib:'210',position:null,status:'waiting'}},
      ...(competitors?{competitorGuide:{getSnapshot:()=>competitors,isShown:bib=>competitors.preferences.followed[bib]===true,
        isFresh:p=>Boolean(p?.updatedAt&&now!==null&&now-Date.parse(p.updatedAt)<=300000&&now>=Date.parse(p.updatedAt)-30000),
        open:bib=>competitorOpens.push(bib)}}:{}),
      raceMilestones:{build:()=>milestonePoints},
      raceMoments:{presentation:point=>milestoneStatus[point.id]||{text:'ETA ~04:15',completed:false},open:id=>milestoneOpens.push(id)},
      meetingForecast:{estimate:options=>typeof forecast==='function'?forecast(options):forecast},
      ...(toiletHours&&toiletHours!==true?{toiletHours}:{}),
      ...(crewTravel?{crewTravel}:{}),
      liveGuide: { getSnapshot: () => current,showCrewOnMap(){crewActions.push('legacy-show-crew');},
        async completeCheckpoint(id){checkpointActions.push(['complete',id]);return checkpointResult;},
        async skipCheckpoint(id){checkpointActions.push(['skip',id]);return checkpointResult;},
        async undoCheckpoint(id){checkpointActions.push(['undo',id]);return checkpointResult;},
        ...(hasLocationControls?{showCrewLocationControls(){crewActions.push('location-controls');},getLocationControls(options){
          controlReads.push(options);
          return current.room?.owner||current.room?.canShareLocation?'<p>Last shared just now.</p><button data-live-action="'+(current.sharing?.automatic?'update-location':'start')+'">'+(current.sharing?.automatic?'Update now':'Share now & every 30s')+'</button>':'<button data-live-action="location-controls">Connect this phone</button>';
        }}:{}) },
      supportGuide: {
        getSelected: () => selected,
        getPoint: id => points.find(p => p.id === id) || (selected?.id === id ? selected : null),
        isEvAdded: id => addedEvPointIds.includes(id)||selected?.id===id,
        getMapPlanData: () => ({points:points.filter(p=>!p.optionalMeetup||addedEvPointIds.includes(p.id)||selected?.id===p.id), selected, statuses, addedEvPointIds, progressKm:manualProgressKm, planningEndKm})
      }
    }
  };
  vm.runInNewContext(plannerSource, context, { filename: 'upcoming-points.js' });
  vm.runInNewContext(arrivalSource, context, { filename: 'arrival-eta.js' });
  vm.runInNewContext(catchUpSource, context, { filename: 'catch-up.js' });
  if(toiletHours===true)vm.runInNewContext(toiletHoursSource,context,{filename:'toilet-hours.js'});
  vm.runInNewContext(source, context, { filename: 'map-first.js' });
  await nextTick(); await nextTick();
  return { q, fitted, padding, viewed, crewActions, checkpointActions, controlReads, tabs, externalOpens, notifications, project, rectangles, document:context.document, markers: () => markers, coordinateDots: () => coordinateDots, circles:()=>circles,milestoneOpens,competitorOpens,api: context.window.raceMap,
    mapEvent(type) { for(const handler of mapListeners.get(type)||[])handler(); },
    clickMapAction(action,pointId) { for(const fn of documentListeners.get('click')||[])fn({target:{closest:selector=>selector==='[data-map-action]'?{dataset:{mapAction:action,pointId}}:null}}); },
    clickPoi(id) { for(const fn of documentListeners.get('click')||[])fn({target:{closest:selector=>selector==='[data-focus-poi]'?{dataset:{focusPoi:id}}:null}}); },
    switchTab:context.switchTab,
    windowEvent(type,detail) { for(const handler of listeners.get(type)||[])handler({detail}); },
    clickPerson(person) { for(const fn of documentListeners.get('click')||[])fn({target:{closest:selector=>selector==='[data-map-person]'?{dataset:{mapPerson:person}}:null}}); },
    clickCatchWindow(minutes) { for(const fn of documentListeners.get('click')||[])fn({target:{closest:selector=>selector==='[data-catch-up-minutes]'?{dataset:{catchUpMinutes:String(minutes)}}:null}}); },
    advanceTime(ms) { now+=ms; },
    changeMode(value){context.state.mode=value;for(const fn of listeners.get('modechange')||[])fn();},
    updateRival(value) { currentRival=value;for(const fn of listeners.get('rivalupdate')||[])fn({detail:value}); },
    update(value = snapshot) { current = value; for (const fn of listeners.get('liveupdate') || []) fn({ detail: current }); }
  };
}

test('every layout keeps supporter avatar actions on site, even with a saved Maps link and stale GPS',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/test-live-location?g_st=ic';
  const crew={lat:52,lng:-.85,fresh:false,sharing:false,updatedAt:new Date(Date.now()-86400000).toISOString()};
  for(const poster of [false,true])for(const mode of ['runner','supporter']){
    const f=await load({mode,poster,width:375,height:poster?430:667,snapshot:{googleMapsUrl,crew}});
    assert(!/map-crew-maps-|crew-maps-link/.test(poster?posterMarkup:guideMarkup),'both layouts remove the obsolete external crew shortcut');
    assert.equal(f.q(`.${mode}-dock`).classList.contains('has-crew-maps'),false,'saved Maps links do not change the navigation layout');
    const marker=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="huiyan"'));
    assert(marker,'the honest last-known site coordinate remains available');
    marker.events.click();assert.deepEqual(f.tabs,['person'],'crew taps open the compact person sheet');
    assert.equal(f.q('#person-heading').textContent,'Huiyan');
    assert.match(f.q('#person-controls').innerHTML,/Connect this phone/);
    assert.deepEqual(f.crewActions,[],'opening details does not start GPS or enter setup');
    assert.deepEqual(f.externalOpens,[]);
    assert.deepEqual(marker.point,[crew.lat,crew.lng]);
  }
});

test('crew pins retain the real GPS report age while offering on-site controls',async()=>{
  const googleMapsUrl='https://maps.app.goo.gl/test-live-location';
  const recordedAt=new Date(Date.now()-3660000).toISOString(),updatedAt=new Date().toISOString();
  for(const poster of [false,true])for(const sharing of [false,true]){
    const crew={lat:52,lng:-.85,fresh:false,sharing,recordedAt,updatedAt};
    const f=await load({poster,width:375,height:poster?430:667,snapshot:{googleMapsUrl,crew,room:{owner:false}}});
    const marker=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="huiyan"'));
    assert.match(marker.options.icon.html,sharing?/Last · 1h ago/:/Paused · 1h ago/);
    assert.match(marker.options.title,/Last site position reported 1h ago/,'fresh room metadata does not replace the actual GPS report time');
    assert.match(marker.options.title,/Open crew location details and sharing controls on this site/);
    assert.doesNotMatch(marker.options.title,/Google Maps/);
    if(sharing)assert.doesNotMatch(marker.options.title,/paused/i,'an old report does not prove active sharing is paused');
    assert.equal(marker.element.attributes['aria-label'],marker.options.title,'keyboard and screen-reader users receive the same source and action explanation');
    assert.deepEqual(marker.point,[crew.lat,crew.lng]);
    marker.events.click();assert.deepEqual(f.tabs,['person']);
    assert.deepEqual(f.crewActions,[]);
    f.update({crew,googleMapsUrl:'javascript:alert(1)'});
    const withoutMaps=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="huiyan"'));
    assert.doesNotMatch(withoutMaps.options.title,/Opens .*Google Maps/,'a missing or unsafe link is not promised as an action');
  }
  const crew={lat:52,lng:-.85,fresh:true,sharing:true,recordedAt:updatedAt,updatedAt};
  const f=await load({snapshot:{crew,googleMapsUrl}});
  const marker=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="huiyan"'));
  assert.match(marker.options.icon.html,/<small class="person-update">just now<\/small>/);
  assert.doesNotMatch(marker.options.title,/paused|Last site position|Opens .*Google Maps/);
});

test('saved, missing and unavailable location states never create an external crew link or fake position',async()=>{
  const valid='https://maps.app.goo.gl/test-live-location';
  const f=await load({poster:true});
  for(const snapshot of [
    {},{googleMapsUrl:valid},{googleMapsUrl:'javascript:alert(1)'},{googleMapsUrl:'https://maps.app.goo.gl.attacker.example/track'},
    {googleMapsUrl:'https://user:pass@maps.app.goo.gl/track'},
    {googleMapsUrl:valid,room:{error:'expired'}},{googleMapsUrl:valid,room:{status:'ended'}},
    {room:{public:true,loaded:false,status:'waiting',error:'unavailable'}},
    {room:{public:false,loaded:false,error:'unavailable'}}
  ]){
    f.update(snapshot);
    const row=f.q('#map-waiting').innerHTML;
    assert.doesNotMatch(row,/\shref=|\starget=|Google Maps|\/crew-location/,'the missing-position strip never navigates out');
    for(const person of ['huiyan','graham']){
      assert.match(row,new RegExp(`<button[^>]*data-person="${person}"[^>]*data-map-person="${person}"`));
    }
    assert.equal(f.markers().some(marker=>marker.options.icon?.html.includes('data-person="huiyan"')),false);
    assert.equal(f.coordinateDots().length,0);
  }
  f.clickPerson('graham');
  assert.deepEqual(f.tabs,['person'],'a missing-position avatar opens the same person sheet as a real-position avatar');
  assert.equal(f.q('#person-heading').textContent,'Graham');
  assert.deepEqual(f.crewActions,[]);
  assert.deepEqual(f.externalOpens,[]);
});

test('crew detail keeps an on-site setup fallback if location controls have not loaded',async()=>{
  const crew={lat:52,lng:-.85,fresh:false,sharing:false,recordedAt:new Date(Date.now()-3600000).toISOString()};
  for(const mode of ['runner','supporter']){
    const f=await load({mode,hasLocationControls:false,snapshot:{crew,googleMapsUrl:'https://maps.app.goo.gl/test-live-location'}});
    f.markers().find(marker=>marker.options.icon?.html.includes('data-person="huiyan"')).events.click();
    f.clickMapAction('crew-location');
    assert.deepEqual(f.tabs,['person','live']);
    assert.match(f.q('#person-controls').innerHTML,/data-live-action="location-controls"/);
    assert.deepEqual(f.crewActions,[],'never invoke the legacy method that could open Maps');
    assert.deepEqual(f.externalOpens,[]);
  }
});

test('an off-route report keeps the nearby route in frame without claiming a current route distance', async () => {
  const f = await load({ snapshot: { tracker: { status: 'live' }, runner: { lat: 52.01, lng: -0.85, fresh: true, updatedAt: new Date().toISOString(), routeKm: null, projectedRouteKm: 10, offRouteM: 1100 } } });
  assert(f.fitted.length > 0);
  const frame = f.fitted.at(-1);
  assert(frame[0][1] > -0.9, 'frame should begin near the reported section, not at Meriden/start');
  assert.equal(f.q('#map-route-distance').innerHTML, '—');
  assert.equal(f.q('#map-route-caption').textContent, 'off planned route');
  f.api.everyone();
  f.api.follow();
  assert(f.fitted.at(-1).some(point => point[0] === 52.01 && point[1] === -.85), 'Follow must retain the actual off-route report, not only its projected route section');
});

test('all five waiting cutouts remain separate and authorized crew can open an on-site update', async () => {
  const googleMapsUrl='https://maps.app.goo.gl/test-live-location';
  for(const room of [{owner:false},{owner:true},{owner:false,canShareLocation:true}]){
    const f=await load({snapshot:{googleMapsUrl,room}});
    const row=f.q('#map-waiting').innerHTML;
    assert.doesNotMatch(row,/<a\b|\shref=|\starget=|Google Maps/);
    for(const person of ['emily','jeff','huiyan','graham','ben'])assert.match(row,new RegExp(`assets/avatars-v5/${person}\\.webp`));
    assert.equal((row.match(/<img\b/g)||[]).length,5,'each person has an individual cutout while positions are unavailable');
    assert.doesNotMatch(row,/Emily &(?:amp;)? Jeff|Huiyan &(?:amp;)? Graham/);
    assert.match(row,room.owner||room.canShareLocation?/Update location/:/Awaiting location/);
    assert.equal(f.markers().filter(marker=>marker.options.title?.includes('Huiyan')).length,0);
    f.clickMapAction('crew-location');
    assert.deepEqual(f.crewActions,['location-controls']);
    const crew={lat:52,lng:-.85,fresh:false,sharing:false,updatedAt:new Date(Date.now()-600000).toISOString()};
    f.update({googleMapsUrl,room,crew});
    assert.doesNotMatch(f.q('#map-waiting').innerHTML,/maps\.app\.goo\.gl|Huiyan/);
    assert(f.coordinateDots().some(dot=>dot.point[0]===crew.lat&&dot.point[1]===crew.lng),'a real last-known position remains on the site map');
  }
});

test('Ben has his own exact map pin, cutout and location controls with no borrowed crew GPS',async()=>{
  const ben={lat:52.123,lng:-.876,fresh:true,sharing:true,recordedAt:new Date().toISOString()};
  const f=await load({snapshot:{supporters:{huiyan:null,graham:null,jeff:null,ben}}});
  const marker=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="ben"'));
  assert(marker);assert.deepEqual(marker.point,[ben.lat,ben.lng]);
  assert.match(marker.options.icon.html,/assets\/avatars-v5\/ben.webp/);
  assert.match(f.q('#map-waiting').innerHTML,/data-person="huiyan"/);
  assert.doesNotMatch(f.q('#map-waiting').innerHTML,/data-person="ben"/);
  marker.events.click();
  assert.equal(f.q('#person-heading').textContent,'Ben');
  assert.equal(f.controlReads.at(-1).personId,'ben');
  f.api.focusPerson('ben');assert.deepEqual(f.viewed.at(-1),[ben.lat,ben.lng]);
});

function markerBox(f, marker) {
  const p = f.project(marker.point), icon = marker.options.icon;
  return { name: marker.options.title, x: p.x - icon.iconAnchor[0], y: p.y - icon.iconAnchor[1], w: icon.iconSize[0], h: icon.iconSize[1] };
}
function assertSeparate(a, b) {
  const overlapWidth = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  assert.equal(overlapWidth * overlapHeight, 0, `${a.name} overlaps ${b.name}: ${JSON.stringify({ a, b })}`);
}
function assertCoordinates(f, expected, message='markers retain the actual reported coordinates') {
  const unique=points=>[...new Set(points.map(p=>JSON.stringify(p)))].sort();
  assert.deepEqual(unique(f.coordinateDots().map(dot=>dot.point)),unique(expected),message);
}
function familySnapshot(emily,huiyan,jeff=null,graham=null) {
  return {runner:emily,runners:{emily},crew:huiyan,supporters:{huiyan,jeff:jeff?{...jeff,sharing:true}:null,graham}};
}
function assertIndividualPeople(f, runner, crew, jeff=null, graham=null, ben=null) {
  const avatars=f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon');
  const expected=[['emily',runner],['jeff',jeff],['huiyan',crew],['graham',graham],['ben',ben]].filter(([,p])=>p);
  assert.equal(avatars.length,expected.length,'each person with a report has one independent pin');
  for(const [person,position] of expected) {
    const marker=avatars.find(item=>item.options.icon.html.includes(`data-person="${person}"`));
    assert(marker,`${person} has a distinct avatar marker`);
    const html=marker.options.icon.html,name=person[0].toUpperCase()+person.slice(1);
    assert.equal((html.match(/<img\b/g)||[]).length,1,`${name}'s marker contains only their cutout`);
    assert(html.includes(`assets/avatars-v5/${person}.webp`));
    assert.match(html,new RegExp(name));
    assert.doesNotMatch(html,/team-faces|crew-tandem|Emily &(?:amp;)? Jeff|Huiyan &(?:amp;)? Graham/,'no combined portrait bubble remains');
    assert.deepEqual(marker.point,[position.lat,position.lng],`${name} is attached to their actual report`);
  }
  if(!graham){
    assert(!avatars.some(marker=>marker.options.icon.html.includes('data-person="graham"')),'legacy crew position is never assigned to Graham');
    assert.match(f.q('#map-waiting').innerHTML,/data-person="graham"/);
  }
}

test('runner cutouts and Huiyan’s legacy report retain their coordinates when changed or stale',async()=>{
  const updatedAt=new Date().toISOString();
  const runner={lat:52,lng:-.85,fresh:true,updatedAt,routeKm:10,offRouteM:0};
  const crew={lat:52.00025,lng:-.8497,fresh:true,sharing:true,updatedAt};
  const f=await load({snapshot:{runner,crew}});
  assertIndividualPeople(f,runner,crew);
  const lastAt=new Date(Date.now()-600000).toISOString();
  const nextRunner={...runner,lat:52.0001,lng:-.8499,fresh:false,updatedAt:lastAt};
  const nextCrew={...crew,lat:52.0003,lng:-.8496,fresh:false,sharing:false,updatedAt:lastAt};
  f.update({runner:nextRunner,crew:nextCrew});
  assertIndividualPeople(f,nextRunner,nextCrew);
  for(const marker of f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon')){
    assert.match(marker.options.icon.html,/stale/,'last-known positions are visually distinguished from fresh reports');
    assert.match(marker.options.icon.html,/10\s*m(?:in)?|10 minutes|10m/,'the timestamp remains available with each individual avatar');
  }
  f.update({runner:null,crew:null,googleMapsUrl:'https://maps.app.goo.gl/test-live-location'});
  assert.equal(f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon').length,0,'losing coordinates removes every real-position marker');
});

const individualTracking = {
  emily:{bib:'247',name:'Emily Simmons',status:'waiting'},
  jeff:{bib:'133',name:'Jeff Simmons',status:'waiting'}
};

test('Huiyan and Graham move, focus and join Everyone using only their own phone positions',async()=>{
  const updatedAt=new Date().toISOString();
  const emily={lat:52,lng:-.85,fresh:true,updatedAt,routeKm:10,offRouteM:0};
  const jeff={...emily,lat:51.9996,lng:-.8504};
  const huiyan={lat:52.002,lng:-.848,fresh:true,sharing:true,recordedAt:updatedAt,updatedAt};
  const graham={lat:52.0002,lng:-.8498,fresh:true,sharing:true,recordedAt:updatedAt,updatedAt};
  const snapshot={runner:emily,runners:{emily,jeff},crew:huiyan,supporters:{huiyan,graham,jeff:{...jeff,sharing:true}}};
  const f=await load({width:375,height:667,mode:'supporter',snapshot});
  assertIndividualPeople(f,emily,huiyan,jeff,graham);assertPortraitAnchors(f);
  const checkFrame=()=>{for(const p of [emily,jeff,huiyan,graham])assert(f.fitted.at(-1).some(point=>point[0]===p.lat&&point[1]===p.lng),'Everyone includes each real report');};
  f.api.everyone();checkFrame();
  f.api.focusPerson('crew');checkFrame();
  f.api.focusPerson('huiyan');assert.deepEqual(f.viewed.at(-1),[huiyan.lat,huiyan.lng]);
  f.api.focusPerson('graham');assert.deepEqual(f.viewed.at(-1),[graham.lat,graham.lng]);
  const movedGraham={...graham,lat:52.0003,lng:-.8496};
  f.update({...snapshot,supporters:{huiyan,graham:movedGraham,jeff:{...jeff,sharing:true}}});
  assertIndividualPeople(f,emily,huiyan,jeff,movedGraham);assertPortraitAnchors(f);
  for(const p of [emily,jeff,huiyan,movedGraham])assert(f.coordinateDots().some(dot=>dot.point[0]===p.lat&&dot.point[1]===p.lng),'every independent portrait retains its exact GPS dot');
});

test('a missing supporter stays waiting without borrowing another person or the legacy alias',async()=>{
  const updatedAt=new Date().toISOString();
  const emily={lat:52,lng:-.85,fresh:true,updatedAt,routeKm:10,offRouteM:0};
  const huiyan={lat:52.002,lng:-.848,fresh:true,sharing:true,updatedAt};
  const graham={lat:52.0002,lng:-.8498,fresh:true,sharing:true,updatedAt};
  const snapshot={runner:emily,runners:{emily,jeff:null},crew:huiyan,supporters:{huiyan,graham:null}};
  const f=await load({snapshot});
  const hasMarker=id=>f.markers().some(marker=>marker.options.icon?.html.includes(`data-person="${id}"`));
  assert(hasMarker('huiyan'));assert(!hasMarker('graham'));
  assert.match(f.q('#map-waiting').innerHTML,/data-person="graham"/);
  f.clickPerson('graham');
  assert.equal(f.q('#person-heading').textContent,'Graham');
  assert.match(f.q('#person-subtitle').textContent,/Supporting Emily/);
  assert.equal(f.q('#person-map-action').hidden,true,'no map jump is offered without Graham’s own report');
  const views=f.viewed.length;f.api.focusPerson('graham');assert.equal(f.viewed.length,views);
  f.update({...snapshot,supporters:{huiyan:null,graham}});
  assert(hasMarker('graham'));assert(!hasMarker('huiyan'),'an explicit supporters map is authoritative over legacy crew');
  assert.match(f.q('#map-waiting').innerHTML,/data-person="huiyan"/);
  assert.doesNotMatch(f.q('#map-waiting').innerHTML,/data-person="graham"/);
  f.clickPerson('huiyan');assert.equal(f.q('#person-map-action').hidden,true);
  assert.deepEqual(f.crewActions,[],'opening either missing-person card never changes sharing identity or starts GPS');
});

test('Emily supplies race progress while Jeff’s supporter phone keeps its own position',async()=>{
  const now=Date.now(),updatedAt=new Date(now).toISOString();
  const emily={...etaRunner(now-60000,10,6),lat:52,lng:-.8505};
  const oldJeff={...etaRunner(now,25,12),lat:53,lng:-.1};
  const jeff={lat:52.0009,lng:-.8495,fresh:true,sharing:true,recordedAt:updatedAt,updatedAt};
  const huiyan={lat:52.00025,lng:-.8497,fresh:true,sharing:true,updatedAt};
  const snapshot={runner:oldJeff,runners:{emily,jeff:oldJeff},runnerTracking:individualTracking,crew:huiyan,supporters:{huiyan,jeff}};
  const f=await load({snapshot});
  assertIndividualPeople(f,emily,huiyan,jeff);
  assert.match(f.q('#map-route-distance').innerHTML,/^10\.0/,'a newer old Jeff tracker cannot replace Emily’s race progress');
  assert.doesNotMatch(f.q('#map-tracking-status').textContent,/Using|Jeff|Both/);
  assert(f.fitted.at(-1).some(point=>point[0]===emily.lat&&point[1]===emily.lng));
  assert(!f.fitted.at(-1).some(point=>point[0]===oldJeff.lat&&point[1]===oldJeff.lng),'the switched-off tracker does not stretch the route map');
  f.api.everyone();
  for(const point of [emily,jeff,huiyan])assert(f.fitted.at(-1).some(p=>p[0]===point.lat&&p[1]===point.lng));
  f.api.focusPerson('jeff');assert.deepEqual(f.viewed.at(-1),[jeff.lat,jeff.lng]);
  const movedJeff={...jeff,lat:52.002,lng:-.847};
  f.update({...snapshot,supporters:{huiyan,jeff:movedJeff}});
  assertIndividualPeople(f,emily,huiyan,movedJeff);
  assert.match(f.q('#map-route-distance').innerHTML,/^10\.0/,'Jeff’s phone movement does not become runner progress');
});

test('missing Emily and Jeff phone reports never borrow Jeff’s old tracker or summary',async()=>{
  const now=Date.now(),oldJeff=etaRunner(now,10),phoneJeff={lat:52.001,lng:-.849,fresh:true,sharing:true,recordedAt:new Date(now).toISOString()};
  const snapshot={runner:oldJeff,runners:{emily:null,jeff:oldJeff},runnerTracking:individualTracking,supporters:{jeff:phoneJeff}};
  const f=await load({snapshot});
  assertIndividualPeople(f,null,null,phoneJeff);
  const waiting=f.q('#map-waiting').innerHTML;
  assert.match(waiting,/data-person="emily"/);assert.match(waiting,/247/);
  assert.doesNotMatch(waiting,/data-person="jeff"|133/);
  assert.equal(f.q('#map-route-distance').innerHTML,'—');
  f.update({...snapshot,supporters:{jeff:null}});
  assert.equal(f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon').length,0);
  assert.match(f.q('#map-waiting').innerHTML,/data-person="jeff"/);
  assert.doesNotMatch(f.q('#map-waiting').innerHTML,/133/,'Jeff’s waiting state is for phone sharing, not a race tracker');
  const views=f.viewed.length;f.api.focusPerson('jeff');assert.equal(f.viewed.length,views);
  assert.match(f.q('#map-tracking-status').textContent,/Emily 247/);
});

test('an absent or stale Emily report cannot be replaced by Jeff’s old race tracker',async()=>{
  const now=Date.now(),jeff=etaRunner(now,20),oldEmily={...etaRunner(now-600000,10),fresh:false};
  const points=[{id:'point-1',label:'Point 1',lat:52,lng:-.95,routeKm:5},{id:'point-2',label:'Point 2',lat:52,lng:-.75,routeKm:22}];
  for(const emily of [null,oldEmily]){
    const f=await load({points,planningEndKm:30,snapshot:{runner:jeff,runners:{emily,jeff},runnerTracking:individualTracking}});
    assert.equal(f.q('#map-route-distance').innerHTML,'—');
    assert.equal(f.q('#map-meet-distance').innerHTML,'—');
    assert.notEqual(f.q('#map-next-meet-name').textContent,'Point 2','Jeff cannot advance the agreed race meeting');
    if(!emily){const views=f.viewed.length;f.api.focusPerson('emily');assert.equal(f.viewed.length,views);}
  }
});

test('individual tracker errors retain the known bib and name the actual action needed',async()=>{
  for(const [status,label] of [['unavailable','Report unavailable'],['wrong-event','Check event'],['not-found','Check race number'],['ambiguous','Check tracker entry']]){
    const tracking={...individualTracking,emily:{...individualTracking.emily,status}};
    const f=await load({snapshot:{runner:null,runners:{emily:null,jeff:null},runnerTracking:tracking}});
    assert.match(f.q('#map-waiting').innerHTML,new RegExp(label));
    assert.match(f.q('#map-waiting').innerHTML,/247/);
    assert.equal(f.q('#map-tracking-status').textContent,'Emily 247 · '+label.toLowerCase()+' ›');
    assert.doesNotMatch(f.q('#map-tracking-status').textContent,/awaiting reports|number pending/);
    assert.equal(f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon').length,0);
  }
});

for (const viewport of [{ width: 375, height: 340 }, { width: 390, height: 430 }]) {
test(`poster map fits readable labels in its independent ${viewport.width}×${viewport.height} viewport`, async () => {
  const updatedAt = new Date().toISOString();
  const runner = { lat: 52, lng: -.85, fresh: true, updatedAt, routeKm: 10, offRouteM: 0 };
  const crew = { ...runner, lng: -.8498, sharing: true };
  const graham = { ...crew, lat: 52.0002, lng: -.8502 };
  const selected = { id: 'point-6', label: 'Point 6', lat: 52.00015, lng: -.8498, routeKm: 10 };
  const wc = { id: 'wc', name: 'Nearby public toilet', kinds: ['toilet'], lat: 51.9998, lng: -.8492, routeKm: 10.1, routeOffsetM: 0 };
  const f = await load({ ...viewport, poster: true, followTop: 9, selected, pois: [wc], measuredPinHeights: { portrait: 104, meeting: 64 }, snapshot: familySnapshot(runner,crew,runner,graham) });
  const markers = f.markers().filter(marker => /portrait-map-icon|meeting-map-icon|facility-map-icon/.test(marker.options.icon?.className || ''));
  assert.equal(markers.length, 6);
  const boxes = markers.map(marker => markerBox(f, marker));
  const controls = f.rectangles['.map-control-stack'];
  const controlBox = { name: 'recenter control', x: controls.left, y: controls.top, w: controls.width, h: controls.height };
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert(a.x >= 9 && a.y >= 8 && a.x + a.w <= viewport.width - 9 && a.y + a.h <= viewport.height - 65, `${a.name} stays above the relocated bottom map pills ${JSON.stringify(boxes)}`);
    for (const b of boxes.slice(i + 1)) assertSeparate(a, b);
    assertSeparate(a, controlBox);
  }
  assertIndividualPeople(f,runner,crew,runner,graham);
  assert.equal(markers.filter(marker=>marker.options.icon.className==='portrait-map-icon').reduce((total,portrait)=>total+(portrait.options.icon.html.match(/<img\b/g)||[]).length,0),4,'even short maps retain all four cutouts');
  const fit = f.padding.at(-1);
  assert(fit.paddingTopLeft[1] + fit.paddingBottomRight[1] < viewport.height - 60, 'external summary and navigation do not consume map padding');
  assertCoordinates(f,[[runner.lat, runner.lng], [crew.lat, crew.lng], [graham.lat,graham.lng], [selected.lat, selected.lng], [wc.lat, wc.lng]]);
});
}

for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
test(`four individual avatars and the meeting stay readable beside a WC at ${viewport.width}×${viewport.height}`, async () => {
  const updatedAt = new Date().toISOString();
  const runner = { lat: 52, lng: -.85, fresh: true, updatedAt, routeKm: 10, projectedRouteKm: 10, offRouteM: 0 };
  const crew = { lat: 52.00025, lng: -.8497, fresh: true, sharing: true, updatedAt };
  const graham = { ...crew, lat: 52.0001, lng: -.8504 };
  const selected = { id: 'point-6', label: 'Point 6', lat: 52.00015, lng: -.8498, routeKm: 10 };
  const wc = { id: 'nearby-wc', name: 'Nearby public toilet', kinds: ['toilet'], lat: 51.999, lng: -.8492, routeKm: 10.1, routeOffsetM: 0 };
  const f = await load({ ...viewport, snapshot: {...familySnapshot(runner,crew,runner,graham),tracker:{status:'live'}}, selected, pois: [wc] });
  const callouts = f.markers().filter(marker => /portrait-map-icon|meeting-map-icon/.test(marker.options.icon?.className || ''));
  assert.equal(callouts.length, 5);
  assertIndividualPeople(f,runner,crew,runner,graham);
  const boxes = callouts.map(marker => markerBox(f, marker));
  const wcMarker = f.markers().find(marker => marker.options.icon?.className === 'facility-map-icon');
  assert(wcMarker, 'the nearby WC remains labelled on the runner map');
  const wcBox = markerBox(f, wcMarker);
  const row = f.rectangles['.map-follow-row'], header = f.rectangles['.map-distance'];
  const tallestPortrait=Math.max(...callouts.filter(marker=>marker.options.icon.className==='portrait-map-icon').map(marker=>marker.options.icon.iconSize[1]));
  assert(f.padding.at(-1).paddingTopLeft[1]-(header.top+header.height)>=tallestPortrait+8,'automatic framing leaves room for a complete northern portrait and its dot below the summary');
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert(a.x >= 0 && a.y >= header.top + header.height && a.x + a.w <= viewport.width && a.y + a.h <= row.top, `${a.name} stays between the summary and bottom pills`);
    for (const b of boxes.slice(i + 1)) assertSeparate(a, b);
    assertSeparate(a, wcBox);
  }
  assert.equal(f.q('#map-next-meet-name').textContent, 'Point 6', 'the agreed place is visible in the fixed summary without inspecting a map label');
  assertCoordinates(f,[[runner.lat, runner.lng], [crew.lat, crew.lng], [graham.lat,graham.lng], [selected.lat, selected.lng], [wc.lat, wc.lng]], 'dots retain all actual coordinates even when individual cutouts move');
});
}

test('wrapped meeting labels use their measured height and a taller summary as collision boundaries', async () => {
  const updatedAt = new Date().toISOString();
  const selected = { id: 'custom-stop', name: 'The little bridge by the village café', lat: 52, lng: -.85, routeKm: 12.4 };
  const runner = { lat: 52, lng: -.85, fresh: true, updatedAt, routeKm: 10, offRouteM: 0 };
  const crew = { ...runner, lng: -.8498, sharing: true };
  const f = await load({ selected, followTop: 249, measuredPinHeights: { portrait: 112, meeting: 138 }, snapshot: { runner, crew } });
  const markers = f.markers().filter(marker => /portrait-map-icon|meeting-map-icon/.test(marker.options.icon?.className || ''));
  const boxes = markers.map(marker => markerBox(f, marker));
  assert.equal(boxes.find(box => box.name.includes(selected.name)).h, 138, 'the wrapped label is not tested with a one-line placeholder height');
  const row = f.rectangles['.map-follow-row'], header = f.rectangles['.map-distance'];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert(a.y >= header.top + header.height && a.y + a.h <= row.top, `${a.name} respects the taller measured summary and bottom shortcuts`);
    for (const b of boxes.slice(i + 1)) assertSeparate(a, b);
  }
  assert.equal(f.q('#map-next-meet-name').textContent, selected.name);
  assert.match(f.q('#map-meet-distance').innerHTML, /^2\.4/);
});

test('supporter WC and parking/charging labels stay separate from individual avatars and the meeting on a compact phone', async () => {
  const updatedAt = new Date().toISOString();
  const selected = { id: 'point-6', label: 'Point 6', lat: 52, lng: -.85, routeKm: 10 };
  const runner = { ...selected, fresh: true, updatedAt, offRouteM: 0 };
  const crew = { ...runner, lng: -.8498, sharing: true };
  const pois = [
    { id: 'wc', name: 'Public toilet', kinds: ['toilet'], lat: 52.00005, lng: -.85005, routeKm: 10, routeOffsetM: 0 },
    { id: 'ev-carpark', name: 'Car park with EV charging', kinds: ['parking', 'charger'], lat: 52.0001, lng: -.8501, routeKm: 10, routeOffsetM: 0 }
  ];
  const f = await load({ width: 375, height: 667, mode: 'supporter', selected, pois, snapshot: familySnapshot(runner,crew,runner) });
  const markers = f.markers().filter(marker => /portrait-map-icon|meeting-map-icon|facility-map-icon/.test(marker.options.icon?.className || ''));
  const boxes = markers.map(marker => markerBox(f, marker));
  assert.equal(boxes.length, 6);
  const row = f.rectangles['.map-follow-row'], header = f.rectangles['.map-distance'];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert(a.x >= 0 && a.x + a.w <= 375 && a.y >= header.top + header.height && a.y + a.h <= row.top, `${a.name} stays visible between the summary and bottom shortcuts`);
    for (const b of boxes.slice(i + 1)) assertSeparate(a, b);
  }
  assertCoordinates(f,[[runner.lat, runner.lng], [crew.lat, crew.lng], [selected.lat, selected.lng], ...pois.map(p => [p.lat, p.lng])]);
});

test('a route load failure remains visible after later live updates', async () => {
  const f = await load({ failRoute: true });
  assert.equal(f.q('#map-notice').hidden, false);
  f.update({ tracker: { status: 'waiting' } });
  assert.equal(f.q('#map-notice').hidden, false);
  assert.match(f.q('#map-notice').textContent, /could not load|unavailable/i);
});

test('supporter toilet cards distinguish route progress from an unmeasured walking detour', async () => {
  const selected = { id: 'point-6', label: 'Point 6', lat: 52, lng: -0.85, routeKm: 10 };
  const f = await load({ mode: 'supporter', selected,
    snapshot: { runner: { lat: 52, lng: -1, fresh: true, routeKm: 0, projectedRouteKm: 0, offRouteM: 0, updatedAt: new Date().toISOString() } },
    pois: [{ id: 'wc', name: 'Checked toilets', kinds: ['toilet'], lat: 52, lng: -0.85, routeKm: 10, routeOffsetM: 0, hoursLabel: 'Check hours', access: 'Public', sources: [] }]
  });
  f.api.showAmenities('toilet');
  assert.match(f.q('#facilities-list').innerHTML, /0 m from route in a straight line; check walking access/);
  assert.match(f.q('#facilities-context').textContent, /Toilets & cafés along the route/);
  assert.match(f.q('#facilities-list').innerHTML, /10\.0 km ahead/);
});

test('one tap shows all six named toilets in the next 20 route km for either role, beyond the next meet-up',async()=>{
  const updatedAt=new Date().toISOString();
  const runner={lat:52,lng:-.85,routeKm:12,projectedRouteKm:12,offRouteM:0,fresh:true,updatedAt};
  const selected={id:'first',label:'First meet-up',name:'MFG Coventry',lat:52.0003,lng:-.8498,routeKm:17.3};
  const venues=[14.6,17.3,17.7,22,27.8,31.1].map((routeKm,i)=>({id:'wc-'+i,name:'Checked venue '+i,mapLabel:'WC venue '+i,mapAccessLabel:i===2||i===3?'Daytime only':'Check night access',daytimeOnly:i===2||i===3,kinds:['toilet'],lat:52.0001+i*.00003,lng:-.8499+i*.00002,routeKm,routeOffsetM:90,hoursLabel:'Advertised hours',access:'Ask staff about toilet access',sources:[]}));
  const excluded=[{...venues[0],id:'behind',name:'Behind runner',routeKm:11},{...venues[0],id:'later',name:'Beyond window',routeKm:32.1},{...venues[0],id:'distant',name:'Too far from route',routeOffsetM:1100}];
  for(const mode of ['runner','supporter']){
    const f=await load({mode,selected,pois:[...venues,...excluded],snapshot:{runner}});
    f.api.setToiletFilters({scope:'20',wide:false});
    const facilities=()=>f.markers().filter(marker=>/facility-map-icon/.test(marker.options.icon?.className||''));
    assert.equal(facilities().length,1,'normal meet-up map stays uncluttered');
    f.clickMapAction('toilets');
    assert.deepEqual(f.tabs,['now'],'main toilet action opens the map directly, without a sheet first');
    assert.equal(facilities().length,6);
    assert.equal(f.q('#map-follow-label').textContent,'Back to meet-up');
    assert.match(f.q('#map-notice').textContent,/next 20 km/i);
    for(const venue of venues){
      assert(facilities().some(marker=>marker.options.icon.html.includes(venue.mapLabel)));
      assert(f.fitted.at(-1).some(point=>point[0]===venue.lat&&point[1]===venue.lng),'every checked WC is in the focused map bounds');
    }
    assert(facilities().filter(marker=>marker.options.icon.html.includes('Daytime only')).length===2);
    assert.equal(f.q('#map-next-meet-name').textContent,'First meet-up','toilets do not alter the selected meet-up');
    f.api.follow();
    assert.equal(facilities().length,1);
    assert.equal(f.q('#map-notice').hidden,true);
    assert.notEqual(f.q('#map-follow-label').textContent,'Back to meet-up');
  }
});

test('normal WC avoids daytime-only stops, and named WC taps show honest access, safe phone and route-offset details',async()=>{
  const updatedAt=new Date().toISOString(),runner={lat:52,lng:-.85,routeKm:12,projectedRouteKm:12,offRouteM:0,fresh:true,updatedAt};
  const pois=[
    {id:'day',name:'Daytime library',mapLabel:'Library',mapAccessLabel:'Daytime only',daytimeOnly:true,kinds:['toilet'],lat:52,lng:-.8499,routeKm:13,routeOffsetM:10,hoursLabel:'Saturday 10:30–13:00',phone:'javascript:alert(1)',access:'During library hours only',sources:[]},
    {id:'station',name:'Petrol station',mapLabel:'Petrol station',mapAccessLabel:'Check night access',kinds:['toilet'],lat:52,lng:-.8498,routeKm:15,routeOffsetM:120,hoursLabel:'Fuel: 24 hours; toilet access to check',phone:'024 7655 1234',access:'Ask staff whether the toilet is accessible overnight',sources:[]}
  ];
  for(const mode of ['runner','supporter']){
    const f=await load({mode,pois,snapshot:{runner}});
    assert(f.markers().some(marker=>marker.options.icon?.html.includes('Petrol station')));
    assert(!f.markers().some(marker=>marker.options.icon?.html.includes('Library')));
    f.clickMapAction('toilets');
    f.markers().find(marker=>marker.options.icon?.html.includes('Petrol station')).events.click();
    assert.equal(f.tabs.at(-1),'facilities');
    const html=f.q('#facilities-list').innerHTML;
    assert(html.indexOf('id="facility-station"')<html.indexOf('id="facility-day"'),'the tapped venue opens first');
    assert.match(html,/Ask staff whether the toilet is accessible overnight/);
    assert.match(html,/href="tel:02476551234"/);
    assert.doesNotMatch(html,/href="tel:javascript/);
    assert.match(html,/120 m from route in a straight line; check walking access/);
    assert.match(html,/Regular advertised hours, not live availability/);
    assert.match(html,/Show 2 pit stops on map/);
  }
});

test('a distant agreed meeting does not stretch the focused toilet map beyond the next 20 km',async()=>{
  const updatedAt=new Date().toISOString(),runner={lat:52,lng:-.85,routeKm:12,projectedRouteKm:12,offRouteM:0,fresh:true,updatedAt};
  const selected={id:'distant',label:'Distant agreed point',lat:52.01,lng:-.84,routeKm:50};
  const f=await load({selected,planningEndKm:100,snapshot:{runner},pois:[{id:'wc',name:'Nearby route WC',kinds:['toilet'],lat:52.0001,lng:-.8499,routeKm:16,routeOffsetM:50}]});
  f.api.setToiletFilters({scope:'20',wide:false});
  assert.equal(meetingMarkers(f).length,1);
  f.clickMapAction('toilets');
  assert.equal(meetingMarkers(f).length,0,'an out-of-window meeting is omitted only from the WC map');
  assert(!f.fitted.at(-1).some(point=>point[0]===selected.lat&&point[1]===selected.lng));
  assert.equal(f.q('#map-next-meet-name').textContent,'Distant agreed point','the actual meeting plan stays unchanged');
  f.api.follow();
  assert.equal(meetingMarkers(f).length,1);
});

test('six compact WC labels, Emily and supporter cutouts and the next meeting fit a phone map',async()=>{
  const updatedAt=new Date().toISOString(),runner={lat:52,lng:-.85,routeKm:12,projectedRouteKm:12,offRouteM:0,fresh:true,updatedAt};
  const crew={lat:52.0002,lng:-.8498,fresh:true,sharing:true,updatedAt};
  const selected={id:'first',label:'First meet-up',name:'MFG Coventry',lat:52.0003,lng:-.8497,routeKm:17.3};
  const pois=Array.from({length:6},(_,i)=>({id:'wc-'+i,name:'Checked WC '+i,mapLabel:'Venue '+i,mapAccessLabel:'Check night access',kinds:['toilet'],lat:52.00004+i*.00005,lng:-.8501+i*.00003,routeKm:14+i*3,routeOffsetM:50}));
  for(const mode of ['runner','supporter']){
    const f=await load({mode,width:375,height:667,selected,pois,snapshot:familySnapshot(runner,crew,runner)});
    f.api.setToiletFilters({scope:'20',wide:false});
    f.clickMapAction('toilets');
    const boxes=f.markers().filter(marker=>/portrait-map-icon|meeting-map-icon|facility-map-icon/.test(marker.options.icon?.className||'')).map(marker=>markerBox(f,marker));
    assert.equal(boxes.length,10);
    const row=f.rectangles['.map-follow-row'],header=f.rectangles['.map-distance'];
    for(let i=0;i<boxes.length;i++){
      const a=boxes[i];
      assert(a.x>=0&&a.x+a.w<=375&&a.y>=header.top+header.height&&a.y+a.h<=row.top,`${a.name} remains visible`);
      for(const b of boxes.slice(i+1))assertSeparate(a,b);
    }
  }
});

const toiletTestNow=Date.parse('2026-11-14T12:00:00Z');
const toiletReport=routeKm=>({lat:52,lng:-.85,routeKm,projectedRouteKm:routeKm,offRouteM:0,fresh:true,updatedAt:new Date(toiletTestNow).toISOString()});
const toiletSchedule=(basis='toilet',opens='09:00',closes='18:00')=>({timeZone:'Europe/London',basis,weekly:Object.fromEntries(Array.from({length:7},(_,day)=>[String(day),[[opens,closes]]]))});
const toiletFixture=(id,routeKm,extra={})=>({id,name:'Toilet '+id,mapLabel:'WC '+id,town:'Test town',kinds:['toilet'],lat:52+routeKm*.00001,lng:-.85+routeKm*.00001,routeKm,routeOffsetM:0,access:'Check the signed entrance',hoursLabel:'Published hours',sources:[],...extra});
const visibleToiletIds=f=>Array.from(f.api.getVisibleToilets(),p=>p.id);

test('WC defaults cover the remaining route and respond to runner progress, the chosen horizon and planned finish',async()=>{
  const pois=[
    toiletFixture('behind',8),toiletFixture('here',10),toiletFixture('near',25),
    toiletFixture('edge',30),toiletFixture('later',45),toiletFixture('finish',60),
    toiletFixture('beyond-finish',60.1,{beyondPlannedEndpoint:true}),
    toiletFixture('detour',14,{routeOffsetM:1600}),toiletFixture('too-far',15,{routeOffsetM:3100}),
    toiletFixture('no-route',null),toiletFixture('cafe-only',18,{kinds:['cafe']})
  ];
  for(const mode of ['runner','supporter']){
    const f=await load({mode,now:toiletTestNow,planningEndKm:60,pois,snapshot:{runner:toiletReport(10)}});
    assert.equal(f.api.getToiletFilters().scope,'remaining');
    assert.equal(f.api.getToiletFilters().arrival,mode==='runner'?'runner':'crew');
    assert.equal(f.api.getToiletFilters().wide,mode==='supporter');
    assert.deepEqual(visibleToiletIds(f),mode==='supporter'?['here','detour','near','edge','later','finish']:['here','near','edge','later','finish']);
    f.api.setToiletFilters({scope:'20',wide:false});
    assert.deepEqual(visibleToiletIds(f),['here','near','edge'],'the 20 km endpoint is included, with no distant detour or beyond-finish marker');
    f.update({runner:toiletReport(27)});
    assert.deepEqual(visibleToiletIds(f),['edge','later'],'the window moves with progress rather than staying anchored to the previous meet-up');
    f.update({runner:toiletReport(55)});
    assert.deepEqual(visibleToiletIds(f),['finish'],'a 20 km window is still capped at the actual planned finish');
    f.update({runner:toiletReport(61)});
    assert.deepEqual(visibleToiletIds(f),[],'passed facilities do not reappear after the finish');
  }
});

test('opening filters separate published toilet hours from venue hours, closing risks and unknown access',async()=>{
  const pois=[
    toiletFixture('public',12,{opening:toiletSchedule()}),
    toiletFixture('customer',13,{opening:toiletSchedule('venue')}),
    toiletFixture('closing-soon',14,{opening:toiletSchedule('toilet','09:00','12:35')}),
    toiletFixture('closed',15,{opening:toiletSchedule('toilet','06:00','10:00')}),
    toiletFixture('unknown',16,{opening:toiletSchedule('unknown')}),
    toiletFixture('conflict',17,{opening:toiletSchedule('conflicting')})
  ];
  const f=await load({now:toiletTestNow,planningEndKm:60,pois,toiletHours:true,snapshot:{runner:toiletReport(10)},
    forecast:{status:'ready',earliestArrivalTime:toiletTestNow+20*60000,arrivalTime:toiletTestNow+30*60000,selectedRunnerName:'Emily'}});
  const checks=Object.fromEntries(Array.from(f.api.getVisibleToilets(),p=>[p.id,p.check.status]));
  assert.deepEqual(checks,{public:'open',customer:'likely','closing-soon':'tight',closed:'closed',unknown:'unknown',conflict:'unknown'});
  f.api.setToiletFilters({opening:'open'});
  assert.deepEqual(visibleToiletIds(f),['public','customer'],'the open filter admits a qualified venue option, but no near-closing or unverified stop');
  f.api.setToiletFilters({opening:'confirmed'});
  assert.deepEqual(visibleToiletIds(f),['public'],'confirmed excludes a shop-hours-only assumption');
  f.api.showAmenities('toilet');
  assert.match(f.q('#facilities-list').innerHTML,/Open at ETA/);
  assert.doesNotMatch(f.q('#facilities-list').innerHTML,/Toilet customer|Toilet closed|Toilet unknown/);
  f.api.setToiletFilters({opening:'all'});
  assert.match(f.q('#facilities-list').innerHTML,/Likely open · check WC access/);
  assert.match(f.q('#facilities-list').innerHTML,/Opening \/ closing near ETA/);
  assert.match(f.q('#facilities-list').innerHTML,/Closed at ETA/);
  assert.match(f.q('#facilities-list').innerHTML,/Hours conflict · check/);
});

test('a 24-hour listing never produces an open-at-arrival result without a usable ETA',async()=>{
  const pois=[toiletFixture('all-day',12,{opening:toiletSchedule('toilet','00:00','24:00')})];
  for(const mode of ['runner','supporter']){
    const f=await load({mode,now:toiletTestNow,planningEndKm:60,pois,toiletHours:true,
      crewTravel:{estimate:()=>({status:'unavailable',source:'crew',note:'Share a fresh supporter position.'}),refresh:async()=>{}},
      snapshot:{runner:toiletReport(10)},forecast:null});
    const [stop]=f.api.getVisibleToilets();
    assert.equal(stop.check.status,'unknown');
    for(const opening of ['open','confirmed']){
      f.api.setToiletFilters({opening});
      assert.deepEqual(visibleToiletIds(f),[]);
      f.api.showAmenities('toilet');
      assert.match(f.q('#facilities-list').innerHTML,/No stops match yet/);
      assert.match(f.q('#facilities-list').innerHTML,/needs a usable ETA and checked hours/);
      assert.doesNotMatch(f.q('#facilities-list').innerHTML,/Open at ETA|Likely open/);
    }
    f.api.setToiletFilters({opening:'all'});
    assert.match(f.q('#facilities-list').innerHTML,/ETA unavailable/);
    assert.match(f.q('#facilities-list').innerHTML,/Toilet all-day/,'a missing ETA keeps the researched option available for inspection');
  }
});

test('the selected arrival uses runner forecasting or crew road travel without starting road requests on the normal map',async()=>{
  const requests=[],forecastRequests=[],crewEstimates=[];
  const poi=toiletFixture('early-close',14,{opening:toiletSchedule('toilet','09:00','13:00')});
  const snapshot={runner:toiletReport(10),crew:{lat:52.001,lng:-.849,fresh:true,sharing:true,recordedAt:new Date(toiletTestNow).toISOString()}};
  const f=await load({mode:'supporter',now:toiletTestNow,planningEndKm:60,pois:[poi],snapshot,toiletHours:true,
    forecast:options=>{forecastRequests.push(options);return {status:'ready',earliestArrivalTime:toiletTestNow+115*60000,arrivalTime:toiletTestNow+120*60000,selectedRunnerName:'Jeff'};},
    crewTravel:{driver:()=>({id:'huiyan',name:'Huiyan'}),estimate:options=>{crewEstimates.push(options);return {status:'ready',source:'crew',earliestArrivalTime:toiletTestNow+20*60000,arrivalTime:toiletTestNow+25*60000,formattedTime:'12:25',rangeText:'12:20–12:25',note:'Road travel and parking allowance.'};},refresh:async options=>{requests.push(options);}}});
  assert.equal(requests.length,0,'initial map rendering must not trigger the road-routing service');
  f.api.setToiletFilters({arrival:'crew'});
  f.api.showAmenities('all');
  assert.equal(requests.length,0,'neither a saved preference nor the general facilities sheet requests WC road routes');
  f.api.showAmenities('toilet');
  assert.equal(requests.length,1,'opening the crew WC sheet requests its road estimates');
  assert.deepEqual(Array.from(requests[0].pois,p=>p.id),['early-close']);
  assert.equal(requests[0].snapshot,snapshot);
  assert.equal(f.api.getVisibleToilets()[0].arrival.source,'crew');
  assert.equal(f.api.getVisibleToilets()[0].check.status,'open');
  assert.match(f.q('#facilities-list').innerHTML,/~12:25/);
  assert.match(f.q('#toilet-time-note').textContent,/Driving if Huiyan leaves now/);
  f.api.setToiletFilters({arrival:'runner'});
  assert.equal(requests.length,1,'runner arrival does not make an additional road request');
  assert.equal(f.api.getVisibleToilets()[0].arrival.selectedRunnerName,'Jeff');
  assert.equal(f.api.getVisibleToilets()[0].check.status,'closed','the slower runner arrival must not inherit the supporter’s open result');
  assert.match(f.q('#facilities-list').innerHTML,/<strong>13:55–14:00<\/strong>/,'runner arrival shows the whole window, starting at the earlier estimate');
  assert.doesNotMatch(f.q('#facilities-list').innerHTML,/<strong>~14:00/);
  assert.match(f.q('#toilet-time-note').textContent,/route pace and slowdown/);
  assert(forecastRequests.some(call=>call.point?.id===poi.id&&call.snapshot===snapshot),'the forecast receives this toilet’s route position and the current tracker snapshot');
  assert(crewEstimates.some(call=>call.poi.id===poi.id&&call.snapshot===snapshot));
  f.api.setToiletFilters({arrival:'crew'});
  const beforeHidden=requests.length;
  f.document.hidden=true;f.update(snapshot);
  assert.equal(requests.length,beforeHidden,'hidden tabs do not initiate road work');
  f.document.hidden=false;f.api.follow();f.switchTab('now');f.update(snapshot);
  assert.equal(requests.length,beforeHidden,'returning to the normal meet-up map stops WC road refreshes');
  f.clickMapAction('toilets');
  assert.equal(requests.length,beforeHidden+1,'the dedicated WC map may request crew road travel');
});

test('WC filter controls update the list, retain the meeting plan and return the exact selected toilet to the map',async()=>{
  const selected={id:'meet',label:'Our agreed meet-up',lat:52,lng:-.85,routeKm:20};
  const pois=[toiletFixture('near',12),toiletFixture('later',45),toiletFixture('detour',15,{routeOffsetM:1500})];
  const f=await load({now:toiletTestNow,planningEndKm:60,selected,pois,snapshot:{runner:toiletReport(10)}});
  f.clickMapAction('toilet-filters');
  assert.equal(f.tabs.at(-1),'facilities');
  assert.equal(f.q('#toilet-filters').hidden,false);
  assert.equal(f.q('#toilet-scope').value,'remaining');
  assert.match(f.q('#facilities-list').innerHTML,/Show 2 pit stops on map/);
  f.q('#toilet-scope').value='20';f.q('#toilet-scope').dispatch('change');
  assert.match(f.q('#facilities-list').innerHTML,/Show 1 pit stops on map/);
  assert.doesNotMatch(f.q('#facilities-list').innerHTML,/Toilet later|Toilet detour/);
  f.q('#toilet-wide').checked=true;f.q('#toilet-wide').dispatch('change');
  assert.match(f.q('#facilities-list').innerHTML,/Toilet detour/);
  assert.equal(f.api.getToiletFilters().wide,true);
  f.q('#toilet-opening').value='confirmed';f.q('#toilet-opening').dispatch('change');
  assert.match(f.q('#facilities-list').innerHTML,/No stops match yet/);
  f.clickMapAction('toilet-reset');
  assert.equal(f.api.getToiletFilters().scope,'remaining');
  assert.equal(f.api.getToiletFilters().opening,'all');
  assert.equal(f.api.getToiletFilters().wide,true);
  assert.match(f.q('#facilities-list').innerHTML,/Show 3 pit stops on map/);
  f.clickMapAction('toilets');
  assert.equal(f.tabs.at(-1),'now');
  assert.equal(f.markers().filter(marker=>/facility-map-icon/.test(marker.options.icon?.className||'')).length,3);
  assert.equal(f.q('#map-next-meet-name').textContent,'Our agreed meet-up');
  f.api.showAmenities('toilet');f.clickPoi('later');
  assert.equal(f.tabs.at(-1),'now');
  assert.deepEqual(f.viewed.at(-1),[pois[1].lat,pois[1].lng]);
  assert.deepEqual(f.externalOpens,[],'Show on map stays in the guide');
  assert.equal(f.api.getToiletFilters().scope,'remaining','inspecting a pin does not silently replace the filters');
});

test('a crew travel result refreshes an open WC sheet without treating a loading result as open',async()=>{
  let ready=false;
  const poi=toiletFixture('public',12,{opening:toiletSchedule()});
  const f=await load({mode:'supporter',now:toiletTestNow,planningEndKm:60,pois:[poi],toiletHours:true,snapshot:{runner:toiletReport(10)},
    crewTravel:{refresh:async()=>{},estimate:()=>ready?{status:'ready',source:'crew',earliestArrivalTime:toiletTestNow+10*60000,arrivalTime:toiletTestNow+15*60000,formattedTime:'12:15'}:{status:'unavailable',note:'Calculating road travel…'}}});
  f.api.setToiletFilters({opening:'confirmed'});f.api.showAmenities('toilet');
  assert.match(f.q('#facilities-list').innerHTML,/No stops match yet/);
  ready=true;f.windowEvent('crewtravelupdate');
  assert.match(f.q('#facilities-list').innerHTML,/Toilet public/);
  assert.match(f.q('#facilities-list').innerHTML,/~12:15/);
  assert.match(f.q('#facilities-list').innerHTML,/Open at ETA/);
  assert.deepEqual(visibleToiletIds(f),['public']);
});

const namedPoint = (id, number, routeKm, lat, lng, name) => ({
  id, pointNumber:String(number), groupNumber:Math.floor(Number(number)), label:'Point ' + number,
  routeKm, lat, lng, landmark:{name,mapLabel:name}, detail:'Original planning pin'
});
const meetingMarkers = f => f.markers().filter(marker => /meeting-map-icon/.test(marker.options.icon?.className || ''));

test('Re-centre map restores following after pan or zoom and acknowledges repeated direct taps',async()=>{
  const runner={lat:52,lng:-.85,routeKm:5,offRouteM:0,fresh:true,updatedAt:new Date().toISOString()};
  const points=[namedPoint('point-1',1,10,52.0003,-.8498,'Village Hall')];
  for(const poster of [false,true])for(const mode of ['runner','supporter']){
    const f=await load({poster,mode,points,snapshot:{runner}});
    assert.equal(f.q('#map-follow-label').textContent,'Re-centre map');
    assert.match(f.q('#map-follow').attributes['aria-label'],/Automatically following/);
    assert.deepEqual(f.notifications,[],'initial automatic framing has no toast');
    for(const gesture of ['dragstart','zoomstart']){
      f.mapEvent(gesture);
      assert(f.q('#map-follow').classList.contains('paused'));
      assert.match(f.q('#map-follow').attributes.title,/resume following/);
      assert.equal(f.q('#map-follow-label').textContent,'Re-centre map','the action keeps the same label after manual exploration');
      const before=f.fitted.length,notifications=f.notifications.length;
      f.update({runner:{...runner,routeKm:5.2,lng:-.849}});
      assert.equal(f.fitted.length,before,'a live refresh respects the user’s pan or zoom');
      assert.equal(f.notifications.length,notifications);
      f.q('#map-follow').click();
      assert.equal(f.fitted.length,before+1,'a direct tap fits the current runner and upcoming route');
      assert(f.fitted.at(-1).some(point=>point[0]===52&&point[1]===-.849));
      assert(!f.q('#map-follow').classList.contains('paused'));
      assert.match(f.q('#map-follow').attributes.title,/Automatically following/);
      assert.equal(f.notifications.at(-1),'Map centred · following runners and next meet-up');
      const sameBounds=f.fitted.at(-1);
      f.q(poster?'#map-recenter':'#map-follow').click();
      assert.equal(f.fitted.length,before+2,'already-following taps still perform the action');
      assert.deepEqual(f.fitted.at(-1),sameBounds);
      assert.equal(f.notifications.length,notifications+2,'same-bounds taps visibly confirm the action');
      f.update({runner:{...runner,routeKm:5.4,lng:-.848}});
      assert.equal(f.fitted.length,before+3,'following continues on the next tracker refresh');
      assert.equal(f.notifications.length,notifications+2,'background tracker refreshes stay silent');
      f.api.follow();
      assert.equal(f.notifications.length,notifications+2,'programmatic follow remains silent');
    }
    f.clickMapAction('next-point');
    assert.equal(f.tabs.at(-1),'point','the separate meet-up action opens its details');
    assert.match(f.q('#point-detail').innerHTML,/Village Hall/);
  }
});

test('runners see one compact next meet-up that advances automatically with progress', async () => {
  const updatedAt = new Date().toISOString();
  const points = [
    namedPoint('point-1',1,10,52.0003,-.8498,'Village Hall'),
    namedPoint('point-2',2,14,52.0005,-.8493,'Station Café'),
    namedPoint('point-3',3,18,52.0008,-.849,'Library')
  ];
  const runner = {lat:52,lng:-.85,routeKm:9.8,offRouteM:0,fresh:true,updatedAt};
  const f = await load({points,snapshot:{runner}});
  let shown = meetingMarkers(f);
  assert.equal(shown.length,1);
  assert.match(shown[0].options.icon.html,/NEXT/);
  assert.match(shown[0].options.icon.html,/Village Hall/);
  assert.doesNotMatch(shown[0].options.icon.html,/THEN|point-gap|options/);
  assert.equal(shown[0].options.icon.iconSize[0],148);
  assert.equal(shown[0].options.icon.iconSize[1],64,'compact label is not forced into the former 90px minimum');
  assert.equal(f.q('#map-meet-eyebrow').textContent,'NEXT MEET-UP','the automatic default does not falsely claim crew agreement');
  assert.match(f.q('#map-meet-distance').innerHTML,/^0\.2/);
  assert(f.fitted.at(-1).some(coordinate => coordinate[0] === points[0].lat && coordinate[1] === points[0].lng));
  f.update({runner:{...runner,routeKm:10.2}});
  shown = meetingMarkers(f);
  assert.equal(shown.length,1);
  assert.match(shown[0].options.icon.html,/Station Café/);
  assert(!shown.some(marker=>marker.options.icon.html.includes('Village Hall')),'passed point leaves the next-points map');
  assert.equal(f.q('#map-next-meet-name').textContent,'Point 2');
  assert.equal(f.q('#map-follow-label').textContent,'Re-centre map');
  assert(f.fitted.at(-1).some(coordinate => coordinate[0] === points[1].lat && coordinate[1] === points[1].lng));
});

test('paired numbered alternatives keep the following distinct point visible and reveal the other named choice on tap', async () => {
  const points = [
    namedPoint('point-4-1','4.1',12,52.0002,-.8503,'Village Hall'),
    namedPoint('point-4-2','4.2',12.25,52.0004,-.85,'Church Gate'),
    namedPoint('point-5',5,17,52.0007,-.8495,'Town Café')
  ];
  const f=await load({mode:'supporter',points,snapshot:{runner:{lat:52,lng:-.85,routeKm:10,offRouteM:0,fresh:true,updatedAt:new Date().toISOString()}}});
  const shown=meetingMarkers(f);
  assert.equal(shown.length,2);
  assert.match(shown[0].options.icon.html,/Village Hall/);
  assert.match(shown[1].options.icon.html,/THEN/);
  assert.match(shown[1].options.icon.html,/Town Café/);
  assert(!shown.some(marker=>marker.options.icon.html.includes('Church Gate')),'same-group alternate does not displace the next distinct numbered point');
  f.api.openPoint('point-4-1');
  assert.match(f.q('#point-detail').innerHTML,/Nearby choice/);
  assert.match(f.q('#point-detail').innerHTML,/Church Gate/);
  assert.match(f.q('#point-detail').innerHTML,/data-map-point-id="point-4-2"/);
});

test('runner details stay on the automatic next point without alternative choices or editing actions', async () => {
  const points = [
    namedPoint('point-4-1','4.1',12,52.0002,-.8503,'Village Hall'),
    namedPoint('point-4-2','4.2',12.25,52.0004,-.85,'Church Gate'),
    namedPoint('point-5',5,17,52.0007,-.8495,'Town Café')
  ];
  const f=await load({points,snapshot:{runner:{lat:52,lng:-.85,routeKm:10,offRouteM:0,fresh:true,updatedAt:new Date().toISOString()}}});
  f.api.openPoint('point-4-2');
  const html=f.q('#point-detail').innerHTML;
  assert.match(html,/NEXT MEET-UP/);
  assert.match(html,/Village Hall/);
  assert.match(html,/Walking directions/);
  assert.doesNotMatch(html,/Nearby choice|MEETING OPTION|Church Gate|data-support-action="(?:choose|skip|met)"/);
  assert.equal(meetingMarkers(f).length,1);
});

test('the one next meeting, individual cutouts and WC remain separate at 375×667', async () => {
  const updatedAt = new Date().toISOString();
  const points = [
    namedPoint('point-6',6,12,52.00015,-.8498,'Tesco Towcester'),
    namedPoint('point-7',7,15,52.0005,-.8494,'Church Gate')
  ];
  const runner={lat:52,lng:-.85,routeKm:10,offRouteM:0,fresh:true,updatedAt};
  const crew={lat:52.00025,lng:-.8497,fresh:true,sharing:true,updatedAt};
  const wc={id:'wc',name:'Checked public toilet',kinds:['toilet'],lat:51.999,lng:-.8492,routeKm:10.1,routeOffsetM:0};
  const f=await load({width:375,height:667,points,pois:[wc],snapshot:familySnapshot(runner,crew,runner),measuredPinHeights:{portrait:104,meeting:116}});
  const boxes=f.markers().filter(marker=>/portrait-map-icon|meeting-map-icon|facility-map-icon/.test(marker.options.icon?.className||'')).map(marker=>markerBox(f,marker));
  assert.equal(boxes.length,5);
  const row=f.rectangles['.map-follow-row'],header=f.rectangles['.map-distance'];
  for(let i=0;i<boxes.length;i++){
    const a=boxes[i];
    assert(a.x>=0&&a.x+a.w<=375&&a.y>=header.top+header.height&&a.y+a.h<=row.top,`${a.name} remains inside the usable phone map`);
    for(const b of boxes.slice(i+1))assertSeparate(a,b);
  }
  assertCoordinates(f,[[runner.lat,runner.lng],[crew.lat,crew.lng],[points[0].lat,points[0].lng],[wc.lat,wc.lng]],'leader labels retain the exact reported, next meeting and toilet coordinates');
});

test('dense supporter map keeps every exact pin and bounded portraits above the footer', async () => {
  const updatedAt=new Date().toISOString();
  const points=[
    namedPoint('point-6',6,12,52.00015,-.8498,'Tesco'),
    namedPoint('point-7',7,15,52.0005,-.8494,'Church Gate')
  ];
  const runner={lat:52,lng:-.85,routeKm:10,offRouteM:0,fresh:true,updatedAt};
  const crew={lat:52.00025,lng:-.8497,fresh:true,sharing:true,updatedAt};
  const pois=[
    {id:'wc',name:'Checked public toilet',kinds:['toilet'],lat:52.00005,lng:-.85005,routeKm:10.1,routeOffsetM:0},
    {id:'ev-carpark',name:'Parking with EV charging',kinds:['parking','charger'],lat:52.0001,lng:-.8501,routeKm:10.1,routeOffsetM:0}
  ];
  const f=await load({width:375,height:667,mode:'supporter',points,pois,snapshot:familySnapshot(runner,crew,runner),measuredPinHeights:{portrait:100,meeting:html=>html.includes('Church Gate')?113:91}});
  const boxes=f.markers().filter(marker=>/portrait-map-icon|meeting-map-icon|facility-map-icon/.test(marker.options.icon?.className||'')).map(marker=>markerBox(f,marker));
  assert.equal(boxes.length,7);
  assert.equal(boxes.find(box=>box.name.includes('Tesco')).h,91);
  assert.equal(boxes.find(box=>box.name.includes('Church Gate')).h,113);
  const parking=boxes.find(box=>box.name.includes('Parking with EV'));
  assert.equal(parking.w,91);
  const row=f.rectangles['.map-follow-row'],header=f.rectangles['.map-distance'],dock=f.rectangles['.supporter-dock'];
  assert.equal(dock.height,71);
  for(let i=0;i<boxes.length;i++){
    const a=boxes[i];
    assert(a.x>=0&&a.x+a.w<=375&&a.y>=header.top+header.height&&a.y+a.h<=row.top,`${a.name} stays visible above the bottom shortcut pills`);
    // Dense labels can overlap; preserving the people’s actual ordering takes priority over moving portraits to free global slots.
  }
  assertPortraitAnchors(f);
  assertCoordinates(f,[[runner.lat,runner.lng],[crew.lat,crew.lng],...points.map(p=>[p.lat,p.lng]),...pois.map(p=>[p.lat,p.lng])]);
});

function etaRunner(now,routeKm,speedKmh=6) {
  return {lat:52,lng:-.85+(routeKm-6)*.01,fresh:true,recordedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),routeKm,offRouteM:0,speedKmh,paceMinPerKm:speedKmh?60/speedKmh:null,paceSource:'recent-tracker-route',paceWindowMinutes:12};
}

test('Emily’s avatar shows race pace while Jeff’s avatar opens his supporter phone controls',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),emily=etaRunner(now,6,6),oldJeff=etaRunner(now,8,3);
  const jeff={lat:52.001,lng:-.849,fresh:true,sharing:true,recordedAt:new Date(now).toISOString()};
  const selected={id:'meet-12',label:'Next hello',landmark:{name:'Village Hall'},lat:52,lng:-.73,routeKm:12};
  const runnerTracking={emily:{bib:'247',status:'live'},jeff:{bib:'133',status:'live'}};
  for(const poster of [false,true])for(const mode of ['runner','supporter']){
    const f=await load({now,poster,mode,selected,snapshot:{runner:oldJeff,runners:{emily,jeff:oldJeff},supporters:{jeff},runnerTracking}});
    f.markers().find(marker=>marker.options.icon?.html.includes('data-person="emily"')).events.click();
    assert.equal(f.q('#person-heading').textContent,'Emily');assert.equal(f.q('#person-role').textContent,'RUNNER · #247');
    assert.match(f.q('#person-summary').innerHTML,/>10:00<small>min\/km/);
    assert.match(f.q('#person-summary').innerHTML,/GPS progress along the planned route over 12 min\. Includes stops\./);
    assert.match(f.q('#person-summary').innerHTML,/ETA ~01:50/);assert.match(f.q('#person-summary').innerHTML,/6\.0 km to go/);
    assert.match(f.q('#person-summary').innerHTML,/Village Hall/);
    f.api.openPerson('jeff');
    assert.equal(f.q('#person-heading').textContent,'Jeff');assert.equal(f.q('#person-role').textContent,'SUPPORT CREW');
    assert.match(f.q('#person-subtitle').textContent,/Supporting Emily/);
    assert.match(f.q('#person-summary').innerHTML,/Jeff’s own phone location/);
    assert.doesNotMatch(f.q('#person-summary').innerHTML,/20:00|ETA|133|unwell/);
    assert.equal(f.controlReads.at(-1).personId,'jeff');assert.deepEqual(f.crewActions,[]);
    assert.equal(f.q('#person-map-action').attributes['data-map-person-focus'],'jeff');
  }
});

test('a temporarily held route pace is visibly provisional in Emily’s avatar and the meet-up ETA',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z');
  const emily={...etaRunner(now,6,6),paceSource:'held-tracker-route',paceMeasuredAt:new Date(now-6*60000).toISOString()};
  const selected={id:'meet-12',label:'Next hello',landmark:{name:'Village Hall'},lat:52,lng:-.73,routeKm:12};
  const forecast=()=>({status:'ready',paceHeld:true,rangeText:'01:45–01:55',note:'Earlier GPS-measured route pace (provisional).'});
  const f=await load({now,selected,forecast,snapshot:{runner:emily,runners:{emily},runnerTracking:{emily:{bib:'247',status:'live'}}}});
  f.api.openPerson('emily');
  const html=f.q('#person-summary').innerHTML;
  assert.match(html,/10:00<small>min\/km/);
  assert.match(html,/Provisional earlier GPS route pace/);
  assert.match(html,/earlier measured pace/);
  assert.match(html,/ETA 01:45–01:55/);
  assert.match(html,/provisional/);
  assert.match(f.q('#map-meet-eta').textContent,/provisional/);
});

test('Jeff waits for phone sharing without inheriting his old tracker or Emily’s coordinates',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),emily=etaRunner(now,6,6),oldJeff=etaRunner(now,8,3);
  const selected={id:'meet-12',label:'Next hello',lat:52,lng:-.73,routeKm:12};
  const f=await load({now,selected,snapshot:{runner:oldJeff,runners:{emily,jeff:oldJeff},supporters:{jeff:null},runnerTracking:{emily:{bib:'247',status:'live'}}}});
  f.clickPerson('jeff');assert.equal(f.q('#person-heading').textContent,'Jeff');
  assert.match(f.q('#person-summary').innerHTML,/own phone location/);
  assert.doesNotMatch(f.q('#person-summary').innerHTML,/10:00|20:00|min\/km|ETA ~/);
  assert.equal(f.q('#person-map-action').hidden,true);
  assert.equal(f.controlReads.at(-1).personId,'jeff');
  f.api.openPerson('emily');assert.match(f.q('#person-summary').innerHTML,/10:00/);assert.match(f.q('#person-summary').innerHTML,/ETA ~01:50/);
});

test('an open pace card ages out even when its original fresh flag stays true',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),emily=etaRunner(now,6,6);
  const snapshot={runner:emily,runners:{emily,jeff:etaRunner(now,8,3)}};
  const f=await load({now,selected:{id:'meet',routeKm:12,lat:52,lng:-.73},snapshot});
  f.api.openPerson('emily');assert.match(f.q('#person-summary').innerHTML,/10:00/);
  f.advanceTime(300000);f.update(snapshot);
  assert.doesNotMatch(f.q('#person-summary').innerHTML,/10:00|ETA ~/);
  assert.match(f.q('#person-summary').innerHTML,/Waiting for a fresh report/);
  assert.match(f.q('#person-summary').innerHTML,/last report 5 min ago/);
});

test('runner cards withhold pace for unusable, off-route or untrusted individual reports',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),base=etaRunner(now,6,6);
  const f=await load({now,selected:{id:'meet',routeKm:12,lat:52,lng:-.73}});f.api.openPerson('emily');
  for(const changes of [
    {recordedAt:new Date(now+60000).toISOString()}, {offRouteM:501}, {offRouteM:null},
    {routeKm:null}, {paceSource:'crow-flight-average'}, {paceMinPerKm:0},
    {paceMinPerKm:121}, {finished:true}, {retired:true}, {fresh:false}
  ]){
    f.update({runner:base,runners:{emily:{...base,...changes},jeff:base}});
    assert.doesNotMatch(f.q('#person-summary').innerHTML,/10:00<small>|ETA ~/);
  }
  f.update({runner:base,runners:{emily:base,jeff:base},runnerTracking:{emily:{status:'unavailable'}}});
  assert.doesNotMatch(f.q('#person-summary').innerHTML,/10:00<small>|ETA ~/);
  assert.match(f.q('#person-summary').innerHTML,/temporarily unavailable/);
});

test('each supporter opens their own header, position controls and focus without starting GPS',async()=>{
  const huiyan={lat:52,lng:-.85,fresh:true,sharing:true,recordedAt:new Date().toISOString()};
  const graham={...huiyan,lat:52.001,lng:-.849},jeff={...huiyan,lat:51.999,lng:-.851};
  for(const room of [{owner:false},{owner:true},{canShareLocation:true}]){
    const f=await load({snapshot:{crew:huiyan,supporters:{huiyan,graham,jeff},room}});
    for(const person of ['huiyan','graham','jeff']){
      const marker=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="'+person+'"'));
      marker.events.click();
      assert.equal(f.q('#person-heading').textContent,person[0].toUpperCase()+person.slice(1));
      assert.equal(f.q('#person-portrait').src,'assets/avatars-v5/'+person+'.webp');
      assert.match(f.q('#person-summary').innerHTML,/own phone location/);
      assert.match(f.q('#person-controls').innerHTML,room.owner||room.canShareLocation?/Share now & every 30s/:/Connect this phone/);
      assert.doesNotMatch(f.q('#person-controls').innerHTML,/<form|\sid=|setup code/);
      assert.equal(f.q('#person-map-action').attributes['data-map-person-focus'],person);
      assert.equal(f.controlReads.at(-1).personId,person,'the compact controls are explicitly scoped to the viewed person');
      assert.equal(marker.options.keyboard,true);
    }
    assert.deepEqual(f.crewActions,[]);
    assert(f.controlReads.every(options=>options.compact===true));
  }
});

test('live supporter controls preserve focus and avoid replacing unchanged markup',async()=>{
  const snapshot={room:{canShareLocation:true},sharing:{automatic:false}};
  const f=await load({snapshot});f.api.openPerson('huiyan');
  const controls=f.q('#person-controls'),focused={dataset:{liveAction:'start'}};
  let html=controls.innerHTML,writes=0,focusRestored=0;
  Object.defineProperty(controls,'innerHTML',{get:()=>html,set:value=>{html=value;writes++;}});
  controls.contains=element=>element===focused;
  controls.querySelector=selector=>selector==='button:not([disabled])'?{focus(){focusRestored++;}}:null;
  f.document.activeElement=focused;
  f.update(snapshot);assert.equal(writes,0);assert.equal(focusRestored,0);
  f.update({...snapshot,sharing:{automatic:true}});
  assert.equal(writes,1);assert.equal(focusRestored,1);
  assert.match(html,/Update now/);
  f.changeMode('supporter');const readCount=f.controlReads.length;f.update(snapshot);
  assert.equal(f.controlReads.length,readCount,'mode changes dispose the active person view');
});

test('both roles and layouts show only Emily’s arrival even when a newer Jeff tracker is cached',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),emily=etaRunner(now-60000,6,6),jeff=etaRunner(now,8,3);
  const selected={id:'meet-12',label:'Next hello',lat:52,lng:-.73,routeKm:12};
  const runnerTracking={emily:{bib:'247',status:'live'},jeff:{bib:'133',status:'live'}};
  for(const poster of [false,true])for(const mode of ['runner','supporter']){
    const f=await load({now,mode,poster,selected,snapshot:{runner:jeff,runners:{emily,jeff},runnerTracking,supporters:{jeff:{...jeff,sharing:true}}}});
    const eta=f.q('#map-meet-eta');assert.match(eta.textContent,/ETA ~01:50/);
    assert.equal(eta.attributes['data-eta-state'],'available');
    assert.match(f.q(poster?'#poster-meeting':'.distance-destination').attributes['aria-label'],/01:50/);
    f.api.openPoint(selected);const html=f.q('#point-detail').innerHTML;
    assert.match(html,/Emily/);assert.match(html,/Estimated route pace 10:00 \/km over 12 min/);
    assert.doesNotMatch(html,/Jeff|133|02:10|20:00/);
    assert.match(html,/movement along the planned route, excluding time spent stationary/);assert.match(html,/UK local time/);
  }
  assert.match(guideMarkup,/<span class="destination-action"><span id="map-meet-eta"/);
  assert.match(posterMarkup,/<span id="map-meet-eta" class="map-meet-eta">/);
});

test('ETA uses Emily alone and waits when her report or pace is unavailable',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),emily=etaRunner(now,6,6),jeff=etaRunner(now,8,3);
  const selected={id:'meet-12',label:'Next hello',lat:52,lng:-.73,routeKm:12};
  const snapshot={runner:jeff,runners:{emily,jeff},supporters:{jeff:{...jeff,sharing:true}}};
  const f=await load({now,selected,snapshot});f.api.openPoint(selected);
  for(const unavailable of [null,{...emily,speedKmh:null,paceMinPerKm:null,paceSource:null},{...emily,fresh:false,recordedAt:new Date(now-600000).toISOString()}]){
    f.update({...snapshot,runners:{emily:unavailable,jeff}});
    assert.equal(f.q('#map-meet-eta').attributes['data-eta-state'],'unavailable','the old Jeff tracker and his phone cannot supply race ETA');
    assert.doesNotMatch(f.q('#point-arrival').innerHTML,/Jeff|02:10/);
  }
  f.update(snapshot);assert.match(f.q('#map-meet-eta').textContent,/01:50/);assert.doesNotMatch(f.q('#point-arrival').innerHTML,/02:10/);
});

test('the ETA follows the single automatic next meet-up and does not estimate an alternative for runners',async()=>{
  const now=Date.parse('2026-11-14T00:50:00Z'),initial=etaRunner(now,8,6);
  const points=[{id:'point-1',label:'Point 1',lat:52,lng:-.81,routeKm:10},{id:'point-2',label:'Point 2',lat:52,lng:-.71,routeKm:20}];
  const f=await load({now,points,snapshot:{runner:initial,runners:{emily:initial,jeff:initial}}});
  assert.match(f.q('#map-meet-eta').textContent,/01:10/);
  f.api.openPoint(points[1]);
  assert.equal(f.q('#point-heading').textContent,'Point 1');
  const moved=etaRunner(now,11,6);
  f.update({runner:moved,runners:{emily:moved,jeff:moved}});
  assert.equal(f.q('#map-next-meet-name').textContent,'Point 2');
  assert.match(f.q('#map-meet-eta').textContent,/02:20/);
  assert.match(f.q('#point-arrival').innerHTML,/next meet-up has changed/,'a previously opened point must not silently keep its old ETA');
  f.api.openPoint(points[1]);
  assert.match(f.q('#point-detail').innerHTML,/02:20/);
});

function assertPortraitAnchors(f) {
  const portraits=f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon');
  const anchors=portraits.map(marker=>{const box=markerBox(f,marker),dot=f.project(marker.point);return {dot,foot:{x:box.x+box.w/2,y:box.y+box.h+8},centre:{x:box.x+box.w/2,y:box.y+box.h/2},box};});
  for(const anchor of anchors)assert(Math.hypot(anchor.foot.x-anchor.dot.x,anchor.foot.y-anchor.dot.y)<=100.02,'portrait remains within 100px of its own above-dot baseline');
  for(let i=0;i<anchors.length;i++)for(const other of anchors.slice(i+1)){
    const a=anchors[i],dx=other.dot.x-a.dot.x,dy=other.dot.y-a.dot.y;
    if(dx*dx+dy*dy<1)continue;
    assert((other.centre.x-a.centre.x)*dx+(other.centre.y-a.centre.y)*dy>=-.02,'the portraits preserve the actual dot ordering, including a runner behind the support crew');
  }
}

test('runner cutouts cannot jump ahead of the support dot on a crowded phone map',async()=>{
  const now=Date.now(),stamp=new Date(now).toISOString();
  for(const [lat,lng] of [[52.00025,-.8497],[51.9998,-.849],[52.0008,-.8498]]){
    const emily={...etaRunner(now,10),lat:52,lng:-.85},jeff={...etaRunner(now,10.01),lat:52.00003,lng:-.84997};
    const crew={lat,lng,fresh:true,sharing:true,recordedAt:stamp,updatedAt:stamp};
    const graham={...crew,lat:52.00012,lng:-.85018};
    const points=[{...namedPoint('point-1',1,12,lat,lng,'MFG Coventry'),town:'Binley, Coventry'},{...namedPoint('point-2',2,16,lat+.0002,lng+.0003,'Market Cross'),town:'Dunchurch'}];
    const f=await load({width:375,height:667,mode:'supporter',points,snapshot:{runner:emily,runners:{emily,jeff},crew,supporters:{huiyan:crew,graham,jeff:{...jeff,sharing:true}}},measuredPinHeights:{portrait:76,meeting:112}});
    assertIndividualPeople(f,emily,crew,jeff,graham);assertPortraitAnchors(f);
    for(const marker of f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon'))assert(f.coordinateDots().some(dot=>dot.point[0]===marker.point[0]&&dot.point[1]===marker.point[1]),'every avatar keeps its exact reported GPS dot');
  }
});

test('a walking partner stays separate from Emily when compact map cards require fallback placement',async()=>{
  const now=Date.parse('2026-11-14T09:00:00Z'),recordedAt=new Date(now).toISOString();
  const atPixel=(x,y)=>({lat:52+(844*.6-y)/20000,lng:-.85+(x-390/2)/20000,fresh:true,sharing:true,recordedAt,updatedAt:recordedAt});
  const emily={...etaRunner(now,52,2.8),...atPixel(131,454)},supporters={graham:atPixel(132,454),jeff:atPixel(146,467),huiyan:atPixel(199,570)};
  const point={...namedPoint('point-5',5,58.667,52,-.85,'Peggottys Lounge'),...atPixel(199,570),town:'Fosters Booth'};
  const snapshot={runner:emily,runners:{emily},supporters,supporterPlans:{graham:{mode:'walking'},jeff:{mode:'meeting'},huiyan:{mode:'meeting'}}};
  for(const meetingHeight of [94,390]){
    const f=await load({mode:'supporter',width:390,height:844,followTop:280.90625,now,selected:point,points:[point],snapshot,actualPortraitHeights:true,roundedProjection:true,measuredPinHeights:{portrait:78,meeting:meetingHeight}});
    const portraits=f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon');
    assert.equal(portraits.length,4);
    for(let index=0;index<portraits.length;index++)for(const other of portraits.slice(index+1))assertSeparate(markerBox(f,portraits[index]),markerBox(f,other));
    assertPortraitAnchors(f);
    for(const marker of portraits)assert(f.coordinateDots().some(dot=>dot.point[0]===marker.point[0]&&dot.point[1]===marker.point[1]),'separating the walking pair never moves its actual coordinate dots');
    assert.match(portraits.find(marker=>marker.options.icon.html.includes('data-person="graham"')).options.icon.html,/With Emily/);
    assert.deepEqual(f.crewActions,[]);assert.deepEqual(f.checkpointActions,[]);
  }
});

test('supporter All stops includes planned pins and only the selected EV options, then returns to the next meet-up',async()=>{
  const data=JSON.parse(readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
  const points=data.groups.flatMap(group=>group.options),addedEvPointIds=[points.find(p=>p.optionalMeetup).id],planned=points.filter(p=>!p.beyondPlannedFinish&&p.routeKm<=data.planningEndKm&&(!p.optionalMeetup||addedEvPointIds.includes(p.id)));
  const f=await load({mode:'supporter',points,addedEvPointIds,planningEndKm:data.planningEndKm,statuses:Object.fromEntries(planned.slice(0,2).map(p=>[p.id,'met']))});
  f.clickMapAction('all-points');
  const pins=meetingMarkers(f);assert.equal(planned.filter(p=>!p.optionalMeetup).length,25);assert.equal(planned.filter(p=>p.optionalMeetup).length,1);assert.equal(pins.length,planned.length);
  for(const p of planned){
    const pin=pins.find(marker=>marker.point[0]===p.lat&&marker.point[1]===p.lng&&marker.options.title.startsWith(p.label));
    assert(pin,p.id+' remains visible even if passed or one of a pair');
    if(p.town)assert.match(pin.options.icon.html,new RegExp(p.town.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    const box=markerBox(f,pin),dot=f.project(pin.point);
    assert(Math.abs(box.x+box.w/2-dot.x)<1e-7,'overview label remains centred on its own actual pin');
    assert(Math.abs(box.y+box.h/2-dot.y)<1e-7);
    pin.events.click();assert.equal(f.q('#point-heading').textContent,p.town&&!p.label.toLowerCase().includes(p.town.toLowerCase())?p.label+' · '+p.town:p.label);
  }
  assert.match(f.q('#map-follow-label').textContent,/Back to meet-up/);
  assert.equal(f.q('#map-notice').hidden,true,'overview guidance does not cover the finish pins');
  assert.match(f.notifications.at(-1),/Zoom for nearby stops/);
  f.api.follow();assert(meetingMarkers(f).length<=2);assert.doesNotMatch(f.q('#map-follow-label').textContent,/Back to meet-up/);
  f.api.showFullRoute();f.changeMode('runner');assert(meetingMarkers(f).length<=1,'runner role restores its single next stop');
  f.api.showFullRoute();assert(meetingMarkers(f).length<=1,'the overview action cannot open the all-stops map for runners');
});

test('a recent cached GPS report keeps a neutral source label and its real report age during a poll error',async()=>{
  const now=Date.parse('2026-11-14T01:00:00Z'),emily={...etaRunner(now-60000,10),reportCached:true},jeff={...etaRunner(now-180000,9),reportCached:true};
  const selected={...namedPoint('point-2',2,12,52,-.84,'Village Hall'),town:'Dunchurch'};
  const f=await load({now,selected,snapshot:{runner:emily,runners:{emily,jeff},runnerTracking:{emily:{bib:'247',status:'unavailable'},jeff:{bib:'133',status:'unavailable'}}}});
  assert.match(f.q('#map-tracking-status').textContent,/Updated 1 min ago/);
  assert.doesNotMatch(f.q('#map-tracking-status').textContent,/Using|Emily|Jeff/);
  assert.match(f.q('#map-route-distance').innerHTML,/^10\.0/);
  assert.equal(f.q('#map-meet-eta').attributes['data-eta-state'],'available');
  f.api.openPerson('emily');assert.match(f.q('#person-summary').innerHTML,/10:00/);assert.match(f.q('#person-summary').innerHTML,/1 min ago|1m ago/);
  f.advanceTime(300000);f.update();assert.equal(f.q('#map-route-distance').innerHTML,'—','expired cached position no longer drives the main distance');
});

test('runners see the following distinct stop without a second meeting map card or supporter actions',async()=>{
  const points=[{...namedPoint('point-1',1,10,52,-.9,'Market Cross'),town:'Dunchurch'},{...namedPoint('point-2',2,16,52,-.8,'Village Café'),town:'Willoughby'}];
  const f=await load({points,snapshot:{room:{joined:true,canManageCheckpoints:true}}});
  assert.equal(f.q('#map-following-stop').textContent,'Then: Point 2 · Willoughby');
  assert.equal(f.q('#map-following-stop').hidden,false);
  assert.equal(meetingMarkers(f).length,1,'the runner map still shows only the next meeting card');
  f.api.openPoint(points[0]);
  assert.match(f.q('#point-detail').innerHTML,/AFTER THIS STOP/);
  assert.match(f.q('#point-detail').innerHTML,/Willoughby/);
  assert.doesNotMatch(f.q('#point-detail').innerHTML,/data-map-action="(?:complete|skip|undo)-checkpoint"/);
  f.clickMapAction('complete-checkpoint','point-1');await nextTick();
  assert.equal(f.checkpointActions.length,0,'changing the viewing role alone cannot execute supporter actions');
});

test('a connected supporter can mark, skip or undo through the shared API and sees errors honestly',async()=>{
  const points=[{...namedPoint('point-1',1,10,52,-.9,'Market Cross'),town:'Dunchurch'},{...namedPoint('point-2',2,16,52,-.8,'Village Café'),town:'Willoughby'}];
  const room={joined:true,canManageCheckpoints:true,owner:false};
  const f=await load({mode:'supporter',points,snapshot:{room,lastCheckpointAction:{pointId:'previous',action:'skip',completedAt:new Date().toISOString()}}});
  f.api.openPoint(points[0]);let html=f.q('#point-detail').innerHTML;
  assert.match(html,/Met here → Next stop/);assert.match(html,/Skip this stop/);assert.match(html,/Undo last skip/);
  assert(html.indexOf('checkpoint-complete')<html.indexOf('point-arrival'),'checkpoint action is above the longer ETA detail');
  f.clickMapAction('complete-checkpoint','point-1');await nextTick();
  f.clickMapAction('skip-checkpoint','point-1');await nextTick();
  f.clickMapAction('undo-checkpoint','previous');await nextTick();
  assert.deepEqual(f.checkpointActions,[['complete','point-1'],['skip','point-1'],['undo','previous']]);
  assert.equal(f.tabs.at(-1),'now','successful actions return to the next-stop map');
  f.clickMapAction('complete-checkpoint','point-2');await nextTick();
  assert.equal(f.checkpointActions.length,3,'a future or stale point cannot silently become the completed current stop');
  assert.match(f.notifications.at(-1),/next stop has changed/);
  const failed=await load({mode:'supporter',points,snapshot:{room},checkpointResult:{ok:false,message:'Connection interrupted. Try again.'}});
  failed.api.openPoint(points[0]);failed.clickMapAction('complete-checkpoint','point-1');await nextTick();
  assert.equal(failed.tabs.at(-1),'point','an unsaved change does not navigate away as if it succeeded');
  assert.match(failed.notifications.at(-1),/Connection interrupted/);
});

test('full-route pins distinguish shared Met and Skipped checkpoints while future details show their forecast',async()=>{
  const points=[namedPoint('point-1',1,10,52,-.9,'Market Cross'),namedPoint('point-2',2,16,52,-.8,'Village Café'),namedPoint('point-3',3,19,52,-.75,'Church Gate'),namedPoint('point-4',4,20,52,-.7,'Village Store')];
  const f=await load({mode:'supporter',points,statuses:{'point-1':{status:'met'},'point-2':{status:'skipped'}},forecast:{status:'ready',formattedTime:'05:15',rangeText:'About 05:00–05:30',note:'Based on recent route pace.'}});
  f.api.showFullRoute();const pins=meetingMarkers(f);
  assert.match(pins.find(p=>p.options.title.startsWith('Point 1')).options.title,/Met/);
  assert.match(pins.find(p=>p.options.title.startsWith('Point 2')).options.title,/Skipped/);
  assert.match(pins.find(p=>p.options.title.startsWith('Point 1')).options.icon.html,/aria-label="Met"/);
  assert.match(pins.find(p=>p.options.title.startsWith('Point 2')).options.icon.html,/aria-label="Skipped"/);
  f.api.openPoint(points[1]);assert.match(f.q('#point-detail').innerHTML,/checkpoint-stamp skipped/);
  assert.doesNotMatch(f.q('#point-detail').innerHTML,/ETA 05:00–05:30|Be ready by/,'completed stops do not show a new future arrival');
  f.api.openPoint(points[3]);
  assert.match(f.q('#point-detail').innerHTML,/<strong>ETA 05:00–05:30<\/strong>/);
  assert.doesNotMatch(f.q('#point-detail').innerHTML,/Be ready/);
});

test('bib 210 has a separate illustrated portrait at its true coordinate without changing family ETA or follow bounds',async()=>{
  const now=Date.parse('2026-11-14T02:00:00Z'),runner=etaRunner(now,10),position={lat:52.2,lng:-1.2,recordedAt:new Date(now-60000).toISOString(),fresh:true};
  const rival={name:'Matt Leese',shortName:'Matt',bib:'210',status:'live',position,crowKm:19.2};
  const selected=namedPoint('point-1',1,14,52,-.8,'Village Hall');
  const f=await load({now,selected,rival,snapshot:{runner,runners:{emily:runner,jeff:runner}}});
  const marker=f.markers().find(marker=>marker.options.icon?.className==='rival-map-icon');
  assert(marker);assert.deepEqual(marker.point,[position.lat,position.lng]);assert.match(marker.options.icon.html,/rival-cutout.*assets\/avatars-v5\/matt.webp/);assert.match(marker.options.title,/Matt Leese · #210/);
  assert.match(marker.options.icon.html,/<small class="person-update">1m ago<\/small>/);
  assert.doesNotMatch(marker.options.icon.html,/😈/,'the map uses the drawn cutout instead of an emoji');
  assert.equal(f.fitted.at(-1).some(p=>p[0]===position.lat&&p[1]===position.lng),false,'ordinary following keeps the route ahead in view');
  const distance=f.q('#map-route-distance').innerHTML,eta=f.q('#map-meet-eta').textContent;
  marker.events.click();assert.equal(f.q('#person-heading').textContent,'Matt Leese');assert.equal(f.q('#person-portrait').hidden,false);assert.equal(f.q('#person-symbol').hidden,true);
  assert.equal(f.q('#person-portrait').src,'assets/avatars-v5/matt.webp');
  assert.match(f.q('#person-summary').innerHTML,/Estimated route pace/);assert.match(f.q('#person-summary').innerHTML,/Waiting/);assert.doesNotMatch(f.q('#person-summary').innerHTML,/STRAIGHT LINE|19\.2/,'crow-flight distance is not substituted for route pace');
  for(const action of ['everyone','showMilestones','follow']){
    f.api[action]();
    assert.equal(f.fitted.at(-1).some(p=>p[0]===position.lat&&p[1]===position.lng),false,action+' keeps distant Matt out of family framing');
  }
  const fitsBeforeUpdate=f.fitted.length,viewsBeforeUpdate=f.viewed.length;
  f.updateRival({...rival,position:{...position,recordedAt:new Date(now-600000).toISOString()}});
  assert.equal(f.fitted.length,fitsBeforeUpdate,'Matt reports never trigger map fitting');
  assert.equal(f.viewed.length,viewsBeforeUpdate,'Matt reports never recenter the map');
  assert(f.markers().some(marker=>marker.options.icon?.className==='rival-map-icon stale'));
  assert.equal(f.q('#map-route-distance').innerHTML,distance);assert.equal(f.q('#map-meet-eta').textContent,eta);
  f.api.focusPerson('madlis');assert.deepEqual(f.viewed.at(-1),[position.lat,position.lng],'Matt remains available through an explicit Show on map action');
  f.updateRival({...rival,status:'unavailable',position:null,crowKm:null});
  assert.equal(f.markers().some(marker=>marker.options.icon?.className?.startsWith('rival-map-icon')),false,'missing competitor coordinates do not invent a marker');
  f.api.openPerson('emily');assert.equal(f.q('#person-symbol').hidden,true);assert.equal(f.q('#person-portrait').hidden,false);
});

function mattFixture(now,positionChanges={},snapshotChanges={}) {
  const position={...etaRunner(now,8,6),...positionChanges};
  return {name:'Matt Leese',shortName:'Matt',bib:'210',status:'live',position,
    paceMinPerKm:position.paceMinPerKm,paceSource:position.paceSource,
    paceMessage:'Recent route pace from Matt’s GPS reports, including recent stops.',...snapshotChanges};
}

test('every on-map avatar has its own visible GPS report age in both roles and compact layouts',async()=>{
  const now=Date.parse('2026-11-14T03:00:00Z');
  const emily=etaRunner(now-60000,6,6),jeff=etaRunner(now-180000,7,8);
  const huiyan={lat:52.0002,lng:-.8497,fresh:true,sharing:true,recordedAt:new Date(now-120000).toISOString(),updatedAt:new Date(now).toISOString()};
  const graham={...huiyan,lat:52.0001,lng:-.85,recordedAt:new Date(now-30000).toISOString()};
  const rival=mattFixture(now-240000);
  for(const mode of ['runner','supporter'])for(const poster of [false,true]){
    const f=await load({now,mode,poster,width:375,height:poster?220:667,rival,snapshot:{runner:emily,runners:{emily,jeff},crew:huiyan,supporters:{huiyan,graham,jeff:{...jeff,sharing:true}}}});
    for(const [person,age] of [['emily','1m ago'],['jeff','3m ago'],['huiyan','2m ago'],['graham','just now']]){
      const pin=f.markers().find(marker=>marker.options.icon?.html.includes('data-person="'+person+'"'));
      assert(pin);assert(pin.options.icon.html.includes('<small class="person-update">'+age+'</small>'));
    }
    const matt=f.markers().find(marker=>marker.options.icon?.className==='rival-map-icon');
    assert.match(matt.options.icon.html,/<small class="person-update">4m ago<\/small>/);
  }
});

test('Matt keeps his own route pace without a Jeff catch-up target after Jeff joins support',async()=>{
  const now=Date.parse('2026-11-14T03:00:00Z'),jeff=etaRunner(now,6,8),emily=etaRunner(now,7,5),rival=mattFixture(now);
  for(const mode of ['runner','supporter']){
    const f=await load({now,mode,rival,routeCoordinates:[[-1,52],[0,52]],snapshot:{runner:emily,runners:{emily,jeff},supporters:{jeff:{...jeff,sharing:true}}}});
    const pin=f.markers().find(marker=>marker.options.icon?.className==='rival-map-icon');assert.match(pin.options.icon.html,/rival-pace">10:00 \/km/);
    pin.events.click();assert.equal(f.q('#person-heading').textContent,'Matt Leese');assert.equal(f.q('#person-role').textContent,'RUNNER · #210');
    const html=f.q('#person-summary').innerHTML;assert.match(html,/10:00<small>min\/km/);assert.match(html,/including recent stops/);
    assert.doesNotMatch(html,/catch-up|Jeff|2 hours|5 hours|data-catch-up/);
    assert.equal(f.q('#person-map-action').attributes['data-map-person-focus'],'madlis');assert.deepEqual(f.externalOpens,[]);
  }
});

test('Matt’s card ignores historical Jeff pace and changes only for Matt’s feed',async()=>{
  const now=Date.parse('2026-11-14T03:00:00Z'),jeff=etaRunner(now,6,5),emily=etaRunner(now,7,12),rival=mattFixture(now);
  const f=await load({now,rival,snapshot:{runner:emily,runners:{emily,jeff}}});f.api.openPerson('madlis');
  const initial=f.q('#person-summary').innerHTML;
  for(const oldJeff of [null,{...jeff,paceSource:null},{...jeff,recordedAt:new Date(now-300000).toISOString()}]){
    f.update({runner:emily,runners:{emily,jeff:oldJeff}});assert.equal(f.q('#person-summary').innerHTML,initial);
  }
  f.updateRival(mattFixture(now,{paceMinPerKm:12,speedKmh:5}));assert.match(f.q('#person-summary').innerHTML,/12:00/);
});

test('Matt card and map withhold stale, off-route, untrusted or invalid pace and show the feed explanation',async()=>{
  const now=Date.parse('2026-11-14T03:00:00Z'),jeff=etaRunner(now,6,8);
  const f=await load({now,snapshot:{runner:jeff,runners:{jeff}}});f.api.openPerson('madlis');
  for(const changes of [
    {recordedAt:new Date(now-300000).toISOString()}, {offRouteM:500}, {offRouteM:null}, {routeKm:null},
    {paceSource:'crow-flight-average'}, {paceMinPerKm:1,speedKmh:60}, {paceMinPerKm:121,speedKmh:60/121}, {fresh:false}
  ]){
    const rival=mattFixture(now,changes,{paceMessage:'Waiting for a usable route pace from fresh GPS reports.'});
    f.updateRival(rival);
    const pin=f.markers().find(marker=>marker.options.icon?.className?.startsWith('rival-map-icon'));
    assert.match(pin.options.icon.html,/Pace pending/);
    assert.doesNotMatch(f.q('#person-summary').innerHTML,/class="catch-up-pace"|person-pace "><span[^>]*>Estimated route pace<\/span><strong>10:00/);
    assert.match(f.q('#person-summary').innerHTML,/Waiting for a usable route pace from fresh GPS reports/);
  }
});

test('café-only possible toilets appear as WC candidates but never pass the confirmed-toilet filter',async()=>{
  const cafe=toiletFixture('cafe-only',13,{name:'Little Crow Café',mapLabel:'Little Crow Café',kinds:['cafe'],possibleToilet:true,opening:toiletSchedule('venue'),access:'Ask staff; toilet provision and access are not confirmed.'});
  const publicWc=toiletFixture('public-wc',12,{opening:toiletSchedule()});
  const f=await load({now:toiletTestNow,planningEndKm:60,pois:[publicWc,cafe],toiletHours:true,snapshot:{runner:toiletReport(10)},forecast:{status:'ready',earliestArrivalTime:toiletTestNow+20*60000,arrivalTime:toiletTestNow+30*60000}});
  assert.deepEqual(visibleToiletIds(f),['public-wc','cafe-only']);
  const checks=Array.from(f.api.getVisibleToilets());assert.equal(checks.find(p=>p.id==='cafe-only').check.status,'possible');
  f.api.showAmenities('toilet');let html=f.q('#facilities-list').innerHTML;
  assert.match(html,/Little Crow Café/);assert.match(html,/WC\? · Ask staff/);assert.match(html,/Toilet provision and access have not been confirmed; ask staff/);
  f.api.setToiletFilters({opening:'confirmed'});
  assert.deepEqual(visibleToiletIds(f),['public-wc']);assert.doesNotMatch(f.q('#facilities-list').innerHTML,/Little Crow Café/);
  f.api.setToiletFilters({opening:'all'});f.api.showToiletsAhead();
  const pin=f.markers().find(marker=>marker.options.icon?.html.includes('Little Crow Café'));
  assert(pin);assert.match(pin.options.icon.html,/WC\?/);assert.doesNotMatch(pin.options.icon.html,/✓ Open at ETA/);
});

test('milestone map flags show ETA or recorded status at exact crossing pins without choosing a meet-up',async()=>{
  const now=Date.parse('2026-11-14T03:00:00Z'),runner=etaRunner(now,6,6),origin={lat:52.4379,lng:-1.6496};
  const milestonePoints=[
    {id:'marathon',label:'Marathon',basis:'route',routeKm:12,lat:52.0002,lng:-.8497,origin},
    {id:'silver',label:'Silver ring',basis:'crow',radiusKm:48.28032,routeKm:16,lat:52.0004,lng:-.8493,origin},
    {id:'gold',label:'Gold ring',basis:'crow',radiusKm:96.56064,routeKm:40,lat:52.0006,lng:-.8489,origin}
  ];
  const milestoneStatus={marathon:{text:'Both crossed ♡',completed:true},silver:{text:'1 crossed · ~04:15',completed:false},gold:{text:'ETA ~11:10',completed:false}};
  const selected=namedPoint('point-1',1,10,52,-.85,'Village Hall');
  for(const mode of ['runner','supporter']){
    const f=await load({now,mode,selected,milestonePoints,milestoneStatus,snapshot:{runner,runners:{emily:runner,jeff:runner}}});
    const planBefore=JSON.stringify(f.api.getUpcomingPoints()),distance=f.q('#map-meet-distance').innerHTML,eta=f.q('#map-meet-eta').textContent;
    const flags=()=>f.markers().filter(marker=>marker.options.icon?.className==='race-milestone-map-icon');
    assert.equal(flags().length,2,'the regular map shows milestone crossings inside its upcoming route window');
    for(const p of milestonePoints.slice(0,2)){
      const pin=flags().find(marker=>marker.options.icon.html.includes('milestone-'+p.id));
      assert(pin);assert.deepEqual(pin.point,[p.lat,p.lng]);assert.match(pin.options.icon.html,new RegExp(milestoneStatus[p.id].text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      pin.events.click();assert.equal(f.milestoneOpens.at(-1),p.id);
    }
    assert.equal(f.circles().length,2);assert.deepEqual(f.circles().map(circle=>circle.options.radius),[48280.32,96560.64]);
    for(const circle of f.circles())assert.deepEqual(circle.point,[origin.lat,origin.lng]);
    f.api.showMilestones();assert.equal(flags().length,3,'the dedicated overview includes the gold crossing beyond the next meeting');
    assert.match(f.q('#map-follow-label').textContent,/Back to meet-up/);assert.match(f.q('#map-notice').innerHTML,/Tap a flag for ETA & crossing times/);
    f.api.showMilestones('gold');assert.deepEqual(f.viewed.at(-1),[milestonePoints[2].lat,milestonePoints[2].lng]);
    assert.equal(JSON.stringify(f.api.getUpcomingPoints()),planBefore);assert.equal(f.q('#map-meet-distance').innerHTML,distance);assert.equal(f.q('#map-meet-eta').textContent,eta);
    assert.deepEqual(f.checkpointActions,[],'milestones are independent of meeting selection and completion');
    assert.deepEqual(f.crewActions,[]);assert.deepEqual(f.externalOpens,[]);
    f.api.follow();assert.equal(flags().length,2);assert.doesNotMatch(f.q('#map-follow-label').textContent,/Back to meet-up/);
  }
});

test('walking supporters appear at Emily’s fresh tracker pin without altering their phone GPS reports',async()=>{
  const now=Date.parse('2026-11-14T09:00:00Z'),recordedAt=new Date(now-120000).toISOString(),updatedAt=new Date(now).toISOString();
  const emily={...etaRunner(now,49,6),lat:52,lng:-.851};
  const supporters={
    huiyan:{lat:52.0002,lng:-.8502,fresh:true,sharing:true,recordedAt,updatedAt:recordedAt},
    graham:{lat:52.0004,lng:-.8494,fresh:true,sharing:true,recordedAt,updatedAt:recordedAt},
    jeff:{lat:52.0006,lng:-.8486,fresh:true,sharing:true,recordedAt,updatedAt:recordedAt},
    ben:{lat:52.0007,lng:-.8481,fresh:true,sharing:true,recordedAt,updatedAt:recordedAt},
  };
  const selected=namedPoint('point-next',7,55,52.0008,-.8478,'Village Hall');
  const firstPlans={huiyan:{mode:'walking',updatedAt},graham:{mode:'meeting',updatedAt},jeff:{mode:'walking',updatedAt},ben:{mode:'meeting',updatedAt}};
  const secondPlans={huiyan:{mode:'meeting',updatedAt},graham:{mode:'walking',updatedAt},jeff:{mode:'meeting',updatedAt},ben:{mode:'walking',updatedAt}};
  for(const mode of ['runner','supporter'])for(const poster of [false,true]){
    const initial={runner:emily,runners:{emily},crew:supporters.huiyan,supporters,supporterPlans:firstPlans};
    const originalReports=JSON.stringify(initial.supporters);
    const f=await load({now,mode,poster,width:390,height:844,selected,routeCoordinates:[[-1,52],[1,52]],snapshot:initial});
    const avatar=id=>f.markers().find(marker=>marker.options.icon?.className==='portrait-map-icon'&&marker.options.icon.html.includes(`data-person="${id}"`));
    for(const plans of [firstPlans,secondPlans]){
      f.update({...initial,supporterPlans:plans});
      assert.equal(f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon').length,5);
      assert(f.coordinateDots().some(dot=>dot.point[0]===emily.lat&&dot.point[1]===emily.lng),'Emily’s actual official tracker coordinate is plotted');
      for(const [id,position]of Object.entries(supporters)){
        const marker=avatar(id),walking=plans[id].mode==='walking';
        assert.deepEqual(marker.point,walking?[emily.lat,emily.lng]:[position.lat,position.lng],walking?'the supporter avatar borrows Emily’s tracker pin':'the meeting supporter keeps their independent GPS pin');
        assert.match(marker.options.icon.html,walking?/<small class="person-plan walking">With Emily<\/small>/:/<small class="person-plan meeting">Next stop<\/small>/);
        assert.match(marker.options.icon.html,walking?/Tracker · just now/:/2m ago/,'the displayed report age comes from the source of each plotted pin, not the plan timestamp');
        assert.match(marker.options.title,walking?/Emily’s official tracker location.*not .*own phone GPS/:/Site location updated/i);
        assert.match(marker.options.title,walking?/Walking with Emily/:/Meeting at next stop/);
        marker.events.click();
        assert.equal(f.q('#person-heading').textContent,id[0].toUpperCase()+id.slice(1));
        assert.equal(f.q('#person-subtitle').textContent,walking?'Walking with Emily':'Meeting at next stop');
        assert.match(f.q('#person-summary').innerHTML,walking?/not .*phone GPS/:/own phone location/);
        assert.equal(f.q('#person-map-action').hidden,false);
        assert.equal(f.controlReads.at(-1).personId,id,'each avatar opens controls for its own phone');
      }
    }
    assert.equal(JSON.stringify(initial.supporters),originalReports,'rendering plans never mutates the source position reports');
    for(const missingId of Object.keys(supporters)){
      const missing={...initial,supporterPlans:secondPlans,supporters:{...supporters,[missingId]:null}};
      f.update(missing);
      const walking=secondPlans[missingId].mode==='walking';
      if(walking){
        assert.deepEqual(avatar(missingId).point,[emily.lat,emily.lng],'a walker without phone GPS is still shown at Emily’s tracker location');
        assert.doesNotMatch(f.q('#map-waiting').innerHTML,new RegExp(`data-person="${missingId}"`));
      }else{
        assert.equal(avatar(missingId),undefined,'a meeting supporter without GPS does not inherit the tracker pin');
        assert.match(f.q('#map-waiting').innerHTML,new RegExp(`data-person="${missingId}"[^>]*data-map-person="${missingId}"`));
        assert.match(f.q('#map-waiting').innerHTML,/Awaiting location/);
      }
      assert(!f.coordinateDots().some(dot=>dot.point[0]===supporters[missingId].lat&&dot.point[1]===supporters[missingId].lng),'the missing supporter’s old dot is removed');
      f.clickPerson(missingId);
      assert.equal(f.q('#person-subtitle').textContent,walking?'Walking with Emily':'Meeting at next stop');
      assert.equal(f.q('#person-map-action').hidden,!walking,'only a walker with an available Emily tracker receives a map focus button');
      assert.equal(f.markers().filter(marker=>marker.options.icon?.className==='portrait-map-icon').length,walking?5:4);
    }
    // Expired tracker positions cannot imply that a walking supporter is
    // currently alongside Emily; fall back to their actual phone report.
    const staleEmily={...emily,recordedAt:new Date(now-600000).toISOString()};
    f.update({...initial,runners:{emily:staleEmily},runner:staleEmily,supporterPlans:firstPlans});
    assert.deepEqual(avatar('huiyan').point,[supporters.huiyan.lat,supporters.huiyan.lng]);
    assert.deepEqual(avatar('jeff').point,[supporters.jeff.lat,supporters.jeff.lng]);
    assert.doesNotMatch(avatar('huiyan').options.title,/via Emily’s official tracker/);
    f.update({...initial,runners:{emily:staleEmily},runner:staleEmily,supporterPlans:firstPlans,supporters:{...supporters,huiyan:null}});
    assert.equal(avatar('huiyan'),undefined,'no location is invented if Emily’s tracker is stale and the walker is not sharing');
    assert.match(f.q('#map-waiting').innerHTML,/data-person="huiyan"/);
    assert.deepEqual(f.crewActions,[],'opening or refreshing walking plans never starts sharing or changes phone identity');
    assert.deepEqual(f.checkpointActions,[],'walking assignments never change the agreed meeting point');
    assert.deepEqual(f.externalOpens,[]);
  }
});

test('route celebration flags remain hidden in every map view until their persisted Emily crossing exists',async()=>{
  const now=Date.parse('2026-11-14T09:00:00Z'),at=new Date(now-60000).toISOString(),origin={lat:52.4379,lng:-1.6496};
  const runner={...etaRunner(now,49,6),lat:52,lng:-.851};
  const selected=namedPoint('point-next',7,65,52.0008,-.8478,'Village Hall');
  const milestonePoints=[
    {id:'marathon',label:'Marathon',basis:'route',routeKm:42.195,lat:52.0001,lng:-.8505,origin},
    {id:'gold',label:'Gold ring',basis:'crow',radiusKm:96.56064,routeKm:105.3,lat:52.001,lng:-.845,origin},
    ...[50,60,70,80,90,100].map((km,i)=>({id:`km-${km}`,label:`${km} km`,basis:'route',thresholdKm:km,routeKm:km,lat:52.0002+i*.0001,lng:-.850+i*.0005,origin,hiddenUntilReached:true,posterId:`km-${km}`})),
  ];
  const record=(km,runnerId='emily')=>({id:`35950:${runnerId}:km-${km}`,eventId:35950,runnerId,bib:runnerId==='emily'?'247':'133',milestoneId:`km-${km}`,crossedAt:at,firstSeenBeyondAt:at,recordedAt:at,estimated:true,backfilled:false,evidence:{beforeAt:at,afterAt:at}});
  for(const mode of ['runner','supporter'])for(const poster of [false,true]){
    const base={runner,runners:{emily:runner},achievements:{eventId:35950,persisted:true,records:[]}};
    const f=await load({now,mode,poster,width:390,height:844,selected,milestonePoints,routeCoordinates:[[-1,52],[1,52]],snapshot:base});
    const routeFlags=()=>f.markers().filter(marker=>marker.options.icon?.className==='race-milestone-map-icon'&&/milestone-km-/.test(marker.options.icon.html));
    const ids=()=>routeFlags().map(marker=>/milestone-(km-\d+)/.exec(marker.options.icon.html)[1]).sort();
    const views=[()=>f.api.follow(),()=>f.api.showMilestones(),...(mode==='supporter'?[()=>f.api.showFullRoute()]:[])];
    for(const achievements of [
      {eventId:35950,persisted:true,records:[]},
      {eventId:35950,persisted:false,records:[record(50),record(60)]},
      {eventId:35950,persisted:true,records:[record(50,'jeff'),record(60,'jeff')]},
    ]){
      f.update({...base,achievements});
      for(const view of views){view();assert.deepEqual(ids(),[],'neither recent distance nor temporary/Jeff records reveal a future route celebration');}
      const viewedBefore=f.viewed.length;
      f.api.showMilestones('km-50');
      assert.equal(f.viewed.length,viewedBefore,'requesting an unreached hidden ID cannot focus or expose its crossing flag');
      assert.deepEqual(ids(),[]);
    }
    f.update({...base,achievements:{eventId:35950,persisted:true,records:[record(50),record(60),record(70,'jeff')]}});
    for(const view of views){
      view();assert.deepEqual(ids(),['km-50','km-60']);
      for(const pin of routeFlags()){
        const id=/milestone-(km-\d+)/.exec(pin.options.icon.html)[1],milestone=milestonePoints.find(point=>point.id===id);
        assert.deepEqual(pin.point,[milestone.lat,milestone.lng],'revealed flags retain the real route crossing coordinates');
        pin.events.click();assert.equal(f.milestoneOpens.at(-1),id);
      }
    }
    f.api.showMilestones();
    assert(f.markers().some(marker=>marker.options.icon?.html.includes('milestone-gold')),'ordinary gold-ring information remains available independently of future route posters');
    assert(!routeFlags().some(marker=>/milestone-km-(70|80|90|100)/.test(marker.options.icon.html)));
    assert.deepEqual(f.checkpointActions,[]);
    assert.deepEqual(f.crewActions,[]);
  }
});

test('both map layouts lead with the arrival range without a duplicate readiness line',async()=>{
  const now=Date.parse('2026-11-14T02:00:00Z'),runner=etaRunner(now,10),point=namedPoint('point-1',1,16,52,-.8,'Village Hall');
  const snapshot={runner,runners:{emily:runner,jeff:etaRunner(now+1000,12,12)}};
  const forecast={status:'ready',formattedTime:'03:00',earliestFormattedTime:'03:00',latestFormattedTime:'03:40',rangeText:'03:00–03:40',readyByText:'Be ready by 03:00',note:'The range starts at current route pace. Stops can change arrival.'};
  for(const poster of [false,true])for(const mode of ['runner','supporter']){
    const calls=[];
    const f=await load({mode,poster,now,selected:point,snapshot,forecast:options=>{calls.push(options);return forecast;}});
    assert.equal(f.q('#map-meet-eta').textContent,'ETA 03:00–03:40');
    assert.equal(f.q('#map-ready-by').hidden,true);
    assert.equal(f.q('#map-ready-by').textContent,'');
    assert.match(f.q('#map-meet-eta').attributes['aria-label'],/ETA 03:00–03:40/);
    assert.doesNotMatch(f.q('#map-meet-eta').attributes['aria-label'],/Be ready/);
    f.api.openPoint(point);
    const html=f.q('#point-detail').innerHTML;
    assert.match(html,/class="point-arrival-summary"[^>]*>ETA 03:00–03:40<\/p>/);
    assert.match(html,/<details class="point-forecast-method"><summary>How this arrival is estimated/);
    assert.match(html,/At Emily’s current pace/);
    assert.doesNotMatch(html,/Be ready/);
    calls.length=0;
    f.api.openPerson('emily');const person=f.q('#person-summary').innerHTML;
    assert.match(person,/10:00<small>min\/km/);
    assert.match(person,/ETA 03:00–03:40<\/strong>/);
    assert.match(person,/At current pace · ~03:00/);
    assert.doesNotMatch(person,/Be ready/);
    assert(calls.length>0,'the individual card requests a forecast for its arrival');
    assert(calls.every(call=>Object.keys(call.snapshot.runners).join(',')==='emily'&&call.snapshot.runner===runner),'Emily’s forecast never borrows a cached Jeff report');
    assert.doesNotMatch(html+person,/Using (?:Emily|Jeff)|selected tracker|chosen tracker/i);
  }
});

test('readiness copy stays hidden across role changes and unavailable forecasts',async()=>{
  const now=Date.parse('2026-11-14T02:00:00Z'),runner=etaRunner(now,10),point=namedPoint('point-1',1,16,52,-.8,'Village Hall');
  const snapshot={runner,runners:{emily:runner}};
  let forecast={status:'ready',earliestFormattedTime:'02:00',latestFormattedTime:'02:15',rangeText:'02:00–02:15',readyByText:'Be ready now'};
  const f=await load({mode:'supporter',now,selected:point,snapshot,forecast:()=>forecast});
  assert.equal(f.q('#map-ready-by').hidden,true);assert.equal(f.q('#map-ready-by').textContent,'');
  f.changeMode('runner');assert.equal(f.q('#map-ready-by').hidden,true);assert.equal(f.q('#map-ready-by').textContent,'');
  f.changeMode('supporter');assert.equal(f.q('#map-ready-by').hidden,true);assert.equal(f.q('#map-ready-by').textContent,'');
  forecast={status:'unavailable',note:'Waiting for a usable tracker report.',rangeText:''};f.update(snapshot);
  assert.equal(f.q('#map-ready-by').hidden,true);assert.equal(f.q('#map-ready-by').textContent,'');
  assert.equal(f.q('#map-meet-eta').textContent,'ETA · waiting for pace');
  const waiting=await load({now,selected:point,snapshot,forecast:{status:'unavailable',note:'Waiting for a usable tracker report.'}});
  assert.equal(waiting.q('#map-meet-eta').textContent,'ETA · waiting for pace','an unavailable new forecast does not silently reuse the old calculation');
  const fallback=await load({now,selected:point,snapshot});
  assert.equal(fallback.q('#map-meet-eta').attributes['data-eta-state'],'available','older layouts retain the existing ETA when the forecast module is absent');
});

test('date-aware ranges and partial forecast fields stay legible without readiness duplication',async()=>{
  const point=namedPoint('point-1',1,16,52,-.8,'Village Hall');
  for(const [forecast,label] of [
    [{status:'ready',earliestFormattedTime:'23:45',latestFormattedTime:'15 Nov 00:15',readyByText:'Be ready by 23:45'},'ETA 23:45–15 Nov 00:15'],
    [{status:'ready',earliestFormattedTime:'15 Nov 00:15',latestFormattedTime:'15 Nov 00:15'},'ETA 15 Nov 00:15'],
    [{status:'ready',formattedTime:'03:00'},'ETA 03:00'],
    [{status:'ready'},'ETA time pending']
  ]){
    const f=await load({mode:'supporter',selected:point,forecast});
    assert.equal(f.q('#map-meet-eta').textContent,label);assert.equal(f.q('#map-ready-by').textContent,'');
    assert.equal(f.q('#map-ready-by').hidden,true);
    f.api.openPoint(point);assert.doesNotMatch(f.q('#point-detail').innerHTML,/undefined|NaN|Be ready/);
  }
});

test('charger cards give supporters the runner arrival range without repeated readiness',async()=>{
  const poi={id:'daventry',name:'Osprey Bowen Square',town:'Daventry',kinds:['charger'],lat:52,lng:-.9,routeKm:44.3,routeOffsetM:98};
  const f=await load({mode:'supporter',pois:[poi],planningEndKm:106,forecast:{status:'ready',formattedTime:'12:00',rangeText:'12:00–12:30',readyByText:'Be ready by 12:00'}});
  f.api.showAmenities('charger');const html=f.q('#facilities-list').innerHTML;
  assert.match(html,/class="charger-runner-eta">Emily · ETA 12:00–12:30<\/span>/);
  assert.doesNotMatch(html,/Be ready/);
  assert.doesNotMatch(html,/Runners ~12:30/);
});

test('a previously confirmed Passed stop is distinct from Met and cannot expose completion buttons',async()=>{
  const points=[namedPoint('first',0,10,52,-.9,'MFG Coventry'),namedPoint('point-1',1,16,52,-.8,'Market Cross')];
  const f=await load({mode:'supporter',points,statuses:{first:'passed'},snapshot:{room:{joined:true,canManageCheckpoints:true}}});
  f.api.showFullRoute();const first=meetingMarkers(f).find(marker=>marker.options.title.startsWith('Point 0'));
  assert.match(first.options.icon.html,/aria-label="Passed"/);assert.doesNotMatch(first.options.title,/Met/);
  f.api.openPoint(points[0]);const html=f.q('#point-detail').innerHTML;
  assert.match(html,/checkpoint-stamp passed/);assert.match(html,/>✓ Passed</);assert.doesNotMatch(html,/data-map-action="complete-checkpoint"/);
});

test('EV list spans the remaining route, keeps route order, and can show all or meet-up options only',async()=>{
  const pois=[
    {id:'past',name:'Past charger',kinds:['charger'],lat:52,lng:-.98,routeKm:17,routeOffsetM:20,meetupPointId:'ev-past'},
    {id:'daventry',name:'Osprey Bowen Square',town:'Daventry',kinds:['charger'],lat:52,lng:-.9,routeKm:44.3,routeOffsetM:98,meetupPointId:'ev-daventry'},
    {id:'detour',name:'Charging detour',kinds:['charger'],lat:52,lng:-.85,routeKm:45,routeOffsetM:510},
    {id:'later',name:'Later on-route charger',kinds:['charger'],lat:52,lng:-.8,routeKm:96,routeOffsetM:55,meetupPointId:'ev-later'},
    {id:'beyond',name:'Beyond finish',kinds:['charger'],lat:52,lng:-.7,routeKm:110,routeOffsetM:0},
  ];
  const f=await load({mode:'supporter',pois,snapshot:{runner:{lat:52,lng:-.95,routeKm:38,fresh:true}},planningEndKm:106});
  assert.deepEqual(Array.from(f.api.getVisibleChargers(),p=>p.id),['daventry','detour','later']);
  f.api.showAmenities('charger');
  assert.match(f.q('#facilities-list').innerHTML,/Osprey Bowen Square/);
  assert.match(f.q('#facilities-list').innerHTML,/Later on-route charger/,'not limited to facilities 3km from the current meetup');
  assert.doesNotMatch(f.q('#facilities-list').innerHTML,/Past charger|Beyond finish/);
  f.api.setChargerFilters({meetupsOnly:true});
  assert.deepEqual(Array.from(f.api.getVisibleChargers(),p=>p.id),['daventry','later']);
  f.api.setChargerFilters({scope:'all',meetupsOnly:false});
  assert.deepEqual(Array.from(f.api.getVisibleChargers(),p=>p.id),['past','daventry','detour','later']);
  const noGps=await load({mode:'supporter',pois,planningEndKm:106,points:[{id:'ev-past',label:'First meetup',lat:52,lng:-.98,routeKm:17}],statuses:{'ev-past':'passed'}});
  assert.deepEqual(Array.from(noGps.api.getVisibleChargers(),p=>p.id),['daventry','detour','later'],'a confirmed passed meetup stays out of the remaining list when GPS is unavailable');
  noGps.api.setChargerFilters({scope:'all'});
  assert.equal(noGps.api.getVisibleChargers()[0].id,'past','the whole-route list still offers the historical charger');
});

test('EV map preserves exact charger pins and removes charging choices on runner mode',async()=>{
  const poi={id:'daventry',name:'Osprey Bowen Square',kinds:['charger'],lat:52.01,lng:-.9,routeKm:10,routeOffsetM:98,meetupPointId:'ev-daventry'};
  const f=await load({mode:'supporter',pois:[poi],planningEndKm:106});
  f.api.showChargers();
  const marker=f.markers().find(m=>m.options.title?.startsWith(poi.name));
  assert(marker);assert.deepEqual(marker.point,[poi.lat,poi.lng]);
  marker.events.click();assert.match(f.q('#facilities-list').innerHTML,/Osprey Bowen Square/);
  assert.equal(f.q('#charger-filters').hidden,false);
  f.changeMode('runner');
  assert.equal(f.q('#charger-filters').hidden,true);
  assert.equal(f.api.getVisibleChargers().length,0);
  assert(!f.markers().some(m=>m.options.title?.startsWith(poi.name)));
});

test('unadded EV candidates offer Add to meet-ups without changing the current destination',async()=>{
  const charger={id:'daventry',name:'Osprey Bowen Square',kinds:['charger'],lat:52,lng:-.9,routeKm:44.3,routeOffsetM:98,meetupPointId:'ev-daventry',charging:{accessHours:'Car park 05:00–23:45',connectorSummary:'CCS up to 150 kW',preferredStop:true}};
  const points=[{id:'point-3',label:'Point 3',groupNumber:3,lat:52,lng:-.9,routeKm:43.9},{id:'ev-daventry',label:'Osprey Bowen Square',groupNumber:3,lat:52,lng:-.9,routeKm:44.3,optionalMeetup:true}];
  for(const allowed of [true,false]){
    const f=await load({mode:'supporter',pois:[charger],points,planningEndKm:106,snapshot:{runner:{lat:52,lng:-.95,routeKm:38,fresh:true},room:{joined:true,owner:false,canManageCheckpoints:allowed}}});
    f.api.showAmenities('charger');
    assert.equal(f.api.getUpcomingPoints()[0].id,'point-3');
    assert.match(f.q('#facilities-list').innerHTML,/Car park 05:00–23:45/);
    assert.match(f.q('#facilities-list').innerHTML,allowed?/data-support-action="add-ev" data-point-id="ev-daventry"/:/Connect supporter phone to add/);
    assert.doesNotMatch(f.q('#facilities-list').innerHTML,/data-support-action="choose"|data-support-action="remove-ev"/,'adding is a separate action from choosing the next destination');
    assert.doesNotMatch(f.q('#facilities-list').innerHTML,/available now|free bays/i,'no invented live charger availability');
  }
});


test('added EV options offer Meet here next and removal, while the current agreement stays protected',async()=>{
  const point={id:'ev-daventry',label:'Osprey Bowen Square',groupNumber:3,lat:52,lng:-.9,routeKm:44.3,optionalMeetup:true};
  const planned={id:'point-3',label:'Point 3',groupNumber:3,lat:52,lng:-.91,routeKm:43.9};
  const charger={id:'daventry',name:'Osprey Bowen Square',kinds:['charger'],lat:point.lat,lng:point.lng,routeKm:point.routeKm,routeOffsetM:98,meetupPointId:point.id};
  const snapshot={runner:{lat:52,lng:-.95,routeKm:38,fresh:true},room:{joined:true,canManageCheckpoints:true}};
  const saved=await load({mode:'supporter',pois:[charger],points:[planned,point],selected:planned,addedEvPointIds:[point.id],planningEndKm:106,snapshot});
  saved.api.showAmenities('charger');
  const html=saved.q('#facilities-list').innerHTML;
  assert.match(html,/Added to meet-ups/);
  assert.match(html,/data-support-action="choose" data-point-id="ev-daventry"/);
  assert.match(html,/data-support-action="remove-ev" data-point-id="ev-daventry"/);
  assert.doesNotMatch(html,/data-support-action="add-ev"/);
  assert.equal(saved.api.getUpcomingPoints()[0].id,planned.id,'saved options do not replace the agreed next stop');
  const agreed=await load({mode:'supporter',pois:[charger],points:[planned,point],selected:point,planningEndKm:106,snapshot});
  agreed.api.showAmenities('charger');
  assert.match(agreed.q('#facilities-list').innerHTML,/Our agreed meet-up/);
  assert.doesNotMatch(agreed.q('#facilities-list').innerHTML,/data-support-action="add-ev"|data-support-action="remove-ev"/,'existing agreement is retained and cannot be removed in place');
});

test('legacy skipped EV alternatives stay in the directory with their completed group explained',async()=>{
  const point={id:'ev-daventry',label:'Osprey Bowen Square',groupNumber:3,lat:52,lng:-.9,routeKm:44.3,optionalMeetup:true};
  const charger={id:'daventry',name:'Osprey Bowen Square',kinds:['charger'],lat:point.lat,lng:point.lng,routeKm:point.routeKm,routeOffsetM:98,meetupPointId:point.id};
  const f=await load({mode:'supporter',pois:[charger],points:[point],statuses:{[point.id]:'skipped'},planningEndKm:106,snapshot:{runner:{lat:52,lng:-.95,routeKm:38,fresh:true},room:{joined:true,canManageCheckpoints:true}}});
  f.api.showAmenities('charger');
  assert.equal(f.api.getVisibleChargers().length,1);
  assert.match(f.q('#facilities-list').innerHTML,/This meeting group is already completed/);
  assert.doesNotMatch(f.q('#facilities-list').innerHTML,/data-support-action="add-ev"|Skipped · this meet-up/,'never offer an addition that immediately becomes unusable');
  assert.equal(f.api.getUpcomingPoints().length,0);
});

test('the supporter menu and legacy charging view use the full EV directory',async()=>{
  assert.match(guideMarkup,/data-map-action="charger-list"><span class="menu-icon">ϟ<\/span><span><strong>Charging/);
  assert.doesNotMatch(guideMarkup,/Coventry & Daventry|id="charging-stops"/);
  const f=await load({mode:'supporter'});
  f.clickMapAction('charger-list');
  assert.equal(f.tabs.at(-1),'facilities');
  assert.equal(f.q('#facilities-title').textContent,'Charge & cheer');
  f.windowEvent('viewchange',{tab:'charging'});
  assert.equal(f.tabs.at(-1),'facilities');
  assert.equal(f.q('#charger-filters').hidden,false);
});

test('map only draws individually followed competitors even with an old category-wide preference',async()=>{
  const now=Date.parse('2026-11-14T20:00:00Z');
  const freshAt=new Date(now-60000).toISOString(),oldAt=new Date(now-30*60000).toISOString();
  const competitor=(bib,name,lat,lng,updatedAt)=>({bib,name,lat,lng,updatedAt,crowKm:96,group:'Solo',ageCategory:'F'});
  const preferences={showFemaleSoloOnMap:false,followed:{'210':false,'88':true}};
  const competitors={status:'live',preferences,
    femaleSolo:[competitor('247','Emily',52,-.8,freshAt),competitor('56','Rebecca',52,-.82,freshAt),competitor('78','Old position',52,-.83,oldAt)],
    followed:[competitor('88','Followed',52,-.84,freshAt)]};
  const matt={name:'Matt',bib:'210',position:{lat:52,lng:-.79,updatedAt:freshAt,recordedAt:freshAt,fresh:true}};
  const f=await load({now,competitors,rival:matt,snapshot:{runner:{lat:52,lng:-.85,fresh:true,recordedAt:freshAt,routeKm:13}}});
  const labels=()=>f.markers().filter(m=>m.options.icon?.className?.includes('race-competitor-pin'));
  assert.deepEqual(labels().map(m=>m.options.title.split(' · ')[0]),['Followed']);
  assert(!f.markers().some(m=>m.options.icon?.className?.includes('rival-map-icon')),'Matt can be hidden without losing his follow status');
  preferences.showFemaleSoloOnMap=true;
  f.windowEvent('competitorupdate');
  assert.deepEqual(labels().map(m=>m.options.title.split(' · ')[0]),['Followed']);
  assert(!labels().some(m=>m.options.title.includes('Old position')),'old GPS cannot appear as fresh on the map');
  assert(!labels().some(m=>m.options.title.startsWith('Emily')),'Emily remains her own full-size runner pin');
  labels()[0].events.click();assert.equal(f.competitorOpens.length,1);
  assert(!f.tabs.includes('live'),'opening a competitor is separate from crew connection');
});

test('family-followed Matt stays visible at his clearly labelled last-known GPS location',async()=>{
  const now=Date.parse('2026-11-14T23:00:00Z');
  const lastSeen='2026-11-14T16:49:49.000Z';
  const competitors={status:'live',preferences:{showFemaleSoloOnMap:false,followed:{'210':true}},femaleSolo:[],
    followed:[{bib:'210',name:'Matt Leese',lat:51.896539,lng:-.535504,updatedAt:lastSeen,crowKm:96.941,group:'Solo',ageCategory:'M'}]};
  const f=await load({now,competitors});
  const markers=f.markers().filter(marker=>marker.options.icon?.className?.includes('race-competitor-pin'));
  assert.equal(markers.length,1);
  assert.equal(markers[0].point[0],51.896539);
  assert.match(markers[0].options.title,/LAST KNOWN position/);
  assert.match(markers[0].options.title,/may have moved/);
  assert(!markers[0].options.title.includes('recent moving GPS'));
});
