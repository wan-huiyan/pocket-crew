import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../public/toilet-hours.js',import.meta.url),'utf8');
function engine(forecast){const context={module:{exports:{}},Intl,Date,Math,Number,meetingForecast:forecast};vm.runInNewContext(source,context);return context.module.exports;}
const api=engine();
const stamp=Date.parse;
const weekly=hours=>Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),hours]));
const poi=(hours,basis='toilet')=>({opening:{timeZone:'Europe/London',basis,weekly:weekly(hours)}});
const arrival=(early,late=early)=>({status:'ready',earliestArrivalTime:stamp(early),arrivalTime:stamp(late)});
const check=(p,a)=>api.evaluate({poi:p,arrival:a,now:a.earliestArrivalTime-60000});

test('published toilet hours cover the whole ETA range and ten minutes to use it',()=>{
 const a=arrival('2026-11-14T09:00:00Z','2026-11-14T09:20:00Z');
 const value=check(poi([['08:00','18:00']]),a);
 assert.equal(value.status,'open');assert.equal(value.bufferMinutes,10);
});
test('venue hours never claim confirmed toilet access',()=>{
 const value=check(poi([['08:00','18:00']],'venue'),arrival('2026-11-14T09:00:00Z'));
 assert.equal(value.status,'likely');assert.match(value.detail,/separate toilet access is not guaranteed/);
});
test('the access buffer catches a closing shortly after ETA',()=>{
 const value=check(poi([['08:00','18:00']]),arrival('2026-11-14T17:55:00Z'));
 assert.equal(value.status,'tight');
});
test('arrival uncertainty crossing opening or closing is labelled tight',()=>{
 assert.equal(check(poi([['08:00','18:00']]),arrival('2026-11-14T07:55:00Z','2026-11-14T08:20:00Z')).status,'tight');
 assert.equal(check(poi([['08:00','18:00']]),arrival('2026-11-14T17:50:00Z','2026-11-14T18:05:00Z')).status,'tight');
});
test('known closure gives the next real opening',()=>{
 const value=check(poi([['08:00','18:00']]),arrival('2026-11-14T20:00:00Z'));
 assert.equal(value.status,'closed');assert.equal(value.nextOpening,stamp('2026-11-15T08:00:00Z'));
});
test('an overnight interval remains open after local midnight',()=>{
 const p=poi([]);p.opening.weekly['6']=[['22:00','02:00']];
 assert.equal(check(p,arrival('2026-11-15T01:00:00Z')).status,'open');
 assert.equal(check(p,arrival('2026-11-15T03:00:00Z')).status,'closed');
});
test('24:00 adjacent days merge without an artificial midnight closure',()=>{
 assert.equal(check(poi([['00:00','24:00']]),arrival('2026-11-14T23:55:00Z','2026-11-15T00:10:00Z')).status,'open');
});
test('Sunday closed and unknown have distinct meanings',()=>{
 const p=poi([['08:00','18:00']]);p.opening.weekly['0']=[];
 assert.equal(check(p,arrival('2026-11-15T12:00:00Z')).status,'closed');
 p.opening.weekly['0']=null;
 assert.equal(check(p,arrival('2026-11-15T12:00:00Z')).status,'unknown');
});
test('conflicting hours and incomplete schedules never turn green',()=>{
 assert.equal(check(poi([['00:00','24:00']],'conflicting'),arrival('2026-11-14T09:00:00Z')).status,'unknown');
 assert.equal(check(poi(null),arrival('2026-11-14T09:00:00Z')).status,'unknown');
});
test('an unknown previous day is not treated as a definite morning closure',()=>{
 const p=poi([['12:00','18:00']]);p.opening.weekly['5']=null;
 assert.equal(check(p,arrival('2026-11-14T08:00:00Z')).status,'unknown');
 assert.equal(check(p,arrival('2026-11-14T13:00:00Z')).status,'open');
 p.opening.exceptions={'2026-11-14':[]};
 assert.equal(check(p,arrival('2026-11-14T08:00:00Z')).status,'closed');
});
test('exception dates override weekly hours and close overnight access',()=>{
 const p=poi([['00:00','24:00']]);p.opening.exceptions={'2026-11-15':[]};
 assert.equal(check(p,arrival('2026-11-15T12:00:00Z')).status,'closed');
 p.opening.weekly['6']=[['22:00','02:00']];
 assert.equal(check(p,arrival('2026-11-15T01:00:00Z')).status,'closed');
 p.opening.exceptions={'2026-11-15':[['07:00','12:00']]};
 assert.equal(check(p,arrival('2026-11-15T01:00:00Z')).status,'closed');
 assert.equal(check(p,arrival('2026-11-15T08:00:00Z')).status,'open');
 p.opening.exceptions={'2026-11-15':null};
 assert.equal(check(p,arrival('2026-11-15T01:00:00Z')).status,'unknown');
});
test('UK summer time is evaluated in local time',()=>{
 const p=poi([['08:00','18:00']]);
 assert.equal(check(p,arrival('2026-07-18T07:15:00Z')).status,'open');
 assert.equal(check(p,arrival('2026-07-18T06:00:00Z')).status,'closed');
});
test('a missing spring clock boundary yields unknown, never invented open hours',()=>{
 assert.equal(check(poi([['01:30','04:00']]),arrival('2026-03-29T02:00:00Z')).status,'unknown');
});
test('autumn repeated hour is handled without truncating a midnight-to-three opening',()=>{
 assert.equal(check(poi([['00:00','03:00']]),arrival('2026-10-25T01:30:00Z')).status,'open');
});
test('missing, stale or inverted ETA cannot produce availability',()=>{
 const p=poi([['00:00','24:00']]);
 assert.equal(api.evaluate({poi:p,arrival:null}).status,'unknown');
 const a=arrival('2026-11-14T10:00:00Z');
 assert.equal(api.evaluate({poi:p,arrival:a,now:stamp('2026-11-14T11:00:00Z')}).status,'unknown');
 assert.equal(check(p,arrival('2026-11-14T10:00:00Z','2026-11-14T09:00:00Z')).status,'unknown');
});
test('runner ETA uses the existing forecast and labels an off-route walking allowance',()=>{
 const now=stamp('2026-11-14T08:00:00Z');let seen;
 const e=engine({estimate:input=>{seen=input;return {status:'ready',earliestArrivalTime:now+60*60000,arrivalTime:now+70*60000,selectedRunnerName:'Emily',note:'Route pace.'};}});
 const p={routeKm:35,routeOffsetM:400},snapshot={runners:{emily:{}}};
 const result=e.runnerArrival({poi:p,snapshot,now});
 assert.equal(seen.snapshot,snapshot);assert.equal(seen.point,p);assert.equal(result.status,'ready');
 assert.equal(result.accessAllowanceMinutes,6);assert.equal(result.arrivalTime,now+76*60000);
 assert.match(result.note,/not a measured walking detour/);
});
test('runner missing pace and passed reports do not produce a guessed ETA',()=>{
 assert.equal(engine({estimate:()=>({status:'unavailable',reason:'stale'})}).runnerArrival({poi:{routeKm:30}}).status,'unavailable');
 assert.equal(engine({estimate:()=>({status:'passed'})}).runnerArrival({poi:{routeKm:30}}).status,'passed');
 assert.equal(engine({estimate:()=>({status:'ready',arrivalTime:null})}).runnerArrival({poi:{routeKm:30}}).status,'unavailable');
});
test('real forecast integration follows the latest usable runner and rejects stale or crow-flight-only pace',()=>{
 const context={module:{exports:{}},Intl,Date,Math,Number};
 for(const [file,key]of [['arrival-eta.js','arrivalEta'],['meeting-forecast.js','meetingForecast'],['toilet-hours.js','toiletHours']]){
  context.module={exports:{}};vm.runInNewContext(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),context);context[key]=context.module.exports;
 }
 const now=stamp('2026-11-14T08:00:00Z'),p={lat:52.4,lng:-1,routeKm:40,routeOffsetM:200};
 const report=delay=>({lat:52.3,lng:-1,routeKm:30,offRouteM:10,fresh:true,recordedAt:new Date(now-delay).toISOString(),speedKmh:6,paceSource:'recent-tracker-route'});
 const snapshot={runners:{emily:report(60000),jeff:report(30000)}};
 let r=context.toiletHours.runnerArrival({poi:p,snapshot,now});
 assert.equal(r.status,'ready');assert.equal(r.selectedRunnerName,'Jeff');assert(r.arrivalTime>r.earliestArrivalTime);
 snapshot.runners.jeff.paceSource='crow-flight';
 r=context.toiletHours.runnerArrival({poi:p,snapshot,now});assert.equal(r.selectedRunnerName,'Emily');
 snapshot.runners.emily.recordedAt=new Date(now-6*60000).toISOString();
 r=context.toiletHours.runnerArrival({poi:p,snapshot,now});assert.equal(r.status,'unavailable');
 assert.equal(context.toiletHours.evaluate({poi:poi([['00:00','24:00']]),arrival:r,now}).status,'unknown');
 assert.equal(context.toiletHours.runnerArrival({poi:p,snapshot:{runners:{}},now}).status,'unavailable');
});

