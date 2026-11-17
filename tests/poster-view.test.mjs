import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/poster-view.js',import.meta.url),'utf8');
const markup=readFileSync(new URL('../guide/poster-home.html',import.meta.url),'utf8');
const people=['emily','jeff','huiyan','graham','ben'];
function load(snapshot={}, {hasLocationControls=true,hasPersonDetails=true}={}){
  const elements=new Map(),listeners=new Map(),clicks=[],cards=new Map(),prevented=[];
  const element=(tagName='SPAN')=>({
    tagName,hidden:false,textContent:'',className:'',dataset:{},childNodes:[],attributes:{},
    classList:{values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);},contains(name){return this.values.has(name);}},addEventListener(){},
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},
    replaceChildren(...children){this.childNodes=children;},replaceWith(next){cards.set(this.dataset.posterPerson,next);},focus(){}
  });
  const q=selector=>{
    const person=selector.match(/^\[data-poster-person="(\w+)"\]$/)?.[1];
    if(person)return cards.get(person);
    if(!elements.has(selector))elements.set(selector,element());
    return elements.get(selector);
  };
  for(const person of people){
    const card=element('BUTTON');card.className='poster-person-card';card.dataset.posterPerson=person;
    card.childNodes=[q(`#poster-${person}-status`),q(`#poster-${person}-dot`)];cards.set(person,card);
  }
  const document={querySelector:q,createElement:tag=>element(tag.toUpperCase()),body:element(),
    addEventListener(type,fn){listeners.set('document:'+type,fn);}};
  const context={Date,Number,document,MutationObserver:class{observe(){}},
    switchTab:tab=>clicks.push(tab),
    window:{...(hasPersonDetails?{raceMap:{openPerson:id=>clicks.push('details:'+id)}}:{}),liveGuide:{getSnapshot:()=>snapshot,showCrewOnMap:()=>clicks.push('legacy-crew-map'),showRunnersOnMap:()=>clicks.push('runner-map'),showRunnerOnMap:id=>clicks.push(id+'-map'),...(hasLocationControls?{showCrewLocationControls:()=>clicks.push('location-controls')}:{})},
      addEventListener(type,fn){listeners.set(type,fn);}}};
  vm.runInNewContext(source,context,{filename:'poster-view.js'});
  return {q,card:person=>cards.get(person),clicks,prevented,update:next=>listeners.get('liveupdate')({detail:next}),
    click(person){listeners.get('document:click')({target:{closest:selector=>selector==='[data-poster-person]'?cards.get(person):null},preventDefault(){prevented.push(person);}});}};
}

test('poster footer gives all five people their own transparent avatar and named control',()=>{
  const controls=[...markup.matchAll(/<button\b[^>]*data-poster-person="(\w+)"[^>]*>(.*?)<\/button>/g)];
  assert.deepEqual(controls.map(match=>match[1]),people);
  for(const [,person,contents] of controls){
    assert.equal((contents.match(/<img\b/g)||[]).length,1);
    assert(contents.includes(`assets/avatars-v5/${person}.webp`));
    assert.match(contents,new RegExp(`<strong>${person[0].toUpperCase()+person.slice(1)}<\\/strong>`));
  }
});

test('all four supporter controls stay on site with saved Maps links and missing or stale GPS',()=>{
  const googleMapsUrl='https://maps.app.goo.gl/test-live-location',supporters=['huiyan','graham','jeff','ben'];
  for(const room of [{owner:false},{owner:true},{owner:false,canShareLocation:true}]){
    const f=load({googleMapsUrl,room}),waiting=room.owner||room.canShareLocation?'Update location':'Awaiting location';
    for(const person of supporters){
      assert.equal(f.card(person).tagName,'BUTTON');assert.equal(f.card(person).href,undefined);assert.equal(f.card(person).target,undefined);
      assert.equal(f.q(`#poster-${person}-status`).textContent,waiting);
      assert.match(f.card(person).attributes['aria-label'],/own phone location.*Open location details and sharing controls on this site/);
      assert.doesNotMatch(f.card(person).attributes['aria-label'],/Google Maps|133/);f.click(person);
    }
    const crew={lat:52,lng:-.85,fresh:false,sharing:false,recordedAt:new Date(Date.now()-600000).toISOString(),updatedAt:new Date().toISOString()};
    f.update({googleMapsUrl,room,crew});
    for(const person of supporters){
      assert.equal(f.card(person).tagName,'BUTTON');
      assert.equal(f.q(`#poster-${person}-status`).textContent,person==='huiyan'?'Paused · 10 min ago':waiting,'only Huiyan can retain a legacy crew report');f.click(person);
    }
    assert.deepEqual(f.clicks,[...supporters,...supporters].map(id=>'details:'+id));
    assert.deepEqual(f.prevented,[...supporters,...supporters]);
  }
});

