import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/race-moments.js',import.meta.url),'utf8');
const milestoneSource=readFileSync(new URL('../public/race-milestones.js',import.meta.url),'utf8');
const NOW=Date.parse('2026-11-14T03:00:00Z');
const at=offset=>new Date(NOW+offset).toISOString();
const record=(runnerId='emily',milestoneId='silver',changes={})=>({
  id:`35950:${runnerId}:${milestoneId}`,eventId:35950,runnerId,bib:runnerId==='emily'?'247':'133',milestoneId,
  crossedAt:at(60000),firstSeenBeyondAt:at(90000),recordedAt:at(100000),estimated:true,backfilled:false,
  evidence:{beforeAt:at(30000),afterAt:at(90000)},...changes
});
const snapshot=(records=[],persisted=true,extra={})=>({achievements:{eventId:35950,records,persisted},runners:{emily:{id:'emily'},jeff:{id:'jeff'}},...extra});
const points=[
  {id:'marathon',label:'Marathon',basis:'route',thresholdKm:42.195,posterId:'marathon',routeKm:42.195,crowKm:39.2,lat:52,lng:-1},
  {id:'silver',label:'Silver ring',basis:'crow',routeKm:58,crowKm:48.28032,lat:51.9,lng:-.8},
  {id:'gold',label:'Gold ring',basis:'crow',routeKm:110,crowKm:96.56064,lat:51.8,lng:-.5},
  ...[50,60,70,80,90,100].map(km=>({id:'km-'+km,label:km+' km',basis:'route',thresholdKm:km,routeKm:km,crowKm:km*.85,hiddenUntilReached:true,posterId:'km-'+km,lat:51.8,lng:-.5}))
];

