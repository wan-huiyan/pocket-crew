import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = {module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(new URL('../public/upcoming-points.js', import.meta.url), 'utf8'), context);
const plan = args => JSON.parse(JSON.stringify(context.module.exports.plan(args)));
const pin = (id, routeKm, groupNumber = Number(id.replace(/\D/g, ''))) => ({id, label:'Point ' + id, routeKm, groupNumber, lat:52 - routeKm / 200, lng:-1 + routeKm / 300});
const points = [pin('p1', 10, 1), pin('p2', 20, 2), pin('p3', 30, 3), pin('p4a', 40, 4), pin('p4b', 40.25, 4), pin('p5', 50, 5)];
const run = extra => plan({points, planningEndKm:55, progressKm:0, ...extra});

test('published route starts with the Coventry meet-up, then preserves numbered points and crew overrides',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
  const routePoints=data.groups.flatMap(g=>g.options);
  const coventry=routePoints.find(p=>p.id==='meetup-mfg-coventry');
  const point1=routePoints.find(p=>p.id==='point-1');
  const point2=routePoints.find(p=>p.id==='point-2');
  const actualPlan=extra=>plan({points:routePoints,planningEndKm:data.planningEndKm,progressKm:null,...extra});
  assert.deepEqual([coventry.lat,coventry.lng,coventry.routeKm],[52.398503,-1.440933,17.3]);
  assert.equal(coventry.pointNumber,null,'the added stop does not renumber original points');
  assert.deepEqual([point1.pointNumber,point1.routeKm,point1.lat,point1.lng],['1',31.4686,52.3371182,-1.2902631]);
  assert.deepEqual([point2.pointNumber,point2.routeKm],['2',37.0663]);
  assert.deepEqual(actualPlan().points.map(p=>p.id),['meetup-mfg-coventry','point-1']);
  assert.equal(actualPlan({limit:1}).points[0].distanceKm,null,'unknown runner progress is not presented as measured distance remaining');
  assert.equal(actualPlan({limit:1,progressKm:15}).points[0].id,coventry.id);
  assert.ok(Math.abs(actualPlan({limit:1,progressKm:15}).points[0].distanceKm-2.3)<.00001,'remaining distance uses 17.3 km, not the rough 15 km plan');
  assert.equal(actualPlan({limit:1,progressKm:17.5}).points[0].id,point1.id);
  assert.equal(actualPlan({limit:1,statuses:{[coventry.id]:{status:'met'}}}).points[0].id,point1.id);
  assert.equal(actualPlan({limit:1,selected:point2}).points[0].id,point2.id,'an intentional crew agreement still takes priority');
});

test('a one-point runner plan follows the next checkpoint and honours a crew override', () => {
  const automatic=run({limit:1,progressKm:1});
  assert.deepEqual(automatic.points.map(p=>p.id),['p1']);
  assert.equal(automatic.endKm,11,'a second point does not widen the runner map');
  assert.deepEqual(run({limit:1,progressKm:10.2}).points.map(p=>p.id),['p2']);
  const agreed=run({limit:1,progressKm:1,selected:points[2]});
  assert.deepEqual(agreed.points.map(p=>p.id),['p3']);
  assert.equal(agreed.points[0].agreed,true);
  assert.equal(agreed.endKm,30.5,'the actual agreed pin remains in frame');
});

test('advances to the next two pins as the runners pass, preserving original coordinates', () => {
  const before = run({progressKm:9.9});
  assert.deepEqual(before.points.map(p=>p.id), ['p1','p2']);
  assert.equal(before.points[0].agreed, false);
  assert.equal(before.points[0].sequence, 'next');
  assert.equal(before.points[1].sequence, 'then');
  const after = run({progressKm:10.2});
  assert.deepEqual(after.points.map(p=>p.id), ['p2','p3']);
  assert.equal(after.points[0].lat, points[1].lat);
  assert.equal(after.points[0].lng, points[1].lng);
  assert.ok(Math.abs(after.points[0].distanceKm - 9.8) < .00001);
  assert.equal(after.endKm, 30.5);
});

test('skips met and skipped points without changing saved status data', () => {
  const statuses = {p1:{status:'met',at:100},p2:{status:'skipped'}};
  const original = JSON.stringify(statuses);
  const result = run({statuses});
  assert.deepEqual(result.points.map(p=>p.id), ['p3','p4a']);
  assert.equal(JSON.stringify(statuses), original);
});

