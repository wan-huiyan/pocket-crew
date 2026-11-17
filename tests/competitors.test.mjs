import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/competitors.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-14T20:00:00Z');
const person=(bib,name,group='Solo',ageCategory='F',crowKm=80,updatedAt=new Date(NOW-60000).toISOString())=>({bib,name,group,ageCategory,crowKm,lat:52.3,lng:-1.2,updatedAt,rank:1});
const result=()=>({metric:'crow-flight-km',status:'live',event:{active:true},checkedAt:new Date(NOW).toISOString(),femaleSolo:[person('56','Rebecca', 'Solo','F',96),person('247','Emily','Solo','F',95),person('210','Matt','Solo','M',99)],roster:[{bib:'56',name:'Rebecca',group:'Solo',ageCategory:'F'},{bib:'247',name:'Emily',group:'Solo',ageCategory:'F'},{bib:'210',name:'Matt',group:'Solo',ageCategory:'M'},{bib:'999',name:'Another',group:'Pair',ageCategory:'F'}],followed:[person('210','Matt','Solo','M',99)]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(initial=result()){
  const listeners=new Map(), requests=[],storage=new Map(),events=[],timers=[],elements=new Map();
  let answer=initial,now=NOW;
  const document={hidden:false,querySelector(selector){if(!elements.has(selector))elements.set(selector,{checked:false,innerHTML:'',textContent:'',addEventListener(){},scrollIntoView(){}});return elements.get(selector);},addEventListener(type,fn){listeners.set('doc:'+type,fn);}};
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context={Date:ClockDate,document,console,AbortController,Promise,clearTimeout,setTimeout,
    setInterval(fn,ms){timers.push({fn,ms});return timers.length;},
    CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},
    requestAnimationFrame:fn=>fn(),
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    window:{addEventListener(type,fn){listeners.set(type,fn);},dispatchEvent(evt){events.push(evt);}},
    fetch:async(path,options)=>{requests.push({path,options});return Response.json(typeof answer==='function'?answer():answer)}
  };
  vm.runInNewContext(source,context,{filename:'competitors.js'});await tick();await tick();
  return {api:context.window.competitorGuide,requests,storage,events,elements,listeners,timers,
    change(value){answer=value;},advance(ms){now+=ms;},async refresh(){await context.window.competitorGuide.refresh();},
    async visible(value){document.hidden=!value;listeners.get('doc:visibilitychange')?.();await tick();}}
}

test('default follows Matt with map visibility, but hides the 36-person category overlay',async()=>{
  const f=await setup(),snapshot=f.api.getSnapshot();
  assert.equal(snapshot.status,'live');assert.equal(snapshot.preferences.showFemaleSoloOnMap,false);
  assert.equal(f.api.isShown('210'),true);assert.equal(f.api.isFresh(snapshot.femaleSolo[0]),true);
  assert(f.requests[0].path.includes('follow=210'));
  assert.equal(f.timers[0].ms,45000);
  assert(f.events.some(evt=>evt.type==='competitorupdate'));
});

test('the broad category map overlay stays disabled while individual family follows persist',async()=>{
  const f=await setup();
  f.api.setFemaleSoloMap(true);assert.equal(f.api.getSnapshot().preferences.showFemaleSoloOnMap,false);
  assert.equal(f.api.follow('56'),true);assert.equal(f.api.isShown('56'),true);
  f.api.setShown('210',false);assert.equal(f.api.isShown('210'),false);
  assert.equal(f.api.follow('999'),true);
  assert.equal(f.api.follow('247'),false,'Emily is not a competitor to follow');
  assert.equal(f.api.follow('999'),true,'following twice is idempotent');
  f.api.unfollow('56');assert.equal(f.api.isShown('56'),false);
  assert(f.storage.get('crow-competitors-35950-v1').includes('showFemaleSoloOnMap'));
});

test('live top three get a compact podium with Emily’s own avatar and remaining female solo standings',async()=>{
  const standings=[person('56','Rebecca','Solo','F',102),person('17','Anita','Solo','F',101),person('247','Emily','Solo','F',100),person('84','Sophie','Solo','F',99)];
  standings.forEach((p,index)=>{p.rank=index+1;});
  const mock={...result(),femaleSolo:standings};
  const f=await setup(mock),podium=f.elements.get('#leaderboard-podium');
  assert.equal(podium.hidden,false);
  assert.match(podium.innerHTML,/podium-place-1/);
  assert.match(podium.innerHTML,/podium-place-2/);
  assert.match(podium.innerHTML,/podium-place-3/);
  assert.match(podium.innerHTML,/Hand-drawn crow cheering for place 1/);
  assert.match(podium.innerHTML,/Rebecca/);
  assert.match(podium.innerHTML,/Anita/);
  assert.match(podium.innerHTML,/Emily/);
  assert.match(podium.innerHTML,/class="podium-emily-art" src="assets\/avatars-v5\/emily.webp"/);
  assert.doesNotMatch(podium.innerHTML,/Hand-drawn crow cheering for place 3/);
  assert.doesNotMatch(podium.innerHTML,/Sophie/);
  assert.doesNotMatch(podium.innerHTML,/podium-sky|✳/,'no green emoji art above the podium');
  const rest=f.elements.get('#leaderboard-list');
  assert.match(rest.innerHTML,/Sophie/);
  assert.match(rest.innerHTML,/99\.0 km/);
  assert.match(rest.innerHTML,/−1\.0 km vs Emily/);
  assert.match(rest.innerHTML,/Still in race/);
  f.change({...mock,status:'wrong-event'});await f.refresh();
  assert.equal(podium.hidden,true,'a different event must not inherit the race podium');
});

test('organiser-confirmed withdrawal and finish are distinct from active or old tracker reports',async()=>{
  const standings=[person('56','Rebecca','Solo','F',105),person('17','Anita','Solo','F',102),person('247','Emily','Solo','F',99)];
  standings[0].retired=true;standings[1].finished=true;
  standings[2].updatedAt=new Date(NOW-40*60000).toISOString();
  standings.forEach((p,index)=>{p.rank=index+1;});
  const f=await setup({...result(),femaleSolo:standings});
  const podium=f.elements.get('#leaderboard-podium').innerHTML;
  assert.match(podium,/is-retired/);assert.match(podium,/Dropped out/);
  assert.match(podium,/is-finished/);assert.match(podium,/Finished/);
  assert.match(podium,/state-unconfirmed/);assert.match(podium,/Still entered/);
  assert.doesNotMatch(podium,/● Still in race/,'old GPS must not assert someone is still moving');
  assert.doesNotMatch(f.elements.get('#leaderboard-summary').innerHTML,/Next still-entered ahead:/,'retired and finished entrants are not chase targets');
  assert.match(f.elements.get('#competitor-followed').innerHTML,/Still in race/,'recently reporting Matt remains a separate family follow');
});

test('both map variants keep the leaderboard and a quiet map with bottom re-centre and all-stops shortcuts',()=>{
  const main=readFileSync(new URL('../guide/index.html',import.meta.url),'utf8');
  const poster=readFileSync(new URL('../guide/poster-home.html',import.meta.url),'utf8');
  assert.match(main,/<h1 id="leaderboard-title">“We are not competitive”<\/h1>/);
  assert.match(main,/id="leaderboard-podium"/);
  assert.doesNotMatch(main,/id="leaderboard-map-toggle"/);
  assert.doesNotMatch(main,/class="crow-map-legend"/);
  assert.match(main,/id="leaderboard-list"/);
  for(const html of [main,poster]){
    assert.doesNotMatch(html,/class="map-competitor-bar"/);
    assert.doesNotMatch(html,/id="map-female-solo-toggle"/);
    assert.match(html,/id="map-tracking-status"[^>]+ hidden>/);
    assert.match(html,/class="dock-leaderboard"[^>]+data-tab-target="leaderboard"/);
    assert.match(html,/data-tab-target="leaderboard" aria-label="“We are not competitive”"/);
    assert.doesNotMatch(html,/id="map-crew-edge"|see everyone/i);
    assert.match(html,/<div class="map-follow-row"[^>]*><button id="map-follow"[^>]*>.*?<button id="map-all-stops"[^>]*data-map-action="all-points"/s);
    assert.doesNotMatch(html,/<nav class="runner-dock"[^>]*>.*?data-map-action="everyone".*?<\/nav>/s);
    assert.doesNotMatch(html,/<div class="dock-buttons">.*?data-map-action="all-points".*?<\/div>/s);
  }
});

test('silent for more than an hour means likely out, not a confirmed dropout, and no longer an active chase target',async()=>{
  const emily=person('247','Emily','Solo','F',91);
  emily.rank=3;
  const silent=person('56','Rebecca','Solo','F',99,new Date(NOW-61*60000).toISOString());
  silent.rank=1;
  const moving=person('17','Anita','Solo','F',95,new Date(NOW-2*60000).toISOString());
  moving.rank=2;
  const other=person('84','Sophie','Solo','F',86,new Date(NOW-60*60000).toISOString());
  other.rank=4;
  const f=await setup({...result(),femaleSolo:[silent,moving,emily,other]});
  const podium=f.elements.get('#leaderboard-podium').innerHTML;
  assert.match(podium,/is-presumed-out/);
  assert.match(podium,/Likely out/);
  assert.match(podium,/No GPS for over one hour/);
  assert.doesNotMatch(podium,/⛔ Dropped out/);
  assert.match(f.elements.get('#leaderboard-summary').innerHTML,/Next possible rival ahead: Anita/);
  assert.doesNotMatch(f.elements.get('#leaderboard-summary').innerHTML,/Next possible rival ahead: Rebecca/);
  assert.match(f.elements.get('#leaderboard-list').innerHTML,/Still entered/,'exactly 60 minutes without GPS is still unconfirmed');
});

test('no false fresh markers on old reports, and tracker outage retains original sample time',async()=>{
  const f=await setup();const original=f.api.getSnapshot().femaleSolo[0].updatedAt;
  f.advance(6*60000);assert.equal(f.api.isFresh(f.api.getSnapshot().femaleSolo[0]),false);
  f.change({status:'unavailable',metric:'crow-flight-km',event:{active:true}});await f.refresh();
  assert.equal(f.api.getSnapshot().status,'unavailable');
  assert.equal(f.api.getSnapshot().femaleSolo[0].updatedAt,original);
  f.change({...result(),status:'wrong-event'});await f.refresh();
  assert.equal(f.api.getSnapshot().femaleSolo.length,0,'wrong event must clear historical race data');
});

test('recent GPS movement pace appears only for active standings and followed map crows',async()=>{
  const fresh=person('56','Rebecca','Solo','F',104);
  Object.assign(fresh,{paceMinPerKm:8.25,paceAsOf:fresh.updatedAt,rank:1});
  const emily=person('247','Emily','Solo','F',103);
  Object.assign(emily,{paceMinPerKm:7.5,paceAsOf:emily.updatedAt,rank:2});
  const old=person('77','Sophie','Solo','F',90,new Date(NOW-2*3600000).toISOString());
  Object.assign(old,{paceMinPerKm:6.1,paceAsOf:old.updatedAt,rank:4});
  const matt=person('210','Matt','Solo','M',100);
  Object.assign(matt,{paceMinPerKm:9,paceAsOf:matt.updatedAt});
  const f=await setup({...result(),femaleSolo:[fresh,emily,person('18','Anita','Solo','F',95),old],followed:[matt]});
  const podium=f.elements.get('#leaderboard-podium').innerHTML;
  assert.match(podium,/~8:15\/km/);assert.match(podium,/~7:30\/km/);
  assert.match(f.elements.get('#competitor-followed').innerHTML,/~9:00\/km/);
  assert.match(f.api.mapCrowMarker(matt).html,/crow-pace/);
  assert.match(f.api.mapCrowMarker(matt).html,/~9:00\/km/);
  assert.doesNotMatch(f.elements.get('#leaderboard-list').innerHTML,/~6:06\/km/);
  assert.match(f.api.mapCrowMarker(old).html,/crow-stale/);
  assert.match(f.api.mapCrowMarker(old).html,/Last seen 2h ago/);
  assert.match(f.elements.get('#competitor-followed').innerHTML,/data-competitor-locate="210"/);
});

test('colourful podium artwork persists for old and officially retired positions, with reduced-motion safe animation',async()=>{
  const sheet=readFileSync(new URL('../public/competitors.css',import.meta.url),'utf8');
  assert.match(sheet,/\.leaderboard-podium:not\(\[hidden\]\) \.podium-emily-art/);
  assert.match(sheet,/@keyframes emily-podium-victory/);
  assert.match(sheet,/@media\(prefers-reduced-motion:no-preference\)/);
  assert.doesNotMatch(sheet,/\.podium-card\.is-presumed-out \.podium-crow-art[^\n]*grayscale/);
  assert.doesNotMatch(sheet,/\.podium-card\.is-retired \.podium-crow-art[^\n]*grayscale/);
  assert.match(sheet,/\.podium-place-1 \.podium-step\{height:200px;min-height:200px/);
  assert.match(sheet,/\.podium-step\{[^\n]*height:157px;min-height:157px/);
});

test('switch category, then toggle Emily amongst everyone, without adding a crowd to the map',async()=>{
  const raw=[person('301','Chained friends','Chained','',110),person('407','Pair runners','Pair','',108),
    person('210','Matt','Solo','M',107),person('56','Rebecca','Solo','F',105),person('247','Emily','Solo','F',104),person('408','Alan','Solo','M',103)];
  const allCompetitors=raw.map((p,i)=>{
    const {lat,lng,...safe}=p;
    return {...safe,rank:i+1,hasValidLocation:true};
  });
  const femaleSolo=[raw[3],raw[4]].map((p,i)=>({...p,rank:i+1}));
  const f=await setup({...result(),femaleSolo,allCompetitors});
  assert.equal(f.api.getSnapshot().preferences.leaderboardCategory,'female-solo');
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Rebecca/);
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Emily/);
  assert.equal(f.api.setLeaderboardCategory('male-solo'),true);
  assert.equal(f.api.getSnapshot().preferences.compareOverall,false);
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Matt/);
  assert.doesNotMatch(f.elements.get('#leaderboard-podium').innerHTML,/Emily/);
  assert.match(f.elements.get('#leaderboard-summary').innerHTML,/Male solo/);
  assert.match(f.requests.at(-1).path,/category=male-solo/);
  f.api.setLeaderboardCategory('pair');
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Pair runners/);
  f.api.setLeaderboardCategory('chained');
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Chained friends/);
  f.api.setCompareOverall(true);
  assert.match(f.elements.get('#leaderboard-emily-overall').innerHTML,/#5 of 6/);
  assert.match(f.elements.get('#leaderboard-emily-overall').innerHTML,/Unofficial comparison/);
  assert.match(f.elements.get('#leaderboard-list').innerHTML,/Emily/);
  assert.match(f.elements.get('#leaderboard-list').innerHTML,/Female solo/);
  assert.equal(f.elements.get('#leaderboard-overall').checked,true);
  await tick();await tick();
  assert.match(f.requests.at(-1).path,/category=all/);
  assert.equal(f.api.isShown('210'),true,'only Matt and other family picks remain on map');
  assert.equal(Object.keys(f.api.getSnapshot().preferences.followed).length,1);
  assert(f.api.getSnapshot().allCompetitors.every(p=>!Object.hasOwn(p,'lat')));
  f.api.setCompareOverall(false);
  assert.match(f.elements.get('#leaderboard-podium').innerHTML,/Chained friends/,'toggle remembers the selected category');
});

