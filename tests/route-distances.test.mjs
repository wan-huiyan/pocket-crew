import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/route-distances.js',import.meta.url),'utf8');
const points=JSON.parse(readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
const guide=JSON.parse(readFileSync(new URL('../public/data/guide-data.json',import.meta.url),'utf8'));
const html=readFileSync(new URL('../guide/index.html',import.meta.url),'utf8');
const poster=readFileSync(new URL('../guide/poster-home.html',import.meta.url),'utf8');
const support=readFileSync(new URL('../public/support.js',import.meta.url),'utf8');
const map=readFileSync(new URL('../public/map-first.js',import.meta.url),'utf8');
function calculator(){const context={window:{}};vm.runInNewContext(source,context);return context.window.routeDistances;}

test('Meriden Cross origin and every mapped meeting choice have finite crow-flight distances',()=>{
  const distances=calculator();
  assert.equal(distances.crowKm(guide.crowDistanceOrigin),0);
  assert.equal(distances.setOrigin(guide.crowDistanceOrigin),true);
  const all=points.groups.flatMap(g=>g.options).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));
  assert(all.length>=23,'historic point groups are retained');
  for(const point of all){
    const crow=distances.crowKm(point);
    assert(Number.isFinite(crow)&&crow>=0&&crow<180,point.id+' has a bounded crow distance');
    if(Number.isFinite(point.routeKm)&&point.routeKm>15)assert(crow<=point.routeKm+2,point.id+' crow distance is not mistaken for travelled route distance');
  }
});

test('invalid origins and unmapped custom points never invent crow-flight kilometres',()=>{
  const distances=calculator(),original=distances.getOrigin();
  assert.equal(distances.setOrigin({lat:200,lng:0}),false);
  assert.equal(distances.getOrigin().lat,original.lat);
  assert.equal(distances.crowKm({routeKm:90,mapUrl:'https://maps.app.goo.gl/example'}),null);
});

test('both home shells expose two progress stats, and all point surfaces expose both distance measures',()=>{
  for(const shell of [html,poster])for(const id of ['map-route-distance','map-crow-distance'])assert(shell.includes('id="'+id+'"'),id+' must render in both skins');
  assert(html.includes('route-distances.js'));
  assert(support.includes('distanceMarkup(p)'));
  assert(support.includes('Crow flight from Meriden'));
  assert(map.includes('meetingDistanceCards(p)'));
  assert(map.includes('crow flight · official'));
});