test('supporter cards fall back to the Live panel while location controls load',()=>{
  const f=load({googleMapsUrl:'https://maps.app.goo.gl/test-live-location'},{hasLocationControls:false,hasPersonDetails:false});
  f.click('huiyan');f.click('graham');
  assert.deepEqual(f.clicks,['live','live'],'the legacy map action is never used for supporters');
});

test('Emily’s tracker and all four supporters retain their own report and freshness',()=>{
  const updatedAt=new Date().toISOString();
  const runner={lat:52,lng:-.85,fresh:true,updatedAt};
  const huiyan={lat:52.01,lng:-.86,fresh:true,sharing:true,recordedAt:new Date(Date.now()-120000).toISOString(),updatedAt};
  const graham={lat:52.001,lng:-.851,fresh:true,sharing:true,recordedAt:updatedAt,updatedAt};
  const jeff={...huiyan,lat:52.002,recordedAt:new Date(Date.now()-60000).toISOString()};
  const ben={...huiyan,lat:52.003,recordedAt:new Date(Date.now()-30000).toISOString()};
  const snapshot={runner,runners:{emily:runner},crew:huiyan,supporters:{huiyan,graham,jeff,ben}};
  const f=load(snapshot);
  for(const person of people){
    assert.equal(f.card(person).tagName,'BUTTON');assert.equal(f.q(`#poster-${person}-dot`).classList.contains('fresh'),true);
    assert.match(f.card(person).attributes['aria-label'],person==='emily'?/runner tracker/:/own phone location/);f.click(person);
  }
  assert.deepEqual(f.clicks,people.map(id=>'details:'+id));
  assert.equal(f.q('#poster-huiyan-status').textContent,'Sharing · 2 min ago');
  assert.equal(f.q('#poster-graham-status').textContent,'Sharing · just now');
  assert.equal(f.q('#poster-jeff-status').textContent,'Sharing · 1 min ago');
  assert.equal(f.q('#poster-ben-status').textContent,'Sharing · just now');
  f.update({...snapshot,supporters:{huiyan:{...huiyan,sharing:false},graham,jeff,ben}});
  assert.equal(f.q('#poster-huiyan-dot').classList.contains('fresh'),false);
  for(const person of ['emily','graham','jeff','ben'])assert.equal(f.q(`#poster-${person}-dot`).classList.contains('fresh'),true,'stopping Huiyan does not stop another feed');
  assert.equal(f.q('#poster-huiyan-status').textContent,'Paused · 2 min ago');
});

test('walking supporters show a tracker-derived status while own-phone GPS remains independent',()=>{
  const now=Date.now(),at=new Date(now-60000).toISOString();
  const emily={lat:52,lng:-.85,recordedAt:at,fresh:true};
  const huiyan={lat:52.01,lng:-.86,recordedAt:at,sharing:true,fresh:true};
  const base={runners:{emily},supporters:{huiyan,jeff:null},supporterPlans:{huiyan:{mode:'walking'},jeff:{mode:'walking'}}};
  const f=load(base);
  for(const id of ['huiyan','jeff']){
    assert.match(f.q(`#poster-${id}-status`).textContent,/With Emily · tracker 1 min ago/);
    assert.match(f.card(id).attributes['aria-label'],/via Emily’s official tracker, not .*own phone GPS/i);
    assert.equal(f.q(`#poster-${id}-dot`).classList.contains('fresh'),true);
  }
  f.update({...base,supporterPlans:{huiyan:{mode:'meeting'},jeff:{mode:'meeting'}}});
  assert.equal(f.q('#poster-huiyan-status').textContent,'Sharing · 1 min ago');
  assert.equal(f.q('#poster-jeff-status').textContent,'Awaiting location');
  f.update({...base,runners:{emily:{...emily,recordedAt:new Date(now-600000).toISOString()}}});
  assert.equal(f.q('#poster-huiyan-status').textContent,'Sharing · 1 min ago');
  assert.equal(f.q('#poster-jeff-status').textContent,'Awaiting location');
});