test('client only accepts official Solo/F rows; race comparison never requests phone GPS or pace data',async()=>{
  const f=await setup();assert.equal(f.api.getSnapshot().femaleSolo.some(p=>p.bib==='210'),false);
  assert(f.requests.every(({path,options})=>path.startsWith('/api/leaderboard?follow=')&&options.cache==='no-store'));
  assert.equal(typeof f.api.getSnapshot().femaleSolo[0].speedKmh,'undefined');
  await f.visible(false);const calls=f.requests.length;await f.refresh();assert.equal(f.requests.length,calls);
});

test('map crows express category position and family follows with distinct emotions and colour classes',async()=>{
  const f=await setup();
  const ahead=f.api.mapCrowMarker(f.api.getSnapshot().femaleSolo[0]);
  const behind=f.api.mapCrowMarker(person('67','Another female','Solo','F',90));
  const other=f.api.mapCrowMarker(person('999','Pair','Pair','F',104));
  const family=f.api.mapCrowMarker(f.api.getSnapshot().followed[0]);
  assert.equal(ahead.type,'ahead');assert.equal(behind.type,'behind');
  assert.equal(other.type,'other');assert.equal(family.type,'followed');
  for(const marker of [ahead,behind,other,family]){
    assert.match(marker.html,/<svg viewBox="0 0 58 57" class="crow-doodle"/);
    assert.match(marker.html,/crow-feathers/);
    assert.match(marker.html,/crow-bib/);
  }
  assert.notEqual(ahead.html,behind.html);
  assert.match(family.html,/crow-wink/);
  f.api.follow('56');
  assert.equal(f.api.mapType(f.api.getSnapshot().femaleSolo[0]),'followed','the family highlight overrides race-relative colour');
  f.advance(7*60000);
  assert.equal(f.api.mapType(person('123','A fresh rival','Solo','F',100,new Date(NOW+6*60000).toISOString())),'alongside','old Emily data cannot assert a relative ranking');
});
