'use strict';
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.toiletHours=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const MINUTE=60000,DAY=86400000,BUFFER_MINUTES=10;
  const finite=Number.isFinite;
  const partsFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const clockFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const dateFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short'});
  const parts=at=>Object.fromEntries(partsFormat.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const key=p=>p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0');
  function clock(at,now=Date.now()){return (dateFormat.format(at)===dateFormat.format(now)?'':dateFormat.format(at)+' ')+clockFormat.format(at);}
  function dateAfter(date,days){const d=new Date(Date.UTC(date.year,date.month-1,date.day+days));return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
  function minuteValue(value,end=false){
    if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))return null;
    const [h,m]=value.split(':').map(Number);
    return m<60&&h<24?h*60+m:end&&h===24&&m===0?1440:null;
  }
  // London has UTC and BST offsets. Resolve both explicitly, so autumn's
  // repeated hour and spring's missing hour are never silently normalised.
  function boundary(date,minute,isEnd){
    const shifted=dateAfter(date,Math.floor(minute/1440)),m=minute%1440;
    const wanted={...shifted,hour:Math.floor(m/60),minute:m%60};
    const utc=Date.UTC(wanted.year,wanted.month-1,wanted.day,wanted.hour,wanted.minute);
    const choices=[utc,utc-60*MINUTE].filter(at=>{const p=parts(at);return Object.keys(wanted).every(k=>p[k]===wanted[k]);});
    // An opening at a repeated hour uses the later occurrence; a closing
    // uses the earlier occurrence. That is the conservative open interval.
    return choices.length?(isEnd?Math.min(...choices):Math.max(...choices)):null;
  }
  function dayHours(opening,date){
    const id=key(date),special=opening.exceptions&&Object.prototype.hasOwnProperty.call(opening.exceptions,id);
    const weeklyKey=String(new Date(Date.UTC(date.year,date.month-1,date.day)).getUTCDay());
    const value=special?opening.exceptions[id]:opening.weekly?.[weeklyKey];
    if(!Array.isArray(value))return {known:false,intervals:[]};
    const intervals=[];
    for(const span of value){
      if(!Array.isArray(span)||span.length!==2)return {known:false,intervals:[]};
      const start=minuteValue(span[0]),end=minuteValue(span[1],true);
      if(start===null||end===null||start===end)return {known:false,intervals:[]};
      let adjustedEnd=end<start?end+1440:end;
      // A dated exception owns that entire local date, including the hours
      // after midnight that otherwise belong to yesterday's overnight span.
      if(adjustedEnd>1440&&opening.exceptions&&Object.prototype.hasOwnProperty.call(opening.exceptions,key(dateAfter(date,1))))adjustedEnd=1440;
      const from=boundary(date,start,false),to=boundary(date,adjustedEnd,true);
      if(from===null||to===null||to<=from)return {known:false,intervals:[]};
      intervals.push([from,to]);
    }
    return {known:true,intervals};
  }
  function mergedIntervals(intervals){
    const result=[];
    for(const span of intervals.sort((a,b)=>a[0]-b[0])){
      const previous=result.at(-1);
      if(previous&&span[0]<=previous[1])previous[1]=Math.max(previous[1],span[1]);else result.push([...span]);
    }
    return result;
  }
  function unavailable(reason,note){return {status:'unavailable',arrivalTime:null,earliestArrivalTime:null,formattedTime:null,rangeText:'',source:null,note:note||'An arrival estimate needs a fresh position and usable pace.',reason};}
  function runnerArrival({poi,snapshot,now=Date.now()}={}){
    if(!poi||!finite(poi.routeKm))return unavailable('missing-route-position');
    const result=root.meetingForecast?.estimate?.({snapshot,point:poi,now});
    if(!result)return unavailable('forecast-unavailable');
    if(result.status==='passed')return {...unavailable('passed',result.note),status:'passed'};
    const arrived=result.status==='arrived';
    if(!arrived&&result.status!=='ready')return unavailable(result.reason,result.note);
    if(!arrived&&(!finite(result.arrivalTime)||!finite(result.earliestArrivalTime)||result.arrivalTime<result.earliestArrivalTime))return unavailable('invalid-forecast');
    const earliest=arrived?now:Math.max(now,result.earliestArrivalTime||result.arrivalTime);
    const offset=finite(poi.routeOffsetM)?Math.max(0,poi.routeOffsetM):0;
    const allowance=Math.ceil(offset/1000*15);
    const latest=(arrived?now:Math.max(earliest,result.arrivalTime))+allowance*MINUTE;
    return {status:'ready',earliestArrivalTime:earliest,arrivalTime:latest,formattedTime:clock(latest,now),rangeText:clock(earliest,now)===clock(latest,now)?'around '+clock(latest,now):clock(earliest,now)+'–'+clock(latest,now),source:'runner',selectedRunnerName:result.selectedRunnerName,checkedAt:now,accessAllowanceMinutes:allowance,note:(allowance?'Includes a '+allowance+' min allowance from the nearby route point; this is not a measured walking detour. Check the approach. ':'Arrival is at the nearby route point. ')+(result.note||'')};
  }
  function evaluate({poi,arrival,now=Date.now()}={}){
    const possibleToilet=poi?.possibleToilet===true;
    const accessNote=possibleToilet?' Toilet provision and access have not been confirmed; ask staff.':'';
    const base={status:'unknown',label:'Hours / ETA to check',detail:'',nextOpening:null,arrival,bufferMinutes:BUFFER_MINUTES,possibleToilet};
    if(!arrival||arrival.status!=='ready'||!finite(arrival.arrivalTime)||!finite(arrival.earliestArrivalTime))return {...base,label:possibleToilet?'Possible café WC · ETA unavailable':'ETA unavailable',detail:(arrival?.note||'A fresh position and travel estimate are needed to check opening hours.')+accessNote};
    const start=arrival.earliestArrivalTime,end=arrival.arrivalTime+BUFFER_MINUTES*MINUTE;
    if(!finite(now)||start<now-2*MINUTE||end<start||end-start>3*DAY||start>now+7*DAY)return {...base,label:'ETA to refresh',detail:'The arrival estimate is out of date or outside the supported planning window.'};
    const opening=poi?.opening;
    if(!opening||opening.timeZone!=='Europe/London'||!['toilet','venue'].includes(opening.basis))return {...base,label:opening?.basis==='conflicting'?'Hours conflict · check':possibleToilet?'Possible café WC · hours unknown':'Hours unknown · check',detail:(opening?.note||'Separate toilet opening hours have not been confirmed.')+accessNote};
    const date=parts(start),entries=[];
    for(let day=-1;day<=10;day++){const d=dateAfter(date,day);entries.push({date:d,...dayHours(opening,d)});}
    const spans=mergedIntervals(entries.flatMap(d=>d.intervals));
    const next=spans.find(span=>span[0]>start)?.[0]??null;
    const fits=spans.find(span=>span[0]<=start&&span[1]>=end);
    if(fits){
      const venue=opening.basis==='venue';
      if(possibleToilet)return {...base,status:'possible',label:'Café open at ETA · ask about WC',detail:'Advertised café hours cover your arrival, including '+BUFFER_MINUTES+' min after the later ETA.'+accessNote+(fits[1]-start<DAY?' Café closes '+clock(fits[1],now)+'.':''),nextOpening:next};
      return {...base,status:venue?'likely':'open',label:venue?'Likely open · check WC access':'Open at ETA',detail:(venue?'Advertised venue hours cover your arrival; separate toilet access is not guaranteed. ':'Published toilet hours cover your arrival. ')+'Allows '+BUFFER_MINUTES+' min after the later ETA.'+(fits[1]-start<DAY?' Closes '+clock(fits[1],now)+'.':''),nextOpening:next};
    }
    if(spans.some(span=>span[0]<end&&span[1]>start))return {...base,status:'tight',label:possibleToilet?'Café opening / closing near ETA':'Opening / closing near ETA',detail:'Your arrival window or the '+BUFFER_MINUTES+' min access allowance crosses an opening or closing time. Choose another option or check first.'+accessNote,nextOpening:next};
    const relevant=entries.filter(entry=>{const from=boundary(entry.date,0,false),to=boundary(entry.date,1440,true);return finite(from)&&finite(to)&&from<end&&to>start;});
    // A previous day's unknown hours could extend across midnight. Do not
    // confidently declare an overnight closure from today's hours alone.
    const explicitSchedule=Array.isArray(opening.exceptions?.[key(date)]);
    const previousUnknown=!entries[0].known&&!explicitSchedule;
    if(previousUnknown||relevant.some(entry=>!entry.known))return {...base,label:possibleToilet?'Possible café WC · hours unknown':'Hours unknown · check',detail:'The schedule is incomplete for the arrival day.'+accessNote,nextOpening:next};
    return {...base,status:'closed',label:possibleToilet?'Café closed at ETA':'Closed at ETA',detail:'Your arrival window falls outside the advertised '+(possibleToilet?'café':opening.basis==='venue'?'venue':'toilet')+' hours.'+(next?' Next opening '+clock(next,now)+'.':'')+accessNote,nextOpening:next};
  }
  return {evaluate,runnerArrival,clock,BUFFER_MINUTES};
});
