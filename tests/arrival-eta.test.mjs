import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = {module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(new URL('../public/arrival-eta.js', import.meta.url), 'utf8'), context);
const {derivePace, carryPace, selectRunner, estimate, format} = context.module.exports;
const MINUTE = 60_000;
const NOW = Date.parse('2026-11-14T00:00:00Z');
const iso = time => new Date(time).toISOString();
const point = routeKm => ({lat:52 + routeKm / 111, lng:-1, routeKm, offRouteM:5});
const meeting = point(20);
const runner = (routeKm = 10, extra = {}) => ({
  ...point(routeKm), recordedAt:iso(NOW - MINUTE), fresh:true,
  speedKmh:6, paceMinPerKm:10, paceSource:'recent-tracker-route', paceWindowMinutes:20,
  ...extra
});
const pair = (emily = runner(), jeff = runner(), extra = {}) => estimate({runners:{emily,jeff}, meeting, now:NOW, ...extra});
const solo = (emily = runner(), extra = {}) => pair(emily,null,extra);
const samples = (entries, end = NOW) => entries.map(([minutesAgo, km]) => ({...point(km), recordedAt:iso(end - minutesAgo * MINUTE)}));
const reports = samples([[20,8],[18,8.2],[16,8.4],[14,8.6],[12,8.8],[10,9],[8,9.2],[6,9.4],[4,9.6],[2,9.8],[0,10]]);
const pace = (extra = {}) => derivePace({runner:runner(10,{recordedAt:iso(NOW)}), reports, now:NOW, ...extra});

test('projects arrival from remaining planned-route distance, anchored to the report time', () => {
  const result = pair(runner(10,{crowKm:18}), runner(12,{speedKmh:4,paceMinPerKm:15,crowKm:19}));
  assert.equal(result.status, 'available');
  assert.equal(result.runners.emily.arrivalAt, NOW - MINUTE + 100 * MINUTE);
  assert.equal(result.runners.jeff.arrivalAt, NOW - MINUTE + 120 * MINUTE);
  assert.equal(result.arrivalAt, result.runners.emily.arrivalAt);
  assert.equal(result.selectedRunnerId, 'emily','equal timestamps have a deterministic choice');
  assert.equal(result.minutesRemaining, 99);
  assert.equal(result.runners.emily.remainingKm, 10);
});

test('an unchanged tracker report does not move the absolute ETA later on redraw', () => {
  const first = pair();
  const later = pair(runner(), runner(), {now:NOW + 2 * MINUTE});
  assert.equal(first.arrivalAt, later.arrivalAt);
  assert.equal(later.minutesRemaining, first.minutesRemaining - 2);
});

test('the latest usable report controls summary distance and ETA, rather than the trailing or slower runner', () => {
  const result = pair(runner(10,{speedKmh:10}),runner(15,{speedKmh:12,recordedAt:iso(NOW-30_000)}));
  assert.equal(result.arrivalAt, result.runners.jeff.arrivalAt);
  assert.ok(result.runners.jeff.arrivalAt < result.runners.emily.arrivalAt);
  assert.equal(result.selectedRunnerId,'jeff');
  assert.equal(result.selectedRunnerName,'Jeff');
  assert.equal(selectRunner({runners:{emily:runner(10),jeff:runner(15,{recordedAt:iso(NOW-30_000)})},now:NOW}).runner.routeKm,15);
});

test('a missing or invalid partner does not suppress a usable runner estimate or supply borrowed pace', () => {
  const missingRunner = pair(runner(),null);
  assert.equal(missingRunner.status,'available');
  assert.equal(missingRunner.selectedRunnerId,'emily');
  assert.equal(missingRunner.runners.emily.status,'available');
  assert.equal(missingRunner.runners.jeff.reason,'missing-report');
  const missingPace = pair(runner(),runner(12,{speedKmh:null,paceMinPerKm:null,recordedAt:iso(NOW-30_000)}));
  assert.equal(missingPace.arrivalAt,missingPace.runners.emily.arrivalAt);
  assert.equal(missingPace.selectedRunnerId,'emily');
  assert.equal(missingPace.selectionReason,'route-pace-fallback');
  assert.equal(missingPace.runners.jeff.reason,'missing-pace');
  assert.match(format(missingPace,{now:NOW}).fullText,/other runner has a newer position/);
});

