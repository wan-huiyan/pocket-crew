import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(new URL('../public/arrival-eta.js',import.meta.url),'utf8'),context);
context.arrivalEta=context.module.exports;context.module={exports:{}};
vm.runInNewContext(fs.readFileSync(new URL('../public/meeting-forecast.js',import.meta.url),'utf8'),context);
const {estimate}=context.module.exports;
const MINUTE=60000,HOUR=3600000,NOW=Date.parse('2026-11-14T03:00:00Z');
const iso=at=>new Date(at).toISOString();
const point=routeKm=>({lat:52+routeKm/111,lng:-1,routeKm,offRouteM:5});
const runner=(extra={})=>({...point(20),recordedAt:iso(NOW-MINUTE),fresh:true,speedKmh:6,paceMinPerKm:10,paceSource:'recent-tracker-route',paceWindowMinutes:20,...extra});
function history({earlySpeed=6,recentSpeed=6,end=NOW-MINUTE,minutes=60}={}){
  const values=[];
  const split=minutes/2;
  for(let ago=minutes;ago>=0;ago-=2){
    const distance=ago<=split?ago/60*recentSpeed:split/60*recentSpeed+(ago-split)/60*earlySpeed;
    values.push({...point(20-distance),recordedAt:iso(end-ago*MINUTE)});
  }
  return values;
}
const forecast=(person=runner(),km=40,extra={})=>estimate({snapshot:{runners:{emily:person}},point:point(km),now:NOW,...extra});

test('stable pace and missing long history use the disclosed bounded 5% planning allowance',()=>{
  for(const paceReports of [[],history()]){
    const result=forecast(runner({paceReports}));
    assert.equal(result.status,'ready');assert.equal(result.method,'planning-allowance');assert.equal(result.ratePerHour,.05);
    assert.equal(result.selectedRunnerName,'Emily');assert.equal(result.earliestArrivalTime,NOW-MINUTE+20/6*HOUR);
    assert(result.arrivalTime>result.earliestArrivalTime);assert(result.arrivalTime<=NOW-MINUTE+20/6*HOUR*1.5);
    assert.match(result.note,/allowance, not a prediction/);assert.match(result.note,/not a confidence interval/);assert.match(result.note,/faster pace could mean arriving before this range/);assert.match(result.note,/not a guaranteed window/);assert.match(result.note,/future stops are not included/);
  }
});

test('an earlier verified route pace provides a bounded, visibly provisional meeting ETA',()=>{
  const held=runner({paceSource:'held-tracker-route',paceMeasuredAt:iso(NOW-7*MINUTE),paceReports:[]});
  const first=forecast(held,22),later=forecast(held,22,{now:NOW+MINUTE});
  assert.equal(first.status,'ready');
  assert.equal(first.method,'held-route-pace');
  assert.equal(first.paceHeld,true);
  assert.match(first.note,/Earlier GPS-measured route pace \(provisional\)/);
  assert.match(first.note,/too few new GPS samples/);
  assert.equal(first.arrivalTime,later.arrivalTime);
  assert.equal(first.earliestArrivalTime,later.earliestArrivalTime);
  assert.equal(forecast({...held,paceMeasuredAt:iso(NOW-16*MINUTE)},22).status,'unavailable');
  assert.equal(forecast({...held,offRouteM:600},22).status,'unavailable');
});

test('after a verified stop the planning trend ignores pre-stop speed history',()=>{
  const paceReports=[];
  const end=NOW-MINUTE;
  for(let ago=60;ago>=10;ago-=2)paceReports.push({...point(18-(ago-10)*8/60),recordedAt:iso(end-ago*MINUTE)});
  for(const ago of [8,6,4])paceReports.push({...point(18),recordedAt:iso(end-ago*MINUTE)});
  for(const [ago,km] of [[2,18.2],[0,18.4]])paceReports.push({...point(km),recordedAt:iso(end-ago*MINUTE)});
  const result=forecast(runner({...point(18.4),paceReports,paceExcludesStops:true}),24);
  assert.equal(result.status,'ready');
  assert.equal(result.method,'planning-allowance');
  assert.match(result.note,/without counting the rest time/);
});

