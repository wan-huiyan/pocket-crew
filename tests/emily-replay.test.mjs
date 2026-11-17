import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=async file=>readFile(new URL('../'+file,import.meta.url),'utf8');
const data=JSON.parse(await read('public/data/emily-replay-2026.json'));

test('Emily’s complete official tracker is archived and chronologically replayable',()=>{
 assert.equal(data.final.fixes,712);
 assert.equal(data.fixes.length,712);
 assert.equal(data.final.crowKm,106.498);
 assert.ok(data.final.gpsPathKm>115&&data.final.gpsPathKm<121);
 assert.equal(data.final.femaleSoloPlace,2);
 assert.equal(data.fixes[0][0],0);
 assert.ok(data.fixes.at(-1)[0]>=23*3600);
 for(let i=1;i<data.fixes.length;i++){
  // The tracker occasionally emits two distinct fixes with the same second.
  assert.ok(data.fixes[i][0]>=data.fixes[i-1][0]);
  assert.ok(data.fixes[i][3]>=data.fixes[i-1][3]);
 }
});

test('crew check-ins are preserved without pretending durations are stopwatch readings',()=>{
 assert.equal(data.meetings.length,11);
 assert.equal(data.milestones.length,10);
 for(const meeting of data.meetings){
  assert.equal(meeting.recorded,'crew check-in');
  assert.ok(meeting.durationMinutes===null||meeting.durationMinutes>0);
  assert.match(meeting.durationNote,/GPS|stopped duration/i);
 }
 const people=new Set(data.stories.flatMap(s=>s.people));
 for(const name of ['emily','jeff','graham','ben','susan','huiyan'])assert.ok(people.has(name));
 const raw=JSON.stringify(data);
 assert.doesNotMatch(raw,/supporters\s*":|accuracy\s*":|googleMapsUrl|tracker.*token/i);
});

test('site gives the replay a direct route and downloadable final celebration',async()=>{
 const index=await read('guide/index.html');
 const html=await read('public/replay.html');
 const js=await read('public/replay.js');
 assert.match(index,/href="replay.html"/);
 assert.match(html,/emily-final-2026\.png/);
 assert.match(js,/data\/emily-replay-2026\.json/);
 assert.match(js,/replay-scrub/);
 assert.match(html,/Meet-ups/);
});

test('the tracking guide is home while the celebration and replay remain accessible',async()=>{
 const route=await read('app/route.ts');
 const home=await read('guide/celebration-home.html');
 const guide=await read('public/crew.html');
 const root=await read('public/index.html');
 const bonus=await read('public/celebration.html');
 assert.match(route,/guide\/index\.html\?raw/);
 assert.match(root,/id="race-map"/);
 assert.match(root,/id="leaderboard-category"/);
 assert.equal(root,guide);
 assert.equal(bonus,home);
 assert.match(home,/emily-final-2026\.webp/);
 assert.match(home,/leaderboard\.html/);
 assert.match(home,/replay\.html/);
 assert.match(home,/details class="old-entry"/);
 assert.match(home,/href="crew\.html"/);
 assert.match(guide,/replay\.html/);
});

test('public leaderboard preserves every tracker category and the correct podium hierarchy',async()=>{
 const standings=JSON.parse(await read('public/data/meriden-final-standings-2026.json'));
 const page=await read('public/leaderboard.html');
 const script=await read('public/leaderboard.js');
 assert.equal(standings.totalUniqueEntrants,282);
 assert.deepEqual(Object.fromEntries(Object.entries(standings.categories).map(([k,v])=>[k,v.length])),{
  all:282,'female-solo':36,'male-solo':152,pair:67,chained:22,other:5
 });
 const women=standings.categories['female-solo'];
 assert.deepEqual(women.slice(0,3).map(e=>e.name),['Clare Farrell','Emily Simmons','Elly Roberts']);
 assert.equal(women[1].crowKm,106.498);
 assert.equal(standings.categories.all.find(e=>e.bib==='247')?.rank,24);
 assert.equal(standings.categories.all.filter(e=>e.crowKm===null).length,4);
 assert.match(script,/Number\.isFinite\(entry\.crowKm\)/);
 assert.match(script,/e\.rank==null\?'—'/);
 assert.match(script,/\[top\[1\],top\[0\],top\[2\]\]/);
 assert.match(script,/\[95,147,65\]/);
 assert.match(page,/id="compare-everyone"/);
 assert.match(page,/id="leader-search"/);
});

test('storybook preserves all matching historical crow paths, animated scenes and map controls',async()=>{
 const peer=JSON.parse(await read('public/data/emily-peer-crows-2026.json'));
 const page=await read('public/replay.html');
 const script=await read('public/replay.js');
 assert.equal(peer.screenedPaths,70);
 assert.equal(peer.matchingTracks,35);
 assert.equal(peer.tracks.length,35);
 for(const track of peer.tracks){
  assert.ok(track.overlapKm>=15);
  assert.ok(track.fixes.length>5);
  for(let i=1;i<track.fixes.length;i++)assert.ok(track.fixes[i][0]>=track.fixes[i-1][0]);
 }
 for(const scene of ['midnight','sunrise','daylight','dusk','finish']){
  await read('public/assets/storybook/'+scene+'.webp');
  assert.match(script,new RegExp("scene:'"+scene+"'"));
 }
 assert.match(page,/id="show-peers"/);
 assert.match(page,/id="avatar-theatre"/);
 assert.match(page,/id="stat-travelled"/);
 assert.match(page,/id="stat-pauses"/);
 assert.match(page,/download="Meriden-2026-fellow-escapees.json"/);
 assert.match(script,/peerPosition\(track,sec\)/);
 assert.match(script,/showSceneMoment/);
});
