'use strict';
(()=>{
 const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={'female-solo':'Female solo','male-solo':'Male solo','pair':'Pairs','chained':'Chained','other':'Other','all':'Everyone'};
 let data,category='female-solo',prior='female-solo';
 const display=entry=>Number.isFinite(entry.crowKm)?entry.crowKm.toLocaleString('en-GB',{minimumFractionDigits:1,maximumFractionDigits:3})+' km':'No recorded distance';
 function draw(){
  const entries=data.categories[category]||[];const emily=entries.find(e=>e.bib==='247');
  $$('#leader-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
  $('#category-note').textContent=labels[category].toUpperCase()+' · '+entries.length+' TRACKER ENTRIES';
  $('#data-message').textContent=category==='all'?'Informal comparison of all entry types, ranked by crow-flight distance.':'Sorted by recorded crow-flight distance. The first three are shown on the podium below.';
  $('#emily-place').textContent=category==='all'?'🐦‍⬛ 24th of 282 overall (informal)': '🥈 2nd of 36 female solo';
  const top=entries.slice(0,3),order=[top[1],top[0],top[2]];
  $('#podium').innerHTML=order.map((e,i)=>!e?'':`<div class="podium-entry ${['second','first','third'][i]} ${e.bib==='247'?'emily':''}"><span class="medal">${['🥈','🥇','🥉'][i]}</span><strong class="person">${safe(e.name)}</strong><span class="kilometres">${display(e)}</span><div class="block" style="--height:${[95,147,65][i]}px" aria-label="${e.rank} place">${e.rank}</div></div>`).join('');
  const q=$('#leader-search').value.trim().toLowerCase();const filtered=entries.filter(e=>(e.name+' '+e.bib).toLowerCase().includes(q));
  $('#leader-body').innerHTML=filtered.map(e=>`<tr ${e.bib==='247'?'class="emily" id="emily-row"':''}><td>${e.rank==null?'—':'#'+e.rank}</td><td>${safe(e.name)} <small>· ${safe(e.bib)}</small></td><td>${display(e)}</td><td>${safe(e.trackedHours||'—')}</td></tr>`).join('')||'<tr><td colspan="4">No matching escapees — try another name or bib.</td></tr>';
 }
 document.addEventListener('DOMContentLoaded',async()=>{
  try{
   const response=await fetch('data/meriden-final-standings-2026.json',{cache:'force-cache'});if(!response.ok)throw Error('Archived standings unavailable');data=await response.json();
   draw();
   $$('#leader-tabs button').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;prior=category;if(category!=='all')$('#compare-everyone').checked=false;else $('#compare-everyone').checked=true;draw();}));
   $('#compare-everyone').addEventListener('change',e=>{category=e.target.checked?'all':(prior==='all'?'female-solo':prior);draw();});
   $('#leader-search').addEventListener('input',draw);
   $('#find-emily').addEventListener('click',()=>{category=$('#compare-everyone').checked?'all':'female-solo';$('#leader-search').value='';draw();$('#emily-row')?.scrollIntoView({behavior:'smooth',block:'center'});});
  }catch(error){console.error(error);$('#leader-body').innerHTML='<tr><td colspan="4">The archived rankings could not load. Please reload this page.</td></tr>';}
 });
})();