function load({initial=snapshot(),storage=new Map(),hidden=false,blocked=false,dialog=false,forecast=null,mode='runner'}={}){
  let now=NOW,current=initial,currentBlocked=blocked,currentDialog=dialog,nextTimer=1;
  const elements=new Map(),events=new Map(),docEvents=new Map(),timeouts=new Map(),intervals=[],tabs=[],forecastCalls=[],forbidden=[];
  const element=()=>({hidden:true,innerHTML:'',textContent:'',events:new Map(),
    addEventListener(type,handler){this.events.set(type,[...(this.events.get(type)||[]),handler]);},
    click(){for(const handler of this.events.get('click')||[])handler();},querySelector(){return null;}});
  const q=selector=>{if(selector==='dialog[open]')return currentDialog?{}:null;if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const prohibited=name=>(...args)=>{forbidden.push({name,args});throw new Error('Unexpected '+name);};
  const context={
    state:{mode},
    Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
    setTimeout(callback,delay){const id=nextTimer++;timeouts.set(id,{callback,at:now+delay});return id;},
    clearTimeout(id){timeouts.delete(id);},setInterval(callback,delay){intervals.push({callback,delay});return intervals.length;},
    document:{hidden,querySelector:q,addEventListener(type,handler){docEvents.set(type,[...(docEvents.get(type)||[]),handler]);}},
    stops:points.filter(point=>point.id!=='silver'),
    posterPath(stop){return current.releases?.some(release=>release.id===stop.id)?'assets/surprises/opaque-'+stop.id+'.webp':'';},
    currentTab:'now',switchTab(tab){tabs.push(tab);context.currentTab=tab;},
    fetch:prohibited('fetch'),
    window:{
      localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
      addEventListener(type,handler){events.set(type,[...(events.get(type)||[]),handler]);},
      guideIntro:{isBlocking:()=>currentBlocked},
      raceMap:{getMilestones:()=>points},
      liveGuide:{getSnapshot:()=>current,releaseCelebration:prohibited('releaseCelebration'),selectCheckpoint:prohibited('selectCheckpoint'),completeCheckpoint:prohibited('completeCheckpoint')},
      supportGuide:{setSharedMeetup:prohibited('setSharedMeetup'),choose:prohibited('choose')},
      meetingForecast:{estimate(input){forecastCalls.push(input);return typeof forecast==='function'?forecast(input):forecast||{status:'ready',formattedTime:'04:15',rangeText:'04:00–04:30'};}}
    }
  };
  vm.runInNewContext(milestoneSource,context,{filename:'race-milestones.js'});
  vm.runInNewContext(source,context,{filename:'race-moments.js'});
  const emit=()=>{for(const handler of events.get('liveupdate')||[])handler({detail:current});};
  const tick=()=>{for(const interval of intervals)interval.callback();};
  return {api:context.window.raceMoments,q,storage,tabs,forecastCalls,forbidden,
    update(value){current=value;emit();},advance(ms){now+=ms;},tick,
    visible(value){context.document.hidden=!value;for(const handler of docEvents.get('visibilitychange')||[])handler();},
    block(value){currentBlocked=value;},dialog(value){currentDialog=value;},
    runDueTimers(){for(const [id,timer] of [...timeouts])if(timer.at<=now){timeouts.delete(id);timer.callback();}},
    now:()=>now
  };
}

test('history shows estimated brackets and distinguishes unknown crossing time from first seen beyond',()=>{
  const estimated=record('emily','marathon',{crossedAt:at(-60000),firstSeenBeyondAt:at(-30000),backfilled:true,evidence:{beforeAt:at(-90000),afterAt:at(-30000)}});
  const unknown=record('jeff','marathon',{crossedAt:null,firstSeenBeyondAt:at(-1800000),backfilled:true,evidence:{beforeAt:null,afterAt:at(-1800000)}});
  const f=load({initial:snapshot([estimated,unknown])});f.api.open('marathon');
  assert.equal(f.api.recordText(estimated),'~02:59 crossed');
  assert.equal(f.api.recordText(unknown),'Beyond by 02:30');
  const html=f.q('#race-milestone-list').innerHTML;
  assert.match(html,/GPS bracket 02:58–02:59\. Estimated crossing time/);
  assert.match(html,/crossing time is unknown/);assert.match(html,/Beyond by 02:30/);
  assert.doesNotMatch(html,/>02:30 crossed/);
  assert.match(html,/42\.195 km along the route/);assert.match(html,/30 miles from Meriden/);assert.match(html,/60 miles from Meriden/);
  assert.match(html,/On foot · planned route: <strong>~42\.2 km<\/strong>/);
  assert.match(html,/As the crow flies from Meriden: <strong>~39\.2 km<\/strong>/);
  assert.match(html,/On foot · planned route: <strong>~58\.0 km<\/strong>/);
  assert.match(html,/As the crow flies from Meriden: <strong>~48\.3 km<\/strong>/);
  assert.deepEqual(f.tabs,['milestones']);assert.equal(f.q('#race-moment-toast').hidden,true);assert.deepEqual(f.forbidden,[]);
});

test('milestone presentation forecasts only runners who have not crossed and completes only when both are recorded',()=>{
  const f=load(),crossed=record('emily','marathon');f.forecastCalls.length=0;
  const next=f.api.presentation(points[0],snapshot([crossed]),NOW+120000);
  assert.equal(next.text,'1 crossed · ETA 04:00–04:30');assert.equal(next.completed,false);
  assert.deepEqual(Object.keys(f.forecastCalls.at(-1).snapshot.runners),['jeff']);
  const complete=f.api.presentation(points[0],snapshot([crossed,record('jeff','marathon')]),NOW+120000);
  assert.equal(complete.text,'Both crossed ♡');assert.equal(complete.completed,true);
  const waiting=load({forecast:{status:'unavailable'}}).api.presentation(points[0],snapshot([crossed]),NOW+120000);
  assert.equal(waiting.text,'1 crossed · 1 to come');
});

test('upcoming milestone map labels and rows lead with the full ETA range in either role',()=>{
  const initial=snapshot([],true,{runners:{emily:{id:'emily'}}});
  const forecast={status:'ready',formattedTime:'12:00',earliestFormattedTime:'12:00',latestFormattedTime:'12:30',rangeText:'12:00–12:30',readyByText:'Be ready by 12:00'};
  for(const mode of ['runner','supporter']){
    const f=load({mode,initial,forecast});
    assert.equal(f.api.presentation(points[1],initial,NOW).text,'ETA 12:00–12:30');
    const html=f.q('#race-milestone-list').innerHTML;
    assert.match(html,/<span>ETA 12:00–12:30<\/span>/);
    assert.doesNotMatch(html,/Be ready/);
    assert.doesNotMatch(html,/race-milestone-km-|data-poster|data-replay-cheer/,'ETA changes do not expose future distance posters');
  }
});

test('milestone ranges retain UK dates without redundant readiness copy',()=>{
  const initial=snapshot([],true,{runners:{emily:{id:'emily'}}});
  for(const [forecast,text] of [
    [{status:'ready',earliestFormattedTime:'23:45',latestFormattedTime:'15 Nov 00:15',readyByText:'Be ready now'},'ETA 23:45–15 Nov 00:15'],
    [{status:'ready',earliestFormattedTime:'15 Nov 00:15',latestFormattedTime:'15 Nov 00:15'},'ETA 15 Nov 00:15'],
    [{status:'ready',formattedTime:'04:00'},'ETA 04:00'],
    [{status:'ready'},'ETA time pending'],
    [{status:'unavailable'},'ETA · waiting for pace']
  ]){
    const f=load({initial,mode:'supporter',forecast});
    assert.equal(f.api.presentation(points[1],initial,NOW).text,text);
    const html=f.q('#race-milestone-list').innerHTML;assert.doesNotMatch(html,/undefined|NaN/);
    assert.doesNotMatch(html,/Be ready/);
  }
});

test('eligible celebrations require a new recent crossing during this visit, never backfills or old records',()=>{
  const f=load(),now=NOW+120000,r=record();
  assert.equal(f.api.eligible(r,{now,startedAt:NOW,seen:new Set()}),true);
  for(const [value,options] of [
    [{...r,backfilled:true},{}],
    [{...r,crossedAt:at(-1000)},{}],
    [{...r,crossedAt:at(151000)},{}],
    [{...r,crossedAt:at(-300000)},{startedAt:NOW-600000}],
    [r,{seen:new Set([r.id])}]
  ])assert.equal(f.api.eligible(value,{now,startedAt:NOW,seen:new Set(),...options}),false);
});

test('Emily alone completes upcoming milestones while Jeff’s earlier crossings stay in history',()=>{
  const solo=(history=[])=>snapshot(history,true,{runners:{emily:{id:'emily'}},supporters:{jeff:{lat:52,lng:-1}}});
  const oldJeff=record('jeff','silver',{crossedAt:at(-60000),backfilled:true});
  const f=load({initial:solo([oldJeff])});
  f.forecastCalls.length=0;
  const waiting=f.api.presentation(points[1],solo([oldJeff]),NOW);
  assert.equal(waiting.completed,false);
  assert.equal(waiting.text,'ETA 04:00–04:30');
  assert.deepEqual(Object.keys(f.forecastCalls.at(-1).snapshot.runners),['emily']);
  f.advance(120000);f.update(solo([oldJeff,record()]));
  const crossed=f.api.presentation(points[1],solo([oldJeff,record()]),NOW+120000);
  assert.equal(crossed.completed,true);assert.equal(crossed.text,'Emily crossed ♡');
  assert.equal(f.q('#race-moment-toast-title').textContent,'Emily · Silver ring!');
  const html=f.q('#race-milestone-list').innerHTML;
  assert.equal((html.match(/<strong>Jeff<\/strong>/g)||[]).length,1,'Jeff only appears where a real earlier crossing exists');
  assert.match(html,/~02:59 crossed/);
  assert.deepEqual(f.forbidden,[]);
});

test('new saved crossings celebrate once, group both runners and survive reload as history only',()=>{
  const f=load();f.advance(120000);const history=[record(),record('jeff')];f.update(snapshot(history));
  assert.equal(f.q('#race-moment-toast').hidden,false);assert.equal(f.q('#race-moment-toast-title').textContent,'Emily & Jeff · Silver ring!');
  assert.match(f.q('#race-moment-toast-copy').textContent,/Crossing recorded/);
  f.q('#race-moment-toast-close').click();assert.equal(f.q('#race-moment-toast').hidden,true);
  f.update(snapshot(history));f.tick();assert.equal(f.q('#race-moment-toast').hidden,true,'repeated polls do not replay a crossing');
  const reloaded=load({initial:snapshot(history),storage:f.storage});reloaded.tick();
  assert.equal(reloaded.q('#race-moment-toast').hidden,true,'opening another visit does not replay remembered celebrations');
  assert.match(reloaded.q('#race-milestone-list').innerHTML,/~03:01 crossed/);
  assert.deepEqual(f.forbidden,[]);assert.deepEqual(reloaded.forbidden,[]);
});

test('an initial history never bursts into celebration even with fresh records and empty device storage',()=>{
  const initial=snapshot([record('emily','silver',{crossedAt:at(0),firstSeenBeyondAt:at(0)})]);
  const f=load({initial});f.tick();assert.equal(f.q('#race-moment-toast').hidden,true);
  f.update(initial);assert.equal(f.q('#race-moment-toast').hidden,true);
  assert.match(f.q('#race-milestone-list').innerHTML,/~03:00 crossed/);
});

test('pending crossings are visible with a retry note but celebrate only after shared persistence succeeds',()=>{
  const f=load();f.advance(120000);const history=[record()];f.update(snapshot(history,false));
  assert.equal(f.q('#race-moment-toast').hidden,true);assert.match(f.q('#race-milestone-list').innerHTML,/Retrying the shared record/);
  f.update(snapshot(history,true));assert.equal(f.q('#race-moment-toast').hidden,false);
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/Retrying the shared record/);
});

