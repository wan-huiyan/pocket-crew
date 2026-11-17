'use strict';
(()=>{
 const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={emily:'Emily',jeff:'Jeff',graham:'Graham',ben:'Ben',susan:'Susan',huiyan:'Huiyan'};
 const portraits={emily:'avatars-v5/emily.webp',jeff:'avatars-v5/jeff.webp',graham:'avatars-v5/graham.webp',ben:'avatars-v5/ben.webp',huiyan:'avatars-v5/huiyan.webp'};
 const clock=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
 const fullDate=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'long'}).format(date);
 const MET_ICONS=['☕','🚙','🥤','🧣','❄️','🥨','🧤','🍌','☕','🧣','🥾'];
 let data,fixes=[],events=[],map,crow,line,traveled,meetingMarkers=[],playing=false,speed=1,elapsed=0,lastFrame=0,lastPan=0,lastSpot='',lastEvent=-1,holdUntil=0,finishedShown=false,raf=0,filter='all';
 let peerTracks=[],peerMarkers=[],showPeers=true,lastPeerRender=0,chapterIndex=-1,plateToggle=false;
 const chapters=[
  {at:0,scene:'midnight',title:'The midnight getaway',place:'Meriden · Prison gates open',story:'Some siblings just go for coffee. Emily and Jeff chose a 24-hour escape.',people:['emily','jeff']},
  {at:5.8*3600,scene:'sunrise',title:'Hello, brave new dawn',place:'Dunchurch → Daventry',story:'A frosty sunrise, a marathon of memories and a crew who never stopped cheering.',people:['emily','jeff']},
  {at:9.5*3600,scene:'daylight',title:'The long bright middle',place:'Northamptonshire countryside',story:'Roads, fields, warm drinks and little reunions along the way.',people:['emily','graham','jeff']},
  {at:16.25*3600,scene:'dusk',title:'The golden hour adventure',place:'Toward Bletchley and beyond',story:'One last sunset; the miles become a little harder and the cheers a little louder.',people:['emily','graham','ben','huiyan']},
  {at:21.83*3600,scene:'finish',title:'Gold! The great escape',place:'The final night · Gold distance',story:'Not even November could stop her. Gold distance, second female solo, and one enormous hug!',people:['emily','jeff','graham','ben','huiyan','susan']}
 ];
 const haversine=(a,b)=>{const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lng-a.lng)*rad,x=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
 const total=()=>fixes.at(-1)?.[0]||0;
 const renderPeople=people=>(people||[]).map(id=>'<span class="person-tag">'+(portraits[id]?'<img src="assets/'+portraits[id]+'" alt="">':'<span aria-hidden="true">🏠</span>')+escape(names[id]||id)+'</span>').join('');
 const eventDescription=event=>event.kind==='meeting'
  ?'Crew marked this point “met” at '+clock(new Date(event.at))+'. '+(event.durationMinutes!=null?'Near-stationary GPS cluster lasted about '+event.durationMinutes+' minutes.':'No reliable GPS pause duration could be calculated.')
  :event.text||'Crossing estimated from the official tracker.';
 const stopDuration=e=>e.kind==='meeting'?(e.durationMinutes!=null?'~'+e.durationMinutes+' min GPS pause':'Duration unknown'):null;
 const eventIcon=e=>e.kind==='meeting'?e.icon:e.kind==='milestone'?(e.id==='gold'?'🏆':e.id==='marathon'?'👟':'🏅'):(e.id==='finish'?'🎉':'♡');
 function buildEvents(){
  events=[...data.meetings.map((m,i)=>({...m,kind:'meeting',icon:MET_ICONS[i%MET_ICONS.length],text:eventDescription({...m,kind:'meeting'})})),
    ...data.milestones.map(m=>({...m,kind:'milestone',text:(m.id==='gold'?'Gold-distance boundary: 60 miles as the crow flies!':'Estimated tracker crossing')+' · '+clock(new Date(m.at))+' GMT.'})),
    ...data.stories.map((s,i)=>({...s,id:i===data.stories.length-1?'finish':'crew-'+i,kind:'story'}))]
   .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||({milestone:0,meeting:1,story:2}[a.kind]-{milestone:0,meeting:1,story:2}[b.kind]));
  $('#replay-timeline').innerHTML=events.map((e,i)=>'<li data-kind="'+e.kind+'" data-index="'+i+'"><button type="button" data-jump="'+i+'"><span class="event-symbol" aria-hidden="true">'+eventIcon(e)+'</span><span class="event-body"><span class="event-time">'+clock(new Date(e.at))+' · '+escape(e.kind==='meeting'?'CREW CHECK-IN':e.kind==='milestone'?'TRACKER CROSSING':'CREW STORY')+'</span><strong>'+escape(e.kind==='meeting'?e.title+' · '+e.place:e.title)+'</strong><small>'+escape(eventDescription(e))+'</small>'+(stopDuration(e)?'<span class="duration">'+escape(stopDuration(e))+'</span>':'')+'</span></button></li>').join('');
  $('#replay-timeline').addEventListener('click',event=>{const btn=event.target.closest('[data-jump]');if(!btn)return;pause();const e=events[Number(btn.dataset.jump)];setTime((Date.parse(e.at)-Date.parse(data.firstAt))/1000,{recenter:true,spot:e});document.querySelector('.experience')?.scrollIntoView({behavior:'smooth',block:'start'});});
  $$('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;$$('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$$('#replay-timeline li').forEach(li=>li.hidden=filter!=='all'&&li.dataset.kind!==filter);}));
 }
 function renderCast(people){
  const ids=[...new Set(people||[])];
  $('#avatar-theatre').innerHTML=ids.map((id,i)=>{
   const title=names[id]||id;
   const role=id==='emily'?'Our escapee':id==='susan'?'From home ♡':id==='graham'?'Foot crew':id==='jeff'?'Brother & crew':id==='ben'?'Support driver':'Support crew';
   return '<div class="avatar-chip '+escape(id)+'" style="--order:'+i+'">'+(portraits[id]?'<img src="assets/'+portraits[id]+'" alt="Illustrated avatar of '+escape(title)+'">':'<span class="home-icon" aria-hidden="true">🏠</span>')+'<span class="avatar-role">'+role+'</span><span class="avatar-label">'+escape(title)+'</span></div>';
  }).join('');
 }
 function showChapter(date){
  const hour=elapsed;
  let index=chapters.length-1;
  for(let i=0;i<chapters.length;i++){if(hour<chapters[i].at){index=i-1;break;}}
  index=Math.max(0,index);
  if(index===chapterIndex)return;
  chapterIndex=index;
  const chapter=chapters[index];
  const next=plateToggle?'#plate-a':'#plate-b',previous=plateToggle?'#plate-b':'#plate-a';
  $(next).style.backgroundImage='url("assets/storybook/'+chapter.scene+'.webp")';
  $(next).classList.add('plate-on');$(previous).classList.remove('plate-on');plateToggle=!plateToggle;
  $('#chapter-counter').textContent='CHAPTER '+['ONE','TWO','THREE','FOUR','FIVE'][index]+' OF FIVE';
  $('#chapter-title').textContent=chapter.title;
  $('#chapter-location').textContent=chapter.place;
  $('#chapter-narration').textContent=chapter.story;
  renderCast(chapter.people);
 }
 function showSceneMoment(event){
  const props=$('#stage-props');props.className='stage-props '+(event.kind==='meeting'?'meeting':event.kind==='milestone'?'milestone':event.id==='finish'?'finale':'story');
  props.classList.remove('prop-replay');void props.offsetWidth;props.classList.add('prop-replay');
  if(event.kind==='meeting'){
   const pause=event.durationMinutes!=null?' · about '+event.durationMinutes+' min pause':' · stop duration uncertain';
   $('#chapter-location').textContent='🚙 '+event.place+' · '+clock(new Date(event.at));
   $('#chapter-narration').textContent='A crew hello at '+event.place+pause+'. Hot drinks, warm smiles and off she goes!';
   // An affectionate cast montage: crew identities at a specific stop were not verified.
   const montage=elapsed<7*3600?['emily','jeff']:elapsed<15*3600?['emily','graham','jeff']:['emily','ben','jeff','huiyan'];
   renderCast(montage);
  }else if(event.kind==='milestone'){
   $('#chapter-location').textContent='🏅 '+clock(new Date(event.at))+' · Distance milestone';
   $('#chapter-narration').textContent=event.title+'! Another chapter in the great escape.';
   const cast=event.id==='marathon'?['emily','jeff']:event.id==='gold'?['emily','graham','jeff','ben','huiyan']:['emily','graham'];
   renderCast(cast);
  }else{
   $('#chapter-location').textContent=clock(new Date(event.at))+' · A little Crow Crew memory';
   $('#chapter-narration').textContent=event.text||event.title;
   renderCast(event.people);
  }
  if(event.id==='gold'||event.id==='finish'||event.kind==='milestone'){
   const burst=$('#storybook-burst');burst.textContent=event.id==='gold'?'✦ GOLD ✦':event.id==='finish'?'♡ YOU DID IT! ♡':'✦ '+event.title.replace(/[!✨]/g,'')+' ✦';
   burst.classList.remove('bursting');void burst.offsetWidth;burst.classList.add('bursting');
  }
 }
 function peerPosition(track,sec){
  const points=track.fixes;
  if(sec<points[0][0]||sec>points.at(-1)[0])return null;
  let lo=0,hi=points.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(points[mid][0]<sec)lo=mid+1;else hi=mid;}
  const b=points[lo],a=points[Math.max(0,lo-1)];
  const fraction=Math.max(0,Math.min(1,(sec-a[0])/(b[0]-a[0]||1)));
  return {lat:a[1]+(b[1]-a[1])*fraction,lng:a[2]+(b[2]-a[2])*fraction};
 }
 function peerInit(){
  peerMarkers=peerTracks.map((track,i)=>{
   const marker=L.marker([0,0],{zIndexOffset:90+i,icon:L.divIcon({className:'',html:'<div class="peer-crow '+(track.group==='Pair'?'pair':track.group==='Chained'?'chained':'solo')+'"><img src="assets/crow.svg" alt=""></div>',iconSize:[27,27],iconAnchor:[13,13]})});
   marker.bindPopup('<strong>'+escape(track.name)+'</strong><br>Bib '+escape(track.bib)+' · '+escape(track.group)+'<br>'+track.overlapKm.toFixed(1)+' km close to Emily’s route');
   return marker;
  });
 }
 function updatePeers(date,p,force=false){
  const now=performance.now();if(!force&&now-lastPeerRender<280)return;lastPeerRender=now;
  const sec=(date.getTime()-Date.parse(data.firstAt))/1000;
  let visible=0,nearby=0;
  for(let i=0;i<peerTracks.length;i++){
   const pos=showPeers?peerPosition(peerTracks[i],sec):null,marker=peerMarkers[i];
   if(!pos){if(map.hasLayer(marker))map.removeLayer(marker);continue;}
   if(!map.hasLayer(marker))marker.addTo(map);
   marker.setLatLng([pos.lat,pos.lng]);visible++;
   if(haversine(p,pos)<2)nearby++;
  }
  $('#peer-encounter').textContent=showPeers?'🐦‍⬛ '+visible+' fellow escapees have recorded positions at this moment'+(nearby?' · '+nearby+' within 2 km of Emily':'')+'.':'🐦‍⬛ Fellow escapee crows are hidden. Toggle them back onto the map.';
 }
 function updateStats(p,date){
  const minutes=Math.floor(elapsed/60);
  $('#stat-travelled').textContent=p.km.toFixed(1)+' km';
  const origin={lat:fixes[0][1],lng:fixes[0][2]};
  const c=elapsed>=total()?data.final.crowKm:haversine(origin,p);
  $('#stat-crow').textContent=c.toFixed(1)+' km';
  const before=positionAt(Math.max(0,elapsed-20*60));
  const timeWindow=Math.min(elapsed,20*60)/3600;
  const recentSpeed=timeWindow>0?(p.km-before.km)/timeWindow:0;
  $('#stat-pace').textContent=minutes<20?'—':recentSpeed<.6?'Resting':recentSpeed.toFixed(1)+' km/h';
  const approxPause=data.meetings.filter(m=>Date.parse(m.at)<=date.getTime()&&m.durationMinutes!=null).reduce((sum,m)=>sum+m.durationMinutes,0);
  $('#stat-pauses').textContent='~'+approxPause+' min';
 }
 function mapInit(){
  if(!window.L)throw new Error('Map library unavailable');
  map=L.map('replay-map',{zoomControl:true,scrollWheelZoom:false,preferCanvas:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}).addTo(map);
  const coordinates=fixes.map(p=>[p[1],p[2]]);
  line=L.polyline(coordinates,{color:'#597f92',weight:4,opacity:.55,dashArray:'7 8',lineJoin:'round'}).addTo(map);
  traveled=L.polyline([coordinates[0]],{color:'#e77736',weight:6,opacity:.96,lineCap:'round',lineJoin:'round'}).addTo(map);
  meetingMarkers=data.meetings.map((m,i)=>{
   const marker=L.marker([m.lat,m.lng],{icon:L.divIcon({className:'',html:'<div class="meet-marker" id="meet-'+i+'">'+(i+1)+'</div>',iconSize:[29,29],iconAnchor:[14,14]})}).addTo(map);
   marker.bindPopup('<strong>'+escape(m.title+' · '+m.place)+'</strong><br>'+clock(new Date(m.at))+' crew check-in<br>'+(m.durationMinutes!=null?'~'+m.durationMinutes+' min GPS pause':'Pause duration unavailable'));
   return marker;
  });
  L.marker([fixes.at(-1)[1],fixes.at(-1)[2]],{icon:L.divIcon({className:'finish-flag',html:'🏁',iconSize:[30,30]})}).addTo(map).bindPopup('Emily’s final tracker position ♡');
  crow=L.marker(coordinates[0],{zIndexOffset:2000,icon:L.divIcon({className:'',html:'<div class="replay-crow"><img src="assets/crow.svg" alt="Emily’s little crow"></div>',iconSize:[40,40],iconAnchor:[20,20]})}).addTo(map);
  peerInit();
  map.fitBounds(line.getBounds().pad(.08));
 }
 function positionAt(sec){
  if(sec<=0)return {lat:fixes[0][1],lng:fixes[0][2],km:0,index:0};
  if(sec>=total())return {lat:fixes.at(-1)[1],lng:fixes.at(-1)[2],km:fixes.at(-1)[3],index:fixes.length-1};
  let low=0,high=fixes.length-1;
  while(low<high){const m=(low+high)>>1;if(fixes[m][0]<sec)low=m+1;else high=m;}
  const i=Math.max(1,low),a=fixes[i-1],b=fixes[i],f=(sec-a[0])/(b[0]-a[0]||1);
  return {lat:a[1]+(b[1]-a[1])*f,lng:a[2]+(b[2]-a[2])*f,km:a[3]+(b[3]-a[3])*f,index:i};
 }
 function updateSky(date){
  const hour=date.getUTCHours(),scene=hour>=6&&hour<9?'dawn':hour>=9&&hour<16?'day':hour>=16&&hour<18?'dusk':'night';
  const sky=$('#replay-sky');sky.className='replay-sky '+scene;
  $('#sky-period').textContent={dawn:'A stubborn sunrise 🌅',day:'Daylight, miles & hello! ☀️',dusk:'Into the golden dusk 🌇',night:hour>=18?'Beneath the stars ✨':'A midnight escape 🌙'}[scene];
  $('#replay-clock').textContent=clock(date);$('#replay-date').textContent=fullDate(date);
 }
 function showSpot(event){
  const icon=eventIcon(event),type=event.kind==='meeting'?'🚙 RECORDED CREW HELLO':event.kind==='milestone'?'🏅 DISTANCE MILESTONE':'♡ A CREW MEMORY';
  $('#spot-icon').textContent=icon;$('#spot-type').textContent=type;
  $('#spot-title').textContent=event.kind==='meeting'?event.title+' · '+event.place:event.title;
  $('#spot-description').textContent=eventDescription(event)+(event.kind==='meeting'?' '+event.durationNote:'');
  $('#spot-people').innerHTML=event.kind==='story'?renderPeople(event.people):'';
  $('#replay-spotlight').classList.remove('is-changing');void $('#replay-spotlight').offsetWidth;$('#replay-spotlight').classList.add('is-changing');
  showSceneMoment(event);
 }
 function setTime(seconds,{recenter=false,spot=null}={}){
  elapsed=Math.max(0,Math.min(total(),seconds));
  const p=positionAt(elapsed),date=new Date(Date.parse(data.firstAt)+elapsed*1000);
  crow.setLatLng([p.lat,p.lng]);
  const coords=fixes.slice(0,p.index).map(item=>[item[1],item[2]]);
  coords.push([p.lat,p.lng]);traveled.setLatLngs(coords);
  $('#replay-scrub').value=String(Math.round(elapsed/total()*1000));
  const hours=Math.floor(elapsed/3600),minutes=Math.floor(elapsed%3600/60);
  $('#replay-progress').textContent=hours+'h '+String(minutes).padStart(2,'0')+'m / 23h 49m';
  updateSky(date);
  showChapter(date);
  updateStats(p,date);
  updatePeers(date,p,recenter||!playing);
  for(let i=0;i<data.meetings.length;i++){const flag=document.getElementById('meet-'+i);if(flag)flag.classList.toggle('reached',Date.parse(data.meetings[i].at)<=date.getTime());}
  let latest=0;for(let i=0;i<events.length;i++){if(Date.parse(events[i].at)<=date.getTime()+1000)latest=i;else break;}
  if(spot)latest=events.indexOf(spot);
  if(latest!==lastEvent||spot){lastEvent=latest;showSpot(events[latest]);$$('#replay-timeline li').forEach((li,i)=>li.classList.toggle('is-current',i===latest));}
  if(recenter)map.flyTo([p.lat,p.lng],Math.max(map.getZoom(),11),{animate:true,duration:1});
  if(elapsed>=total()&&!finishedShown){finishedShown=true;pause();$('#replay-finish').classList.add('is-celebrating');$('#replay-toggle').innerHTML='↺ <span>Play again</span>';}else if(elapsed<total())finishedShown=false;
 }
 function pause(){playing=false;$('#replay-toggle').innerHTML='▶ <span>Play our escape</span>';$('#replay-toggle').setAttribute('aria-label','Play route replay');if(raf)cancelAnimationFrame(raf);raf=0;}
 function tick(timestamp){
  if(!playing)return;
  const delta=Math.min(90,timestamp-(lastFrame||timestamp));lastFrame=timestamp;
  if(timestamp>=holdUntil)elapsed+=delta/1000*total()/105*speed;
  const previous=lastEvent;setTime(elapsed);
  if(lastEvent>previous&&lastEvent>0){holdUntil=timestamp+1400;}
  if(playing&&timestamp-lastPan>3600){lastPan=timestamp;const p=positionAt(elapsed);map.panTo([p.lat,p.lng],{animate:true,duration:.7});}
  if(playing)raf=requestAnimationFrame(tick);
 }
 function play(){
  if(playing){pause();return;}
  if(elapsed>=total())setTime(0);
  playing=true;lastFrame=0;holdUntil=0;lastPan=0;
  $('#replay-toggle').innerHTML='|| <span>Pause our escape</span>';$('#replay-toggle').setAttribute('aria-label','Pause route replay');
  if(map.getZoom()<10){const p=positionAt(elapsed);map.flyTo([p.lat,p.lng],11,{duration:1});}
  raf=requestAnimationFrame(tick);
 }
 async function init(){
  try{
   const [response,peersResponse]=await Promise.all([fetch('data/emily-replay-2026.json',{cache:'force-cache'}),fetch('data/emily-peer-crows-2026.json',{cache:'force-cache'})]);
   if(!response.ok)throw new Error('GPS file unavailable');data=await response.json();
   if(!peersResponse.ok)throw new Error('Archived fellow escapee GPS file unavailable');
   const peerData=await peersResponse.json();peerTracks=peerData.tracks;
   if(!Array.isArray(peerTracks)||peerTracks.length!==35)throw new Error('Fellow escapee archive incomplete');
   fixes=data.fixes;if(!Array.isArray(fixes)||fixes.length<700)throw new Error('GPS archive incomplete');
   buildEvents();mapInit();setTime(0,{spot:events[0]});
   $('#show-peers').addEventListener('change',event=>{showPeers=event.target.checked;const p=positionAt(elapsed);updatePeers(new Date(Date.parse(data.firstAt)+elapsed*1000),p,true);});
   $('#replay-toggle').addEventListener('click',play);
   $('#replay-restart').addEventListener('click',()=>{pause();setTime(0);map.fitBounds(line.getBounds().pad(.08));});
   $('#replay-speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?4:1;$('#replay-speed').textContent=speed+'×';});
   $('#replay-scrub').addEventListener('input',event=>{pause();setTime(Number(event.target.value)/1000*total());});
   document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
   const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
   if(!reduced)window.setTimeout(play,700);
  }catch(error){console.error('Replay could not start',error);$('#replay-timeline').innerHTML='<li>The saved journey could not load. Please reconnect and reload this page.</li>';$('#spot-title').textContent='We’ll be right back, Emily ♡';$('#spot-description').textContent=error.message||'Reload to try again.';}
 }
 window.addEventListener('DOMContentLoaded',init);
})();
