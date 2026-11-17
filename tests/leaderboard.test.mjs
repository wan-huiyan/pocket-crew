import assert from 'node:assert/strict';
import test from 'node:test';

const url=new URL('../app/api/tracker/route.ts',import.meta.url);
let caseId=0;
const date=()=>new Date(Date.now()-60000).toISOString();
const event=(change={})=>({event:{id:35950,slug:'escapefrommeriden',start:'2026-11-13T00:00:00Z',active:true,...change}});
const person=(bib,name,group,ageCategory,crowKm,updatedAt=date())=>({
  bib,name,group,ageCategory,tracker:'PRIVATE-DEVICE-KEY',
  lastReport:{lat:52.4,lon:-1.1,timestamp:updatedAt},
  routes:[{dist:crowKm,speed:42}],
});
async function setup(meta,entries,pathEntries=[]){
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async link=>{calls.push(String(link));return Response.json(String(link).endsWith('/path')?pathEntries:String(link).endsWith('/participants')?entries:meta);};
  const {GET_LEADERBOARD}=await import(url.href+'?leaderboard='+caseId++);
  return {
    async read(follow='',category='female-solo'){const result=await GET_LEADERBOARD(new Request('https://guide.example/api/leaderboard?follow='+follow+'&category='+category));return result.json();},
    calls,
    restore(){globalThis.fetch=original;}
  };
}

test('female Solo leaderboard sorts by official crow-flight km and includes only category F Solo',async()=>{
  const rows=[person('247','Emily','Solo','F',95.8),person('56','Rebecca','Solo','F',96.5),
    person('210','Matt','Solo','M',100),person('101','A duo','Pair','F',101),person('77','Third','Solo','F',92.2)];
  const f=await setup(event(),rows);
  try{
    const value=await f.read('210,56');
    assert.equal(value.metric,'crow-flight-km');assert.equal(value.status,'live');
    assert.deepEqual(value.femaleSolo.map(p=>[p.bib,p.rank,p.crowKm]),[['56',1,96.5],['247',2,95.8],['77',3,92.2]]);
    assert.deepEqual(value.followed.map(p=>p.bib),['210','56']);
    assert.equal(value.roster.length,5);
    assert.deepEqual(value.allCompetitors.map(p=>[p.bib,p.rank,p.crowKm]),[['101',1,101],['210',2,100],['56',3,96.5],['247',4,95.8],['77',5,92.2]]);
    assert(value.allCompetitors.every(p=>!Object.hasOwn(p,'lat')&&!Object.hasOwn(p,'lng')),'bulk standings must not expose participant locations');
    assert(value.allCompetitors.every(p=>p.hasValidLocation===true));
    assert.equal(value.allCompetitors.find(p=>p.bib==='247').rank,4,'unofficial cross-category rank compares everyone');
    assert(!JSON.stringify(value).includes('PRIVATE-DEVICE-KEY'));
    assert(!JSON.stringify(value).includes('"speed":42'));
    assert(!f.calls.some(link=>link.endsWith('/path')),'standings must not request large private path histories');
  }finally{f.restore();}
});

test('no event identity match means no competitor positions, and inactive event stays waiting',async()=>{
  let f=await setup(event({start:'2025-11-13T00:00:00Z'}),[person('247','Emily','Solo','F',80)]);
  try{assert.equal((await f.read()).status,'wrong-event');assert.equal(f.calls.length,1);}finally{f.restore();}
  f=await setup(event({active:false}),[person('247','Emily','Solo','F',80)]);
  try{const value=await f.read();assert.equal(value.status,'waiting');assert.equal(value.femaleSolo.length,0);assert.equal(f.calls.length,1);}finally{f.restore();}
});

test('invalid, ambiguous and future GPS reports do not create trusted map locations',async()=>{
  const f=await setup(event(),[
    person('247','Emily','Solo','F',80,new Date(Date.now()+10*60000).toISOString()),
    person('56','One','Solo','F',81),person('56','Duplicate','Solo','F',82),
    {...person('90','No GPS','Solo','F',79),lastReport:null}
  ]);
  try{
    const value=await f.read('56,90');
    assert.equal(value.femaleSolo.length,2);
    assert.equal(value.femaleSolo.find(p=>p.bib==='247').updatedAt,null);
    assert.equal(value.femaleSolo.find(p=>p.bib==='247').lat,null);
    assert.equal(value.femaleSolo.find(p=>p.bib==='90').updatedAt,null);
    assert.deepEqual(value.followed.map(p=>p.bib),['90']);
    const invalid=await f.read('210,/secret');assert.equal(invalid.status,'need-number');
    const badCategory=await f.read('','unrecognised');assert.equal(badCategory.status,'need-number');
  }finally{f.restore();}
});

test('category selection stays separate from the map while the API provides all group standings',async()=>{
  const rows=[person('247','Emily','Solo','F',95),person('210','Matt','Solo','M',99),person('301','Chained friends','Chained','',101),person('407','Two runners','Pair','',100),person('408','Solo friend','Solo','M',80)];
  const f=await setup(event(),rows);
  try{
    for(const category of ['female-solo','male-solo','pair','chained','other','all']){
      const value=await f.read('210',category);
      assert.equal(value.status,'live');
      assert.equal(value.allCompetitors.length,5);
      assert.equal(value.allCompetitors[0].bib,'301');
      assert.equal(value.allCompetitors.find(p=>p.bib==='247').rank,4);
      assert(!value.allCompetitors.some(p=>Object.hasOwn(p,'lat')));
    }
    assert.equal((await f.read('210','all')).followed[0].lat,52.4,'only explicitly followed competitors retain coordinates');
  }finally{f.restore();}
});

test('a bounded fresh GPS path produces an optional moving pace without revealing historical positions',async()=>{
  const lastTime=Date.now()-60000;
  const samples=Array.from({length:7},(_,i)=>{
    const timestamp=new Date(lastTime-(6-i)*2*60000).toISOString();
    return {lat:52.4+i*.0015,lon:-1.1,timeLocal:timestamp,gnssTime:timestamp,deviceKey:'PRIVATE-PATH-DEVICE'};
  });
  const fresh={...person('247','Emily','Solo','F',102.8,new Date(lastTime).toISOString()),id:24742};
  const old={...person('56','Old GPS','Solo','F',101.1,new Date(lastTime-2*3600000).toISOString()),id:56000};
  const f=await setup(event(),[fresh,old],samples);
  try {
    const value=await f.read();
    const emily=value.femaleSolo.find(p=>p.bib==='247');
    assert(emily.paceMinPerKm>9&&emily.paceMinPerKm<15);
    assert.equal(emily.paceAsOf,fresh.lastReport.timestamp);
    assert.equal(value.femaleSolo.find(p=>p.bib==='56').paceMinPerKm,undefined);
    assert(f.calls.some(link=>link.endsWith('/participants/24742/path')));
    assert(!f.calls.some(link=>link.endsWith('/participants/56000/path')));
    assert(!JSON.stringify(value).includes('PRIVATE-PATH-DEVICE'));
    assert(!JSON.stringify(value).includes('recentReports'));
    assert(!JSON.stringify(value).includes('paceReports'));
  }finally{f.restore();}
});