test('background, intro and open dialog defer a new celebration, then discard it once stale',()=>{
  for(const blocker of ['background','intro','dialog']){
    const f=load();f.advance(120000);
    if(blocker==='background')f.visible(false);else if(blocker==='intro')f.block(true);else f.dialog(true);
    f.update(snapshot([record()]));assert.equal(f.q('#race-moment-toast').hidden,true);
    f.advance(300001);
    if(blocker==='background')f.visible(true);else if(blocker==='intro')f.block(false);else f.dialog(false);
    f.tick();assert.equal(f.q('#race-moment-toast').hidden,true,blocker+' does not replay an old celebration');
  }
  const f=load({blocked:true});f.advance(120000);f.update(snapshot([record()]));f.block(false);f.tick();
  assert.equal(f.q('#race-moment-toast').hidden,false,'a current deferred crossing may play when the intro finishes');
});

test('backfilled and unknown-time records remain quiet and cannot release hidden posters or alter the meeting plan',()=>{
  const secretRelease={id:'gold-poster',releasedAt:at(0)};
  const f=load({initial:snapshot([],true,{releases:[secretRelease],meetup:{id:'point-7'}})});f.advance(120000);
  const history=[record('emily','marathon',{backfilled:true}),record('jeff','silver',{crossedAt:null,backfilled:true,evidence:{beforeAt:null,afterAt:at(90000)}})];
  f.update(snapshot(history,true,{releases:[secretRelease],meetup:{id:'point-7'}}));f.tick();f.api.open('silver');
  assert.equal(f.q('#race-moment-toast').hidden,true);assert.deepEqual(f.forbidden,[]);
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/gold-poster|surprise|release/i);
  assert.deepEqual(f.tabs,['milestones']);
});


