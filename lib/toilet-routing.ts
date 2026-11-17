/** Read-only, batched road travel times to this guide's fixed WC/café candidate pins. */
import facilities from '../public/data/facilities.json' with { type: 'json' };

const PROVIDER='https://routing.openstreetmap.de/routed-car/table/v1/driving/';
const SITE='https://emily-jeff-meriden-crew.whylaura413.chatgpt.site';
const MAX_AGE=5*60_000,CACHE_TTL=5*60_000,MAX_BODY=8192,MAX_POINTS=40,LEASE_TIME=15_000,PROVIDER_GAP=1100;
type Origin={lat:number;lng:number;recordedAt:string};
type Destination={id:string;lat:number;lng:number};
type Travel={id:string;durationSeconds:number|null;distanceMetres:number|null};
type Result={status:string;computedAt:string;origin:{lat:number;lng:number};destinations:Travel[];provider:string;traffic:false};
type Batch={value:Result;cached:boolean};
type CacheRow={cache_key:string|null;expires_at:number;result_json:string|null};
const destinations=new Map<string,Destination>((facilities.pois as Array<{id:string;kinds:string[];possibleToilet?:boolean;lat:number;lng:number}>).filter(p=>(p.kinds.includes('toilet')||p.possibleToilet===true)&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).map(p=>[p.id,{id:p.id,lat:p.lat,lng:p.lng}]));
const cache=new Map<string,{expires:number;value:Result}>();
const pending=new Map<string,Promise<Batch>>();
class RoutingError extends Error {
 readonly reason:string;readonly status:number;
 constructor(reason:string,status=503){super(reason);this.reason=reason;this.status=status;}
}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const number=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
function readOrigin(value:unknown,now:number):Origin|null{
 const p=record(value);if(!p)return null;
 const lat=number(p.lat,49,61),lng=number(p.lng,-9,3),at=typeof p.recordedAt==='string'?Date.parse(p.recordedAt):NaN;
 if(lat===null||lng===null||!Number.isFinite(at)||at<now-MAX_AGE||at>now+30_000)return null;
 return {lat,lng,recordedAt:new Date(at).toISOString()};
}
async function query(origin:Origin,points:Destination[]):Promise<Result>{
 const coords=[origin,...points].map(p=>p.lng.toFixed(5)+','+p.lat.toFixed(5)).join(';');
 const indices=points.map((_,i)=>i+1).join(';');
 const response=await fetch(PROVIDER+coords+'?sources=0&destinations='+indices+'&annotations=duration,distance',{
  headers:{Accept:'application/json','User-Agent':'CrowCrew/1.0 (+https://emily-jeff-meriden-crew.whylaura413.chatgpt.site)','Referer':SITE+'/'},
  signal:AbortSignal.timeout(8000),redirect:'manual',cache:'no-store'
 });
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('routing-unavailable');
 if(Number(response.headers.get('content-length'))>200_000)throw Error('routing-unavailable');
 const reader=response.body?.getReader();if(!reader)throw Error('routing-unavailable');
 const decoder=new TextDecoder();let text='',bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>200_000){await reader.cancel();throw Error('routing-unavailable');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 const data=record(JSON.parse(text));
 if(data?.code!=='Ok'||!Array.isArray(data.durations)||!Array.isArray(data.distances)||!Array.isArray(data.sources)||!Array.isArray(data.destinations))throw Error('routing-unavailable');
 const durations=data.durations[0],distances=data.distances[0];
 if(!Array.isArray(durations)||!Array.isArray(distances)||durations.length!==points.length||distances.length!==points.length||data.destinations.length!==points.length)throw Error('routing-unavailable');
 const source=record(data.sources[0]);if(!source||number(source.distance,0,500)===null)throw Error('origin-not-on-road');
 const rows=points.map((p,i)=>{
  const dest=record((data.destinations as unknown[])[i]);
  const near=dest&&number(dest.distance,0,500)!==null;
  const duration=number(durations[i],0,6*3600),distance=number(distances[i],0,400_000);
  return {id:p.id,durationSeconds:near&&distance!==null?duration:null,distanceMetres:near&&duration!==null?distance:null};
 });
 return {status:'ready',computedAt:new Date().toISOString(),origin:{lat:origin.lat,lng:origin.lng},destinations:rows,provider:'OSRM / FOSSGIS · OpenStreetMap',traffic:false};
}
async function sharedBatch(db:D1Database,origin:Origin,points:Destination[],key:string):Promise<Batch>{
 const now=Date.now();
 // These statements use the primary D1 connection, rather than read replicas.
 // One shared row covers every viewer and Worker isolate on this Site.
 const stored=await db.prepare('SELECT cache_key, expires_at, result_json FROM toilet_routing_cache WHERE id = 1').first<CacheRow>();
 if(stored?.cache_key===key&&stored.expires_at>now&&stored.result_json){
  try{const value=JSON.parse(stored.result_json) as Result;if(value.status==='ready'&&Date.parse(value.computedAt)>=now-CACHE_TTL&&Array.isArray(value.destinations))return {value,cached:true};}catch{}
 }
 const token=crypto.randomUUID();
 const lease=await db.prepare('INSERT INTO toilet_routing_cache (id, lease_until, lease_token) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET lease_until = excluded.lease_until, lease_token = excluded.lease_token WHERE toilet_routing_cache.lease_until <= ?').bind(now+LEASE_TIME,token,now).run();
 if(lease.meta.changes!==1)throw new RoutingError('retry-later',429);
 try{
  // Expired GPS-origin cache payloads are removed before requesting a new batch.
  await db.prepare('UPDATE toilet_routing_cache SET cache_key = NULL, expires_at = 0, result_json = NULL WHERE id = 1 AND lease_token = ? AND expires_at <= ?').bind(token,now).run();
  const value=await query(origin,points),finished=Date.now();
  await db.prepare('UPDATE toilet_routing_cache SET cache_key = ?, expires_at = ?, result_json = ?, lease_until = ?, lease_token = NULL WHERE id = 1 AND lease_token = ?').bind(key,finished+CACHE_TTL,JSON.stringify(value),finished+PROVIDER_GAP,token).run();
  return {value,cached:false};
 }catch(error){
  // Keep a full gap after any upstream attempt. A failed release retains the
  // 15-second lease, so storage trouble cannot cause unthrottled routing calls.
  await db.prepare('UPDATE toilet_routing_cache SET lease_until = ?, lease_token = NULL WHERE id = 1 AND lease_token = ?').bind(Date.now()+PROVIDER_GAP,token).run().catch(()=>{});
  throw error;
 }
}
export async function handleToiletArrivals(request:Request,db:D1Database|undefined){
 const originHeader=request.headers.get('origin');
 if(originHeader&&originHeader!==new URL(request.url).origin)return json({status:'unavailable',reason:'origin'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return json({status:'unavailable',reason:'json-required'},415);
 if(Number(request.headers.get('content-length'))>MAX_BODY)return json({status:'unavailable',reason:'too-large'},413);
 let input:Record<string,unknown>|null;
 try{const body=await request.text();if(body.length>MAX_BODY)return json({status:'unavailable',reason:'too-large'},413);input=record(JSON.parse(body));}catch{return json({status:'unavailable',reason:'invalid-request'},400);}
 const now=Date.now(),origin=readOrigin(input?.origin,now),ids=input?.ids;
 if(!origin)return json({status:'unavailable',reason:'fresh-crew-position-required'},400);
 if(!Array.isArray(ids)||!ids.length||ids.length>MAX_POINTS||ids.some(id=>typeof id!=='string'||!destinations.has(id))||new Set(ids).size!==ids.length)return json({status:'unavailable',reason:'known-toilet-ids-required'},400);
 if(!db)return json({status:'unavailable',reason:'routing-unavailable'},503);
 const points=(ids as string[]).slice().sort().map(id=>destinations.get(id)!);
 // Include the deployed coordinates so an updated dataset cannot reuse old pins.
 const key='v1:'+origin.lat.toFixed(3)+','+origin.lng.toFixed(3)+':'+points.map(p=>p.id+'@'+p.lat.toFixed(5)+','+p.lng.toFixed(5)).join(';');
 const hit=cache.get(key);if(hit&&hit.expires>now)return json({...hit.value,cached:true});
 if(pending.has(key)){try{const result=await pending.get(key)!;return json({...result.value,cached:true});}catch(error){return json({status:'unavailable',reason:error instanceof RoutingError?error.reason:'routing-unavailable'},error instanceof RoutingError?error.status:503);}}
 const work=sharedBatch(db,origin,points,key);pending.set(key,work);
 try{
  const {value,cached}=await work;cache.set(key,{expires:Date.parse(value.computedAt)+CACHE_TTL,value});
  for(const [k,v]of cache)if(v.expires<Date.now()||cache.size>24)cache.delete(k);
  return json({...value,cached});
 }catch(error){return json({status:'unavailable',reason:error instanceof RoutingError?error.reason:'routing-unavailable'},error instanceof RoutingError?error.status:503);}finally{pending.delete(key);}
}
