import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/catch-up.js',import.meta.url),'utf8');
const context={module:{exports:{}}};vm.runInNewContext(source,context);
const {estimate,formatPace}=context.module.exports;
const NOW=Date.parse('2026-11-14T03:00:00Z');
const runner=(change={})=>({lat:52.37,lng:-1.37,recordedAt:new Date(NOW).toISOString(),fresh:true,routeKm:30,offRouteM:0,speedKmh:10,paceMinPerKm:6,paceSource:'recent-tracker-route',...change});
const query=(change={})=>({jeff:runner(),rival:{position:runner({routeKm:32,speedKmh:8,paceMinPerKm:7.5})},now:NOW,...change});

test('defaults to a sustained two-hour target while keeping the current-pace catch independent',()=>{
  const result=estimate(query());
  assert.equal(result.status,'available');assert.equal(result.gapKm,2);assert.equal(result.horizonMinutes,120);
  assert.equal(result.requiredSpeedKmh,9);assert.equal(result.requiredPaceMinPerKm,60/9);assert.equal(result.mattPaceMinPerKm,7.5);
  assert.equal(result.targetAt,NOW+2*3600000);assert.equal(formatPace(result.requiredPaceMinPerKm),'6:40 /km');
  assert.equal(result.catchAtCurrentPace,NOW+3600000);assert.equal(result.catchMinutes,60);assert.equal(result.catchRouteKm,40);
  const twoHours=estimate(query({horizonMinutes:120}));assert.equal(twoHours.requiredSpeedKmh,result.requiredSpeedKmh);assert.equal(twoHours.targetAt,result.targetAt);
});

test('computes an exact five-hour sustained target from Matt’s pace and the route gap',()=>{
  const result=estimate(query({horizonMinutes:300}));
  assert.equal(result.status,'available');assert.equal(result.horizonMinutes,300);assert.equal(result.gapKm,2);
  assert.equal(result.requiredSpeedKmh,8.4);assert.equal(result.requiredPaceMinPerKm,60/8.4);
  assert.equal(result.targetAt,NOW+5*3600000);assert.equal(formatPace(result.requiredPaceMinPerKm),'7:09 /km');
  assert.equal(result.catchAtCurrentPace,NOW+3600000);assert.equal(result.catchMinutes,60);assert.equal(result.catchRouteKm,40);
});

test('unsupported or obsolete catch-up windows fall back to two hours',()=>{
  for(const horizonMinutes of [undefined,null,0,30,60,180,600,'300']){
    const result=estimate(query({horizonMinutes}));assert.equal(result.horizonMinutes,120);assert.equal(result.requiredSpeedKmh,9);assert.equal(result.targetAt,NOW+2*3600000);
  }
});

test('time-aligns independently timed GPS reports at their own pace without moving actual map coordinates',()=>{
  const j=runner({recordedAt:new Date(NOW-120000).toISOString()});
  const m=runner({routeKm:32,speedKmh:8,recordedAt:new Date(NOW-60000).toISOString()});
  const result=estimate(query({jeff:j,rival:{position:m}}));
  assert.equal(result.status,'available');assert(result.timeAligned);assert.equal(result.referenceAt,NOW);assert.equal(result.alignmentSeconds,120);
  assert(Math.abs(result.gapKm-1.8)<1e-9);assert.equal(j.routeKm,30);assert.equal(m.routeKm,32);
  assert(Math.abs(result.requiredSpeedKmh-8.9)<1e-9);
});

test('requires fresh usable Jeff pace and never borrows Emily or crow-flight pace',()=>{
  const missing=estimate(query({jeff:null,runners:{emily:runner()}}));assert.equal(missing.reason,'missing-report');
  const noPace=estimate(query({jeff:runner({paceSource:'event-crow-flight-average'})}));assert.equal(noPace.reason,'missing-jeff-pace');
  const mattMissing=estimate(query({rival:{position:runner({paceSource:null})}}));assert.equal(mattMissing.reason,'missing-matt-pace');
  for(const [change,reason] of [
    [{recordedAt:new Date(NOW-300000).toISOString()},'stale-report'],
    [{recordedAt:new Date(NOW+31000).toISOString()},'future-report'],
    [{offRouteM:500},'off-route'],
    [{routeKm:null},'route-unavailable'],
    [{finished:true},'finished'],[{retired:true},'retired'],
    [{speedKmh:40},'invalid-pace'],
    [{recordedAt:new Date(NOW-121000).toISOString()},'unaligned-reports']
  ]){
    const result=estimate(query({jeff:runner(change)}));assert.equal(result.status,'unavailable');assert.equal(result.reason,reason);assert(result.reasonText);assert.equal(result.requiredPaceMinPerKm,null);
  }
});

test('does not claim a catch when Jeff is at the same or slower pace, ahead, or already together',()=>{
  for(const speedKmh of [8,7]){const result=estimate(query({jeff:runner({speedKmh})}));assert.equal(result.status,'available');assert.equal(result.catchAtCurrentPace,null);assert.equal(result.catchReason,'no-closing');assert.equal(result.requiredPaceMinPerKm,60/9);}
  const ahead=estimate(query({jeff:runner({routeKm:33})}));assert.equal(ahead.status,'ahead');assert.equal(ahead.requiredPaceMinPerKm,null);
  const together=estimate(query({jeff:runner({routeKm:31.95})}));assert.equal(together.status,'together');assert.equal(together.catchAtCurrentPace,null);
});

test('bounds estimates to the planned route and formats readable pace',()=>{
  const end=estimate(query({routeLengthKm:35}));assert.equal(end.targetReason,'target-beyond-route');assert.equal(end.requiredPaceMinPerKm,null);assert.equal(end.catchReason,'catch-beyond-route');
  const tooFast=estimate(query({rival:{position:runner({routeKm:70,speedKmh:15})},horizonMinutes:120}));assert.equal(tooFast.targetReason,'target-too-fast');assert.equal(tooFast.requiredPaceMinPerKm,null);
  assert.equal(formatPace(7.5),'7:30 /km');assert.equal(formatPace(7.999),'8:00 /km');assert.equal(formatPace(null),'Pace waiting');
});

test('a five-hour target is withheld beyond the route even when two hours and current-pace catch fit',()=>{
  const twoHours=estimate(query({horizonMinutes:120,routeLengthKm:50}));
  assert.equal(twoHours.targetReason,null);assert.equal(twoHours.requiredSpeedKmh,9);assert.equal(twoHours.targetAt,NOW+2*3600000);
  const fiveHours=estimate(query({horizonMinutes:300,routeLengthKm:50}));
  assert.equal(fiveHours.status,'available');assert.equal(fiveHours.targetReason,'target-beyond-route');assert.match(fiveHours.targetReasonText,/beyond our planned route/);
  assert.equal(fiveHours.requiredPaceMinPerKm,null);assert.equal(fiveHours.requiredSpeedKmh,null);assert.equal(fiveHours.targetAt,null);
  assert.equal(fiveHours.catchAtCurrentPace,NOW+3600000);assert.equal(fiveHours.catchMinutes,60,'the current-pace catch does not inherit the longer target’s boundary failure');
  for(const [horizonMinutes,routeLengthKm] of [[120,48],[300,72]]){
    const atFinish=estimate(query({horizonMinutes,routeLengthKm}));assert.equal(atFinish.targetReason,null);assert(Number.isFinite(atFinish.requiredPaceMinPerKm),'catching exactly at the planned endpoint remains allowed');
  }
});