test('without pace history the newest valid fix supplies distance while ETA waits', () => {
  const emily=runner(10,{speedKmh:null,paceMinPerKm:null,paceSource:null});
  const jeff=runner(12,{speedKmh:null,paceMinPerKm:null,paceSource:null,recordedAt:iso(NOW-30_000)});
  const selection=selectRunner({runners:{emily,jeff},now:NOW});
  assert.equal(selection.id,'jeff');assert.equal(selection.positionUsable,true);assert.equal(selection.paceUsable,false);
  assert.equal(selection.reason,'latest-position');assert.equal(selection.runner.routeKm,12);
  const result=pair(emily,jeff);
  assert.equal(result.selectedRunnerId,'jeff');assert.equal(result.reason,'missing-pace');
  assert.equal(result.remainingKm,8);assert.equal(result.arrivalAt,null);
});

test('selection uses actual GPS time rather than receipt time and does not mutate individual records', () => {
  const emily=runner(10,{updatedAt:iso(NOW+MINUTE)}),jeff=runner(12,{recordedAt:iso(NOW-30_000),updatedAt:iso(NOW-2*MINUTE)});
  const before=JSON.stringify({emily,jeff});
  assert.equal(selectRunner({runners:{jeff,emily},now:NOW}).id,'jeff');
  assert.equal(JSON.stringify({emily,jeff}),before);
  const stale=selectRunner({runners:{emily,jeff},now:NOW+6*MINUTE});
  assert.equal(stale.id,'jeff');assert.equal(stale.positionUsable,false);assert.equal(stale.paceUsable,false);
  assert.equal(stale.reason,'last-known-report');
  assert.equal(pair(emily,jeff,{now:NOW+6*MINUTE}).reason,'stale-report');
});

test('freshness is independently checked, not accepted just because the snapshot says fresh', () => {
  const stale = solo(runner(10,{recordedAt:iso(NOW - 5 * MINUTE)}));
  assert.equal(stale.reason,'stale-report');
  const future = solo(runner(10,{recordedAt:iso(NOW + 31_000)}));
  assert.equal(future.reason,'future-report');
  assert.equal(solo(runner(10,{fresh:false})).status,'unavailable');
  assert.equal(solo(runner(10,{recordedAt:null,updatedAt:iso(NOW)})).status,'unavailable','server receipt time cannot replace a GPS timestamp');
});

test('off-route, unknown projection, finished and retired runners cannot produce an ETA', () => {
  for (const [changes,reason] of [
    [{offRouteM:500},'off-route'],[{routeKm:null},'route-unavailable'],
    [{offRouteM:null},'route-unavailable'],[{finished:true},'finished'],[{retired:true},'retired']
  ]) assert.equal(solo(runner(10,changes)).reason,reason);
});

test('pace is sourced and numeric, with no default speed or contradicted-zero fallback', () => {
  assert.equal(solo(runner(10,{paceSource:null})).reason,'missing-pace');
  assert.equal(solo(runner(10,{speedKmh:'6',paceMinPerKm:'10'})).reason,'missing-pace');
  assert.equal(solo(runner(10,{speedKmh:0,paceMinPerKm:10})).reason,'stopped');
  assert.equal(solo(runner(10,{speedKmh:.4})).reason,'invalid-pace');
  assert.equal(solo(runner(10,{speedKmh:31})).reason,'invalid-pace');
  const fromPace = solo(runner(10,{speedKmh:null,paceMinPerKm:12}));
  assert.equal(fromPace.runners.emily.speedKmh,5);
});

test('plausible crow-flight or unknown pace cannot supply an arrival estimate', () => {
  for (const paceSource of ['crow-flight', 'event-average', 'official-tracker', 'unknown']) {
    const result = pair(runner(10,{speedKmh:6,paceMinPerKm:10,paceSource}));
    assert.equal(result.runners.emily.reason,'missing-pace',paceSource);
    assert.equal(result.runners.emily.arrivalAt,null,paceSource);
    assert.equal(result.selectedRunnerId,'jeff',paceSource);
    assert.equal(result.arrivalAt,result.runners.jeff.arrivalAt,paceSource);
    assert.equal(result.runners.jeff.status,'available','the other runner retains their own route estimate');
  }
  assert.equal(pair().status,'available','GPS progress along the route remains accepted');
});