test('future distance moments do not appear or forecast until Emily has a persisted crossing',()=>{
  const f=load({initial:snapshot([],true,{runners:{emily:{id:'emily'}}})});
  const html=f.q('#race-milestone-list').innerHTML;
  for(const km of [50,60,70,80,90,100])assert.doesNotMatch(html,new RegExp('race-milestone-km-'+km));
  assert.equal(f.forecastCalls.some(call=>call.point.id.startsWith('km-')),false);
  f.api.open('km-50');
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/race-milestone-km-50/);
  f.update(snapshot([record('jeff','km-50')],true,{runners:{emily:{id:'emily'}}}));
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/race-milestone-km-50/,'Jeff is support crew and cannot unlock Emily’s milestones');
  f.update(snapshot([record('emily','km-50')],false,{runners:{emily:{id:'emily'}}}));
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/race-milestone-km-50/,'unpersisted calculations are not an earned public record');
  f.update(snapshot([record('emily','km-50')],true,{runners:{emily:{id:'emily'}}}));
  assert.match(f.q('#race-milestone-list').innerHTML,/race-milestone-km-50/);
  assert.match(f.q('#race-milestone-list').innerHTML,/50 km along the route/);
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/race-milestone-km-60/);
});

test('a reached distance records the true crossing time and exposes a poster only after shared release',()=>{
  const milestone=record('emily','km-60',{crossedAt:at(-1800000),firstSeenBeyondAt:at(-1770000),backfilled:true,evidence:{beforeAt:at(-1830000),afterAt:at(-1770000)}});
  const solo={runners:{emily:{id:'emily'}}};
  const f=load({initial:snapshot([milestone],true,solo)});
  assert.match(f.q('#race-milestone-list').innerHTML,/~02:30 crossed/);
  assert.doesNotMatch(f.q('#race-milestone-list').innerHTML,/data-poster=|data-replay-cheer=/);
  const released={...solo,releases:[{id:'km-60',releasedAt:at(0)}]};
  f.update(snapshot([milestone],true,released));
  const html=f.q('#race-milestone-list').innerHTML;
  assert.match(html,/~02:30 crossed/,'sharing at03:00 never becomes the crossing time');
  assert.match(html,/data-poster="km-60"/);assert.match(html,/data-replay-cheer="km-60"/);
  assert.match(html,/assets\/surprises\/opaque-km-60\.webp/);
  assert.equal(f.q('#race-moment-toast').hidden,true);assert.deepEqual(f.forbidden,[]);
});