// Café presence is a lead for asking staff, never evidence of a toilet.
test('possible café WC remains a separate amber candidate when café hours fit',()=>{
 const p={...poi([['08:00','18:00']],'venue'),possibleToilet:true};
 const value=check(p,arrival('2026-11-14T09:00:00Z'));
 assert.equal(value.status,'possible');assert.equal(value.possibleToilet,true);
 assert.match(value.label,/ask about WC/);assert.match(value.detail,/not been confirmed/);
});
test('a candidate flag cannot be promoted by accidentally tagged toilet hours',()=>{
 const p={...poi([['00:00','24:00']],'toilet'),possibleToilet:true};
 assert.equal(check(p,arrival('2026-11-14T09:00:00Z')).status,'possible');
});
test('café hours and access allowance still exclude closed or closing candidates',()=>{
 const p={...poi([['08:00','18:00']],'venue'),possibleToilet:true};
 const closed=check(p,arrival('2026-11-14T20:00:00Z'));
 assert.equal(closed.status,'closed');assert.equal(closed.possibleToilet,true);
 assert.match(closed.label,/Café closed/);
 const tight=check(p,arrival('2026-11-14T17:55:00Z'));
 assert.equal(tight.status,'tight');assert.equal(tight.possibleToilet,true);
});
test('unknown café hours or missing ETA do not imply open or available toilets',()=>{
 const p={possibleToilet:true};
 const unknown=check(p,arrival('2026-11-14T09:00:00Z'));
 assert.equal(unknown.status,'unknown');assert.match(unknown.label,/hours unknown/);
 const noEta=api.evaluate({poi:{...poi([['00:00','24:00']],'venue'),possibleToilet:true}});
 assert.equal(noEta.status,'unknown');assert.match(noEta.label,/ETA unavailable/);
});