test('a fresh leader who has passed the meet-up does not prevent the trailing runner ETA', () => {
  const result = pair(runner(21,{speedKmh:null,paceMinPerKm:null}),runner(15));
  assert.equal(result.runners.emily.status,'passed');
  assert.equal(result.runners.emily.arrivalAt,null);
  assert.equal(format(result.runners.emily,{now:NOW}).clockText,'Passed meet-up');
  assert.equal(result.arrivalAt,result.runners.jeff.arrivalAt);
  assert.equal(pair(runner(21),runner(22)).status,'passed');
});

test('At meet-up requires both fresh route proximity and actual geographic proximity', () => {
  const here = runner(20,{speedKmh:0});
  assert.equal(pair(here,here).status,'arrived');
  assert.equal(pair(runner(20,{lat:53})).status,'unavailable');
  assert.equal(solo(runner(19.99,{recordedAt:iso(NOW - 10 * MINUTE)})).status,'unavailable');
});

test('missing meeting and elapsed arrival do not become invented current estimates', () => {
  assert.equal(pair(runner(),runner(),{meeting:null}).reason,'meeting-unavailable');
  assert.equal(solo(runner(19.8,{recordedAt:iso(NOW - 4 * MINUTE)})).reason,'estimate-elapsed');
  assert.equal(pair(runner(),runner(),{meeting:{routeKm:'20'}}).reason,'meeting-unavailable');
});

test('recent pace uses actual net route progress over twenty minutes, not crow-flight metrics', () => {
  const result = pace({runner:runner(10,{recordedAt:iso(NOW),crowKm:100,speedKmh:99}),reports:reports.map(p=>({...p,distance:100}))});
  assert.equal(result.speedKmh,6);
  assert.equal(result.paceMinPerKm,10);
  assert.equal(result.paceSource,'recent-tracker-route');
  assert.equal(result.paceWindowMinutes,20);
});

test('after a verified rest the moving pace excludes stopped minutes and resumes within a few reports', () => {
  const paused = samples([[14,8],[12,8.2],[10,8.4],[8,8.6],[6,8.6],[4,8.6],[2,8.8],[0,9]]);
  const current=runner(9,{recordedAt:iso(NOW)});
  const result=pace({runner:current,reports:paused});
  assert.ok(Math.abs(result.speedKmh-6)<1e-9);
  assert.equal(result.paceWindowMinutes,4);
  assert.equal(result.paceExcludesStops,true);
  const arrival=solo({...current,...result});
  assert.equal(arrival.status,'available');
  assert.equal(arrival.arrivalAt,NOW+110*MINUTE);
  assert.match(format(arrival,{now:NOW}).fullText,/excluding the rest time/);
});

test('one post-stop fix cannot invent a resumed pace or carry a pre-rest pace forward', () => {
  const stopped=samples([[14,8],[12,8.2],[10,8.4],[8,8.6],[6,8.6],[4,8.6],[2,8.6],[0,8.7]]);
  const current=runner(8.7,{recordedAt:iso(NOW),speedKmh:null,paceMinPerKm:null,paceSource:null});
  assert.equal(pace({runner:current,reports:stopped}),null);
  const preRest={paceSource:'recent-tracker-route',speedKmh:6,recordedAt:iso(NOW-8*MINUTE),routeKm:8.6};
  assert.equal(carryPace({runner:current,reports:stopped,previous:preRest,now:NOW}),null);
  assert.equal(solo(current).reason,'missing-pace');
});

test('a now stationary runner cannot retain the earlier moving pace', () => {
  const stationary = samples([[10,8],[8,8.2],[6,8.4],[4,8.6],[2,8.6],[0,8.6]]);
  assert.equal(pace({runner:runner(8.6,{recordedAt:iso(NOW)}),reports:stationary}),null);
  assert.equal(pace({reports:reports.map(p=>({...p,routeKm:10}))}),null);
});