test('an explicit missing supporter never borrows the other phone or the legacy crew alias',()=>{
  const updatedAt=new Date().toISOString();
  const huiyan={lat:52,lng:-.85,fresh:true,sharing:true,updatedAt};
  const graham={lat:52.01,lng:-.86,fresh:false,sharing:true,recordedAt:new Date(Date.now()-600000).toISOString(),updatedAt};
  const f=load({crew:huiyan,supporters:{huiyan:null,graham}});
  assert.equal(f.q('#poster-huiyan-status').textContent,'Awaiting location');
  assert.equal(f.q('#poster-huiyan-dot').classList.contains('fresh'),false);
  assert.equal(f.q('#poster-graham-status').textContent,'Last seen 10 min ago','new room metadata never replaces the actual GPS report time');
  assert.equal(f.q('#poster-graham-dot').classList.contains('fresh'),false);
  f.update({crew:huiyan,supporters:{huiyan,graham:null}});
  assert.equal(f.q('#poster-huiyan-status').textContent,'Sharing · just now');
  assert.equal(f.q('#poster-graham-status').textContent,'Awaiting location');
  assert.equal(f.q('#poster-graham-dot').classList.contains('fresh'),false);
});

test('Emily uses bib 247 while Jeff waits for his phone and ignores the former race tracker',()=>{
  const updatedAt=new Date().toISOString();
  const emily={lat:52,lng:-.85,fresh:true,updatedAt},oldJeff={lat:53,lng:-.2,fresh:true,updatedAt};
  const runnerTracking={emily:{bib:'247',name:'Emily Simmons',status:'live'},jeff:{bib:'133',name:'Jeff Simmons',status:'live'}};
  const snapshot={runner:oldJeff,runners:{emily,jeff:oldJeff},runnerTracking,supporters:{jeff:null}};
  const f=load(snapshot);
  assert.equal(f.q('#poster-emily-status').textContent,'Updated just now');assert.equal(f.q('#poster-jeff-status').textContent,'Awaiting location');
  assert.equal(f.q('#poster-emily-dot').classList.contains('fresh'),true);assert.equal(f.q('#poster-jeff-dot').classList.contains('fresh'),false);
  assert.match(f.card('emily').attributes['aria-label'],/Emily Simmons.*race number 247.*Open pace and arrival details/);
  assert.match(f.card('jeff').attributes['aria-label'],/own phone location.*sharing controls/);assert.doesNotMatch(f.card('jeff').attributes['aria-label'],/133|tracker|pace/);
  const phoneJeff={lat:52.001,lng:-.851,fresh:true,sharing:true,recordedAt:new Date(Date.now()-60000).toISOString(),updatedAt};
  f.update({...snapshot,runners:{emily:null,jeff:oldJeff},supporters:{jeff:phoneJeff}});
  assert.equal(f.q('#poster-emily-status').textContent,'Waiting for first report');assert.equal(f.q('#poster-jeff-status').textContent,'Sharing · 1 min ago');
  assert.equal(f.q('#poster-emily-dot').classList.contains('fresh'),false);assert.equal(f.q('#poster-jeff-dot').classList.contains('fresh'),true);
  f.click('emily');f.click('jeff');assert.deepEqual(f.clicks,['details:emily','details:jeff']);
});

test('an unavailable Emily tracker does not change Jeff’s supporter phone status',()=>{
  const updatedAt=new Date().toISOString(),emily={lat:52,lng:-.85,fresh:true,updatedAt},jeff={lat:52.01,lng:-.86,fresh:true,sharing:true,updatedAt};
  const runnerTracking={emily:{bib:'247',name:'Emily Simmons',status:'unavailable'},jeff:{bib:'133',name:'Jeff Simmons',status:'live'}};
  const snapshot={runner:emily,runners:{emily,jeff},runnerTracking,supporters:{jeff}};
  const f=load(snapshot);assert.equal(f.q('#poster-emily-status').textContent,'Last seen just now');assert.equal(f.q('#poster-jeff-status').textContent,'Sharing · just now');
  assert.equal(f.q('#poster-emily-dot').classList.contains('fresh'),false);assert.equal(f.q('#poster-jeff-dot').classList.contains('fresh'),true);
  f.update({...snapshot,runner:jeff,runners:{emily:null,jeff}});
  assert.equal(f.q('#poster-emily-status').textContent,'Tracker unavailable');assert.equal(f.q('#poster-jeff-status').textContent,'Sharing · just now');
});