test('late viewers see each saved distance and its poster without duplicated race toasts',()=>{
  const history=[50,60,70,80,90,100].map(km=>record('emily','km-'+km,{crossedAt:null,firstSeenBeyondAt:at(-60000),backfilled:true,evidence:{beforeAt:null,afterAt:at(-60000)}}));
  const releases=history.map(item=>({id:item.milestoneId,releasedAt:at(0)}));
  const f=load({initial:snapshot(history,true,{runners:{emily:{id:'emily'}},releases,room:{expired:true}})});
  const html=f.q('#race-milestone-list').innerHTML;
  for(const km of [50,60,70,80,90,100]){
    assert.match(html,new RegExp('race-milestone-km-'+km));
    assert.match(html,new RegExp('data-replay-cheer="km-'+km+'"'));
    assert.match(html,new RegExp(km+' km along the route'));
  }
  assert.match(html,/Beyond by 02:59/);assert.match(html,/crossing time is unknown/);
  assert.equal(f.q('#race-moment-toast').hidden,true);assert.deepEqual(f.forbidden,[]);
});

test('fresh poster milestones use the full poster celebration rather than a duplicate generic toast',()=>{
  const f=load({initial:snapshot([],true,{runners:{emily:{id:'emily'}}})});f.advance(120000);
  const history=[record('emily','marathon'),record('jeff','marathon'),record('emily','km-50'),record('emily','gold')];
  f.update(snapshot(history,true,{runners:{emily:{id:'emily'}},releases:history.map(item=>({id:item.milestoneId,releasedAt:at(120000)}))}));
  assert.equal(f.q('#race-moment-toast').hidden,true);f.tick();assert.equal(f.q('#race-moment-toast').hidden,true);
  assert.match(f.q('#race-milestone-list').innerHTML,/data-replay-cheer="marathon"/);
  assert.match(f.q('#race-milestone-list').innerHTML,/data-replay-cheer="km-50"/);
  assert.match(f.q('#race-milestone-list').innerHTML,/data-replay-cheer="gold"/);
  assert.deepEqual(f.forbidden,[]);
});