test('temporarily sparse GPS samples carry the last genuinely measured route pace, with a provisional ETA', () => {
  const past=samples([[14,8.6],[12,8.8],[10,9],[8,9.2],[6,9.4],[4,9.6],[2,9.8]]);
  const current=runner(10,{recordedAt:iso(NOW),speedKmh:null,paceMinPerKm:null,paceSource:null});
  assert.equal(derivePace({runner:current,reports:past.slice(-2),now:NOW}),null);
  const held=carryPace({runner:current,reports:past,now:NOW});
  assert.equal(held.paceSource,'held-tracker-route');
  assert.ok(Math.abs(held.speedKmh-6)<1e-9);
  assert.equal(held.paceMeasuredAt,iso(NOW-2*MINUTE));
  const result=solo({...current,...held});
  assert.equal(result.status,'available');
  assert.equal(result.arrivalAt,NOW+100*MINUTE);
  assert.match(format(result,{now:NOW}).fullText,/Provisional: carrying an earlier GPS-measured route pace/);
  assert.equal(solo({...current,...held},{now:NOW+2*MINUTE}).arrivalAt,result.arrivalAt,'redrawing never pushes the clock later');
});

test('a previously verified same-runner pace survives missing path history, but not a known stop', () => {
  const measured={...derivePace({runner:runner(9.8,{recordedAt:iso(NOW-2*MINUTE)}),reports:samples([[14,8.6],[12,8.8],[10,9],[8,9.2],[6,9.4],[4,9.6],[2,9.8]]),now:NOW-2*MINUTE}),recordedAt:iso(NOW-2*MINUTE),routeKm:9.8};
  const current=runner(10,{recordedAt:iso(NOW),paceSource:null,speedKmh:null,paceMinPerKm:null});
  const held=carryPace({runner:current,reports:[],previous:measured,now:NOW});
  assert.equal(held.paceSource,'held-tracker-route');
  assert.equal(carryPace({runner:runner(9.8,{recordedAt:iso(NOW),paceSource:null}),previous:measured,now:NOW}),null,'same position two minutes later means stopped');
  assert.equal(carryPace({runner:current,reports:samples([[3,10],[2,10]]),previous:measured,now:NOW}),null,'a recent unchanged GPS baseline overrides a former pace');
  assert.equal(carryPace({runner:current,previous:{...measured,paceSource:'event-average'},now:NOW}),null,'an unsourced estimate must never be held');
});

test('a held pace expires and never works with old, off-route, impossible or ended positions', () => {
  const verified={paceSource:'recent-tracker-route',speedKmh:6,routeKm:9,recordedAt:iso(NOW-10*MINUTE)};
  const current=runner(10,{recordedAt:iso(NOW),paceSource:null});
  const hold=extra=>carryPace({runner:{...current,...extra},previous:verified,now:NOW});
  assert.equal(hold({}).paceSource,'held-tracker-route');
  assert.equal(carryPace({runner:current,previous:{...verified,recordedAt:iso(NOW-16*MINUTE)},now:NOW}),null);
  assert.equal(hold({recordedAt:iso(NOW-5*MINUTE)}),null);
  assert.equal(hold({offRouteM:500}),null);
  assert.equal(hold({retired:true}),null);
  assert.equal(hold({finished:true}),null);
  assert.equal(hold({routeKm:8}),null,'backtracking a kilometre invalidates the old trajectory');
  assert.equal(carryPace({runner:runner(10,{recordedAt:iso(NOW),paceSource:null}),previous:{...verified,routeKm:9,recordedAt:iso(NOW-MINUTE)},now:NOW}),null,'implausible forward GPS jump');
  const expired={...current,...hold({}),paceMeasuredAt:iso(NOW-16*MINUTE)};
  assert.equal(solo(expired).reason,'missing-pace','even a forged held source needs a recent verified timestamp');
});

test('pace needs four distinct samples, enough elapsed time, and a current live position', () => {
  assert.equal(pace({reports:reports.slice(-2)}),null);
  assert.equal(pace({reports:samples([[3,9.7],[2,9.8],[1,9.9],[0,10]])}),null);
  assert.equal(pace({runner:runner(10,{recordedAt:iso(NOW - 5 * MINUTE)})}),null);
  assert.equal(pace({runner:runner(10,{recordedAt:iso(NOW),fresh:false})}),null);
  assert.equal(pace({runner:runner(10,{recordedAt:iso(NOW),retired:true})}),null);
  assert.equal(pace({reports:Array(6).fill(reports[0])}),null);
});