test('confirmed passed stops frame the next section without inventing runner distance', () => {
  const data=JSON.parse(fs.readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
  const routePoints=data.groups.flatMap(g=>g.options);
  const statuses=Object.fromEntries(data.confirmedPassedPointIds.map(id=>[id,{status:'passed'}]));
  const original=JSON.stringify({routePoints,statuses});
  const result=plan({points:routePoints,statuses,planningEndKm:data.planningEndKm,progressKm:null});
  assert.deepEqual(result.points.map(p=>p.id),['point-1','point-2']);
  assert.equal(result.points[0].town,'Dunchurch');
  assert.equal(result.fromKm,17.3,'frame starts at the confirmed passed stop, not Meriden');
  assert(result.points.every(p=>p.distanceKm===null),'remaining distance waits for valid GPS');
  assert.equal(JSON.stringify({routePoints,statuses}),original,'all pins and status inputs remain intact');
  assert.deepEqual(run({progressKm:null,statuses:{p1:'passed'}}).points.map(p=>p.id),['p2','p3']);
});

test('two nearby alternatives occupy one numbered group; selected sibling wins', () => {
  const automatic = run({progressKm:31});
  assert.deepEqual(automatic.points.map(p=>p.id), ['p4a','p5']);
  assert.deepEqual(automatic.points[0].alternatives.map(p=>p.id), ['p4b']);
  const chosen = run({progressKm:31, selected:points[4]});
  assert.deepEqual(chosen.points.map(p=>p.id), ['p4b','p5']);
  assert.equal(chosen.points[0].agreed, true);
  assert.deepEqual(chosen.points[0].alternatives.map(p=>p.id), ['p4a']);
  const passedSibling = run({progressKm:40.2});
  assert.deepEqual(passedSibling.points.map(p=>p.id), ['p4b','p5']);
  assert.deepEqual(passedSibling.points[0].alternatives, []);
});

test('agreed later meeting remains first while passed agreement does not freeze the map', () => {
  const result = run({progressKm:2,selected:points[2]});
  assert.deepEqual(result.points.map(p=>p.id), ['p3','p4a']);
  assert.equal(result.points[0].agreed, true);
  const passed = run({progressKm:30.2,selected:points[2]});
  assert.deepEqual(passed.points.map(p=>p.id), ['p4a','p5']);
  assert.equal(passed.points[0].agreed, false);
});

test('unknown or off-route progress never fabricates a remaining distance', () => {
  for (const progressKm of [null, undefined, NaN, -2]) {
    const result = run({progressKm});
    assert.equal(result.fromKm, 0);
    assert.deepEqual(result.points.map(p=>p.id), ['p1','p2']);
    assert.ok(result.points.every(p=>p.distanceKm === null));
  }
});

test('shared selection restores group and landmark metadata by exact coordinate match', () => {
  const named = {...points[4],landmark:{name:'Village Hall'}};
  const result = run({points:[...points.slice(0,4),named,points[5]], progressKm:31, selected:{id:'shared-meetup',label:'Our agreed spot',lat:named.lat,lng:named.lng,routeKm:null}});
  assert.deepEqual(result.points.map(p=>p.id), ['p4b','p5']);
  assert.equal(result.points[0].sharedId,'shared-meetup');
  assert.equal(result.points[0].label,'Our agreed spot');
  assert.equal(result.points[0].routeKm,40.25);
  assert.equal(result.points[0].landmark.name,'Village Hall');
  assert.equal(result.points[0].groupNumber,4);
});

test('a custom agreed pin without route distance stays visible beside the next route pin', () => {
  const custom={id:'custom-1',name:'Agreed car park',lat:52.1,lng:-1.1,routeKm:null};
  const result=run({progressKm:12,selected:custom});
  assert.deepEqual(result.points.map(p=>p.id),['custom-1','p2']);
  assert.equal(result.points[0].agreed,true);
  assert.equal(result.points[0].distanceKm,null);
  assert.equal(result.endKm,22);
});

test('view ends at the planned finish and rejects invalid or beyond-finish pins', () => {
  const result=run({progressKm:49,points:[...points,pin('p6',70,6),{...pin('invalid',51,7),lat:1000}]});
  assert.deepEqual(result.points.map(p=>p.id),['p5']);
  assert.equal(result.endKm,55);
  const complete=run({progressKm:60});
  assert.equal(complete.fromKm,55);
  assert.equal(complete.endKm,55);
  assert.deepEqual(complete.points,[]);
});

test('first real pins can extend beyond 20 km without invented placeholders', () => {
  const result=plan({points:[pin('p1',31.5),pin('p2',37.1)],progressKm:null,planningEndKm:106});
  assert.equal(result.endKm,37.6);
  assert.deepEqual(result.points.map(p=>p.routeKm),[31.5,37.1]);
  assert.equal(result.points[0].distanceKm,null);
});

test('optional charging stops never become automatic Next or Then, but an agreed charger takes priority',()=>{
  const ev={...pin('ev-bowen',15,'ev-bowen'),kind:'ev-support-option',optionalMeetup:true,pointNumber:'ϟ',landmark:{name:'Bowen Square charger'}};
  const sibling={...pin('ev-village',10.1,1),kind:'ev-support-option',optionalMeetup:true,pointNumber:'ϟ'};
  const input={points:[...points,ev,sibling],planningEndKm:55,progressKm:5};
  assert.deepEqual(plan(input).points.map(p=>p.id),['p1','p2']);
  assert.deepEqual(plan(input).points[0].alternatives,[],'the runner does not see unchosen charging choices');
  const agreed=plan({...input,selected:{id:ev.id,label:'Our charging stop',lat:ev.lat,lng:ev.lng,routeKm:ev.routeKm}});
  assert.deepEqual(agreed.points.map(p=>p.id),['ev-bowen','p2']);
  assert.equal(agreed.points[0].optionalMeetup,true,'canonical optional metadata survives a small shared payload');
  assert.equal(agreed.points[0].agreed,true);
  assert.equal(agreed.points[0].landmark.name,'Bowen Square charger');
  assert.deepEqual(plan({...input,selected:ev,progressKm:15.2}).points.map(p=>p.id),['p2','p3']);
  assert.deepEqual(plan({...input,selected:sibling}).points.map(p=>p.id),['ev-village','p2'],'chosen EV alternative occupies the existing checkpoint group');
});