test('both marathon crossing records stay with one released poster for anonymous viewers',()=>{
  const emily=record('emily','marathon',{crossedAt:at(-120000),firstSeenBeyondAt:at(-90000),backfilled:true});
  const jeff=record('jeff','marathon',{crossedAt:at(-60000),firstSeenBeyondAt:at(-30000),backfilled:true});
  const f=load({initial:snapshot([emily,jeff],true,{runners:{emily:{id:'emily'}},releases:[{id:'marathon',releasedAt:at(0)}],room:{owner:false,expired:true}})});
  const html=f.q('#race-milestone-list').innerHTML;
  const card=html.match(/<article id="race-milestone-marathon"[\s\S]*?<\/article>/)?.[0];
  assert(card);
  assert.match(card,/<strong>Emily<\/strong>/);assert.match(card,/<strong>Jeff<\/strong>/);
  assert.match(card,/~02:58 crossed/);assert.match(card,/~02:59 crossed/);
  assert.equal((card.match(/data-replay-cheer="marathon"/g)||[]).length,1);
  assert.equal((card.match(/<img[^>]+src="assets\/surprises\/opaque-marathon\.webp"/g)||[]).length,1);
  assert.match(card,/42\.195 km along the route/);
  assert.equal(f.q('#race-moment-toast').hidden,true);
  assert.deepEqual(f.forbidden,[]);
});

test('the marathon boundary remains public before release, with no poster hints or replay',()=>{
  const f=load({initial:snapshot([],true,{runners:{emily:{id:'emily'}}})});
  f.api.open('marathon');
  const html=f.q('#race-milestone-list').innerHTML;
  assert.match(html,/race-milestone-marathon/);assert.match(html,/42\.195 km along the route/);
  assert.doesNotMatch(html,/data-poster=|data-replay-cheer=|assets\/surprises\//);
  assert.deepEqual(f.tabs,['milestones']);
});

test('the combined page puts the newest earned moments before upcoming boundaries and keeps evidence collapsed',()=>{
  const history=[record('emily','marathon'),record('emily','km-50'),record('emily','km-60')];
  const f=load({initial:snapshot(history,true,{runners:{emily:{id:'emily'}}})});
  const html=f.q('#race-milestone-list').innerHTML;
  const kept=html.indexOf('Moments to keep'),upcoming=html.indexOf('Along the way');
  assert(kept>=0&&upcoming>kept);
  const order=['race-milestone-km-60','race-milestone-km-50','race-milestone-marathon','Along the way','race-milestone-silver','race-milestone-gold'].map(text=>html.indexOf(text));
  assert(order.every((index,i)=>index>=0&&(i===0||index>order[i-1])), 'earned moments appear newest first, then upcoming boundaries in route order');
  const card=html.match(/<article id="race-milestone-km-60"[\s\S]*?<\/article>/)?.[0];
  assert(card);
  assert.match(card,/<span>~03:01 crossed<\/span>/,'the crossing time remains visible without opening evidence');
  assert.match(card,/<details class="milestone-evidence"><summary>Crossing details<\/summary>/);
  assert.doesNotMatch(card,/<details[^>]+\bopen(?:[\s=>])/,'GPS evidence does not lengthen the default phone view');
  assert.match(card,/GPS bracket 03:00–03:01\. Estimated crossing time/);
});