test('off-route samples, GPS jumps and backward progress reject derived pace', () => {
  const changed = (index, patch) => reports.map((p,i)=>i===index?{...p,...patch}:p);
  assert.equal(pace({reports:changed(5,{offRouteM:700})}),null);
  assert.equal(pace({reports:changed(5,{routeKm:15})}),null);
  assert.equal(pace({reports:changed(5,{routeKm:8.2})}),null);
});

test('a long GPS blackout resets the pace window, without averaging missing time or guessing from one fix',()=>{
  const resumed=pace({reports:[reports[0],...reports.slice(4)]});
  assert.ok(Math.abs(resumed.speedKmh-6)<1e-9);
  assert.equal(resumed.paceWindowMinutes,12);
  assert.equal(resumed.paceResetAfterGap,true);
  const result=solo({...runner(10,{recordedAt:iso(NOW)}),...resumed});
  assert.match(format(result,{now:NOW}).fullText,/since reporting resumed after a gap/);
  assert.equal(pace({reports:[reports[0],...reports.slice(-2)]}),null,'one recent interval after a blackout is insufficient');
});

test('unrelated older/future path samples are ignored and the current GPS report anchors the window', () => {
  const extra = samples([[60,1],[-2,20]]);
  const result = pace({reports:[...extra,...reports,{...reports.at(-1),routeKm:99}]});
  assert.equal(result.speedKmh,6);
  assert.equal(result.paceWindowMinutes,20);
});

test('a valid six-minute startup window is usable, and a separate runner never supplies missing pace', () => {
  const short = pace({reports:reports.slice(-4)});
  assert.equal(short.paceWindowMinutes,6);
  assert.ok(Math.abs(short.speedKmh-6)<1e-9);
  const withPace = {...runner(),...short};
  const withoutPace = {...runner(),speedKmh:null,paceMinPerKm:null,paceSource:null};
  const result = pair(withPace,withoutPace);
  assert.equal(result.runners.emily.status,'available');
  assert.equal(result.runners.jeff.status,'unavailable');
});

test('formatter rounds clock and duration to approximate five minutes for either result level', () => {
  const result = pair();
  const formatted = format(result,{now:NOW});
  assert.equal(formatted.clockText,'ETA ~01:40');
  assert.equal(formatted.remainingText,'in ~1h 40m');
  assert.equal(formatted.text,'ETA ~01:40 · in ~1h 40m');
  assert.doesNotMatch(formatted.ariaLabel,/Using Emily|Using Jeff|Selected tracker/);
  assert.match(formatted.ariaLabel,/recent GPS progress along our planned route/);
  assert.doesNotMatch(formatted.ariaLabel,/both runners/);
  assert.equal(format(result.runners.emily,{now:NOW}).clockText,formatted.clockText);
  assert.equal(format({...result,arrivalAt:NOW+2*MINUTE},{now:NOW}).remainingText,'in <5 min');
});

test('arrival clocks use London daylight saving and describe midnight date rollover', () => {
  const summer = Date.parse('2026-07-01T12:00:00Z');
  const result = {status:'available',arrivalAt:summer+30*MINUTE};
  assert.equal(format(result,{now:summer}).clockText,'ETA ~13:30');
  const beforeMidnight = Date.parse('2026-11-13T23:30:00Z');
  const nextDay = format({status:'available',arrivalAt:NOW+10*MINUTE},{now:beforeMidnight});
  assert.equal(nextDay.clockText,'ETA ~00:10');
  assert.match(nextDay.fullText,/on 14 Nov/);
});

test('compact unavailable labels carry a fuller accessible explanation', () => {
  const result = solo(runner(10,{recordedAt:iso(NOW - 5 * MINUTE)}));
  const formatted = format(result,{now:NOW});
  assert.equal(formatted.clockText,'ETA · old report');
  assert.ok(formatted.clockText.length<=18);
  assert.match(formatted.fullText,/five minutes/);
  assert.equal(formatted.ariaLabel,formatted.fullText);
  assert.equal(format({status:'available',arrivalAt:NOW-1},{now:NOW}).clockText,'ETA · updating');
});