test('observed slowing raises the rate within its cap; faster recent history never forecasts speedup',()=>{
  const slower=forecast(runner({paceReports:history({earlySpeed:8,recentSpeed:6})}));
  assert.equal(slower.method,'observed-trend');assert.equal(slower.ratePerHour,.15);assert.match(slower.note,/history shows a slowdown/);
  const mild=forecast(runner({paceReports:history({earlySpeed:6.3,recentSpeed:6})}));
  assert(mild.ratePerHour>=.05&&mild.ratePerHour<=.15);
  const faster=forecast(runner({paceReports:history({earlySpeed:4,recentSpeed:6})}));
  assert.equal(faster.method,'planning-allowance');assert.equal(faster.ratePerHour,.05);assert(faster.arrivalTime>=faster.earliestArrivalTime);
});

test('sparse, short, off-route, discontinuous and jumping history cannot create a slowdown trend',()=>{
  const good=history({earlySpeed:8,recentSpeed:6});
  const changed=(index,patch)=>good.map((p,i)=>i===index?{...p,...patch}:p);
  for(const paceReports of [
    history({earlySpeed:8,minutes:20}),[good[0],good.at(-1)],
    changed(20,{offRouteM:600}),changed(20,{routeKm:100}),changed(20,{lat:55}),
    good.filter((_,i)=>i<14||i>22),changed(20,{routeKm:0})
  ]){const result=forecast(runner({paceReports}));assert.equal(result.status,'ready');assert.equal(result.method,'planning-allowance');}
});

test('bad old history is excluded and a later contiguous 30+ minute trend can still be used',()=>{
  const paceReports=history({earlySpeed:9,recentSpeed:6,minutes:100});
  paceReports[3]={...paceReports[3],offRouteM:800};
  const result=forecast(runner({paceReports}));assert.equal(result.method,'observed-trend');assert(result.historyMinutes>=30);
});

test('selects the same freshest usable person as the main ETA and never borrows competitor or partner history',()=>{
  const emily=runner({paceReports:history({earlySpeed:9,recentSpeed:6})});
  const jeff=runner({recordedAt:iso(NOW-30000),paceReports:history({end:NOW-30000})});
  const snapshot={runners:{emily,jeff,madlis:runner({recordedAt:iso(NOW),speedKmh:20})}};
  let result=forecast(emily,40,{snapshot});assert.equal(result.selectedRunnerName,'Jeff');assert.equal(result.method,'planning-allowance');
  snapshot.runners.jeff={...jeff,speedKmh:null,paceMinPerKm:null,paceSource:null};
  result=forecast(emily,40,{snapshot});assert.equal(result.selectedRunnerName,'Emily');assert.equal(result.method,'observed-trend');
});

test('forecasts are anchored to the report, remain ordered by route distance and respect the overall pace cap',()=>{
  const person=runner({paceReports:history({earlySpeed:10,recentSpeed:6})});
  const original=JSON.stringify(person);
  const one=forecast(person,30),later=forecast(person,30,{now:NOW+MINUTE});
  for(const field of ['arrivalTime','earliestArrivalTime','formattedTime','earliestFormattedTime','latestFormattedTime','readyByTime','readyByText','rangeText','roundedArrivalTime','roundingMinutes'])assert.equal(one[field],later[field],field+' stays anchored when the same tracker report is polled again');
  const outputs=[21,25,30,40,60,100,150].map(km=>forecast(person,km));
  for(let i=0;i<outputs.length;i++){
    const r=outputs[i];assert.equal(r.status,'ready');
    assert(r.arrivalTime>r.earliestArrivalTime);assert(r.arrivalTime-(NOW-MINUTE)<=(r.remainingKm/6*1.5)*HOUR+1);
    if(i)assert(r.arrivalTime>outputs[i-1].arrivalTime);
  }
  assert.equal(JSON.stringify(person),original);
});

