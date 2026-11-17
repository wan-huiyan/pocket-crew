import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/competitors.js',import.meta.url),'utf8');
const archive=JSON.parse(readFileSync(new URL('../public/data/meriden-final-standings-2026.json',import.meta.url),'utf8'));
const guideMarkup=readFileSync(new URL('../guide/index.html',import.meta.url),'utf8');

async function archivedGuide(){
  const elements=new Map(),events=[];
  const document={
    querySelector(selector){
      if(!elements.has(selector))elements.set(selector,{value:'',checked:false,innerHTML:'',textContent:'',hidden:false,addEventListener(){},setAttribute(){}});
      return elements.get(selector);
    },
    addEventListener(){},
  };
  const window={addEventListener(){},dispatchEvent(event){events.push(event);}};
  const context={document,window,Date,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame:fn=>fn(),
    fetch:async()=>({ok:true,json:async()=>archive})};
  vm.runInNewContext(source,context,{filename:'competitors.js'});
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return {elements,api:window.competitorGuide,events};
}

test('archived results use one provenance date and omit repeated live-style badges',async()=>{
  const {elements,api}=await archivedGuide();
  assert.equal(api.getSnapshot().status,'archived');
  assert.equal(api.getSnapshot().allCompetitors.length,282);
  assert.match(elements.get('#leaderboard-summary').innerHTML,/14 November 2026/);
  assert.match(guideMarkup,/ESCAPE FROM MERIDEN 2026 · ARCHIVED RESULTS/);
  assert.doesNotMatch(guideMarkup,/Saved Trail Live standings from <strong>14 November 2026<\/strong>/,'do not duplicate the batch date in the method note');
  const podium=elements.get('#leaderboard-podium').innerHTML;
  const rest=elements.get('#leaderboard-list').innerHTML;
  const favourites=elements.get('#competitor-followed').innerHTML;
  assert.match(podium,/Emily Simmons/);
  assert.match(podium,/Clare Farrell/);
  assert.match(rest,/Alice Coffman/);
  for(const entry of [podium,rest,favourites]){
    assert.doesNotMatch(entry,/Distance recorded|Saved 14 November 2026|2026 archive|Still running/);
  }
  assert.match(rest,/#273/);
  assert.match(rest,/No recorded distance/,'missing values remain explicitly labelled');
});

test('mixed-category archive shows category per entrant without per-row archive labels',async()=>{
  const {elements,api}=await archivedGuide();
  api.setCompareOverall(true);
  const rest=elements.get('#leaderboard-list').innerHTML;
  assert.match(elements.get('#leaderboard-summary').innerHTML,/282 entrants/);
  assert.match(elements.get('#leaderboard-emily-overall').innerHTML,/#24 of 282/);
  assert.match(rest,/#247 · Female solo/);
  assert.doesNotMatch(rest,/2026 archive|Distance recorded|Saved 14 November 2026/);
});