test('display clocks round outwards while the main clock and readiness use the earlier current-pace scenario',()=>{
  const near=forecast(runner(),25),far=forecast(runner(),40);
  assert.equal(near.roundingMinutes,5);assert.equal(near.roundedArrivalTime%(5*MINUTE),0);assert.equal(near.minutes%5,0);
  assert.equal(far.roundingMinutes,15);assert.equal(far.roundedArrivalTime%(15*MINUTE),0);assert.equal(far.minutes%15,0);
  assert.equal(near.formattedTime,'03:45');assert.equal(near.latestFormattedTime,'03:55');assert.equal(near.rangeText,'03:45–03:55');
  assert.equal(far.formattedTime,'06:15');assert.equal(far.latestFormattedTime,'06:45');assert.equal(far.rangeText,'06:15–06:45');
  for(const result of [near,far]){
    const precision=result.roundingMinutes*MINUTE;
    assert.equal(result.formattedTime,result.earliestFormattedTime,'fallback consumers see the earlier time, never the slowdown scenario');
    assert.equal(result.readyByText,'Be ready by '+result.earliestFormattedTime);
    assert.equal(result.readyByTime,Math.floor(result.earliestArrivalTime/precision)*precision);
    assert.equal(result.roundedArrivalTime,Math.ceil(result.arrivalTime/precision)*precision);
    assert(result.readyByTime<=result.earliestArrivalTime&&result.earliestArrivalTime<=result.arrivalTime&&result.arrivalTime<=result.roundedArrivalTime);
    assert.equal(result.earliestArrivalTime,NOW-MINUTE+result.remainingKm/6*HOUR,'opening-hour checks retain the exact current-pace timestamp');
    assert.equal(result.arrivalTime,NOW-MINUTE+(Math.exp(.05*result.remainingKm/6)-1)/.05*HOUR,'opening-hour checks retain the raw slower scenario');
  }
});

test('outward rounding keeps UK date rollovers visible for short and long horizons, including British Summer Time',()=>{
  for(const [start,km,precision,early,late] of [
    ['2026-11-14T23:52:00Z',20.6,5,'23:55','15 Nov 00:00'],
    ['2026-11-14T20:52:00Z',38.6,15,'23:45','15 Nov 00:15'],
    ['2026-06-01T22:52:00Z',20.6,5,'23:55','2 Jun 00:00']
  ]){
    const now=Date.parse(start),result=forecast(runner({recordedAt:iso(now)}),km,{now});
    assert.equal(result.status,'ready');assert.equal(result.roundingMinutes,precision);
    assert.equal(result.earliestFormattedTime,early);assert.equal(result.latestFormattedTime,late);
    assert.equal(result.rangeText,early+'–'+late);assert.equal(result.readyByText,'Be ready by '+early);
    assert(result.readyByTime<=result.earliestArrivalTime);assert(result.roundedArrivalTime>=result.arrivalTime);
  }
});

test('a short nonzero scenario range stays visible and readiness says now once the earlier rounded time is reached',()=>{
  const now=Date.parse('2026-11-14T10:01:00Z'),person=runner({recordedAt:iso(now)});
  const result=forecast(person,20.2,{now});
  assert.equal(result.status,'ready');assert(result.earliestArrivalTime>now);
  assert.equal(result.readyByTime,Date.parse('2026-11-14T10:00:00Z'));
  assert.equal(result.readyByText,'Be ready now');assert.equal(result.formattedTime,'10:00');
  assert.equal(result.rangeText,'10:00–10:05','different scenarios must not collapse to the later rounded time');
  const later=forecast(person,20.2,{now:now+MINUTE});
  for(const field of ['readyByTime','readyByText','rangeText','earliestArrivalTime','arrivalTime'])assert.equal(later[field],result[field]);
});

test('stale, stopped, missing-pace, off-route and unknown positions cannot produce an ETA',()=>{
  for(const changes of [
    {recordedAt:iso(NOW-5*MINUTE)},{speedKmh:0},{paceSource:null},{offRouteM:700},{routeKm:null},{fresh:false},{retired:true},{finished:true},{recordedAt:iso(NOW+60000)}
  ]){const result=forecast(runner(changes));assert.equal(result.status,'unavailable');for(const field of ['arrivalTime','earliestArrivalTime','formattedTime','earliestFormattedTime','latestFormattedTime','readyByTime','readyByText'])assert.equal(result[field],null);assert.equal(result.rangeText,'');}
  const stationary=history().map(p=>({...p,...point(20)}));
  assert.equal(forecast(runner({paceReports:stationary})).reason,'stopped');
  assert.equal(estimate({snapshot:{runners:{}},point:point(40),now:NOW}).status,'unavailable');
});

test('passed points and actual arrivals expose their status without inventing a future clock',()=>{
  const passed=forecast(runner(),18),arrived=forecast(runner({speedKmh:0}),20);
  assert.equal(passed.status,'passed');assert.equal(passed.arrivalTime,null);
  assert.equal(arrived.status,'arrived');assert.equal(arrived.arrivalTime,null);
  for(const result of [passed,arrived])for(const field of ['earliestFormattedTime','latestFormattedTime','readyByTime','readyByText'])assert.equal(result[field],null);
});
