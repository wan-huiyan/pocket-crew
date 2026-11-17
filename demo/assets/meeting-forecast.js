'use strict';
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.meetingForecast=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  const MINUTE=60000,HOUR=60*MINUTE;
  const DEFAULT_RATE=.05,MAX_RATE=.15,PACE_CAP=1.5;
  const finite=Number.isFinite;
  const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)?Date.parse(value):NaN;
  const valid=p=>p&&finite(p.lat)&&Math.abs(p.lat)<=90&&finite(p.lng)&&Math.abs(p.lng)<=180&&finite(p.routeKm)&&p.routeKm>=0&&finite(p.offRouteM)&&p.offRouteM>=0&&p.offRouteM<500;

  function distanceKm(a,b){
    const rad=Math.PI/180,dy=(b.lat-a.lat)*rad,dx=(b.lng-a.lng)*rad;
    const s=Math.sin(dy/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dx/2)**2;
    return 6371.0088*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));
  }

  // Use the latest uninterrupted, valid run of this person's reports. A bad
  // projection, long gap or jump ends the usable trend history; it never gets
  // bridged by silently removing a suspicious middle sample.
  function contiguousHistory(runner){
    const end=stamp(runner?.recordedAt);
    if(!finite(end)||!valid(runner))return [];
    const byTime=new Map();
    for(const p of Array.isArray(runner.paceReports)?runner.paceReports:[]){
      const at=stamp(p?.recordedAt);
      if(finite(at)&&at>=end-120*MINUTE&&at<=end)byTime.set(at,{...p,at});
    }
    byTime.set(end,{...runner,at:end});
    const ordered=[...byTime.values()].sort((a,b)=>a.at-b.at);
    const segment=[ordered.at(-1)];
    for(let index=ordered.length-2;index>=0;index--){
      const p=ordered[index],next=segment[0],elapsed=next.at-p.at,advance=next.routeKm-p.routeKm;
      if(!valid(p)||elapsed<=0||elapsed>5*MINUTE||advance<-.15||advance/elapsed*HOUR>30||distanceKm(p,next)/elapsed*HOUR>30)break;
      segment.unshift(p);
    }
    return segment;
  }

  function windowPace(reports){
    if(reports.length<4)return null;
    const first=reports[0],last=reports.at(-1),elapsed=last.at-first.at,advance=last.routeKm-first.routeKm;
    if(elapsed<10*MINUTE||advance<.15)return null;
    const speed=advance/elapsed*HOUR;
    if(speed<.5||speed>30)return null;
    return {pace:60/speed,centre:(first.at+last.at)/2};
  }

  function trendFor(history){
    const base={rate:DEFAULT_RATE,method:'planning-allowance',historyMinutes:0};
    if(history.length<8)return base;
    const start=history[0].at,end=history.at(-1).at,span=end-start;
    if(span<30*MINUTE)return base;
    const width=Math.min(20*MINUTE,span/2);
    const earlier=windowPace(history.filter(p=>p.at<=start+width));
    const recent=windowPace(history.filter(p=>p.at>=end-width));
    if(!earlier||!recent)return base;
    const relativeChange=recent.pace/earlier.pace-1;
    const elapsedHours=(recent.centre-earlier.centre)/HOUR;
    const observedRate=relativeChange/elapsedHours;
    // Require at least a 5% measured change between windows before treating
    // their difference as slowdown; small GPS/rounding noise stays default.
    if(relativeChange<.05||!finite(observedRate)||observedRate<=DEFAULT_RATE)return {...base,historyMinutes:span/MINUTE};
    return {rate:Math.min(MAX_RATE,observedRate),method:'observed-trend',historyMinutes:span/MINUTE};
  }

  // pace(t) = currentPace * min(1 + rate*t, 1.5), with t in hours.
  // Integrating speed, then solving for time, avoids adding an arbitrary
  // per-stop delay and ensures all later route points have later arrivals.
  function travelHours(distance,speed,rate){
    const capTime=(PACE_CAP-1)/rate;
    const capDistance=speed/rate*Math.log(PACE_CAP);
    return distance<=capDistance?(Math.exp(rate*distance/speed)-1)/rate
      :capTime+(distance-capDistance)*PACE_CAP/speed;
  }

  function clock(at,now){
    const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const dayFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short'});
    const day=dayFormat.format(at);
    return (day!==dayFormat.format(now)?day+' ':'')+timeFormat.format(at);
  }
  function paceText(value){const seconds=Math.round(value*60);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+'/km';}
  const empty=(reason,name=null,note='Waiting for fresh route progress and a usable recent pace.')=>({status:'unavailable',arrivalTime:null,earliestArrivalTime:null,formattedTime:null,earliestFormattedTime:null,latestFormattedTime:null,readyByTime:null,readyByText:null,minutes:null,rangeText:'',method:null,note,selectedRunnerName:name,reason});

  function estimate(input={}){
    const engine=root.arrivalEta,now=input.now===undefined?Date.now():input.now;
    if(!engine?.estimate||!engine?.selectRunner)return empty('engine-unavailable');
    const runners=input.snapshot?.runners;
    const chosen=engine.selectRunner({runners,now});
    const base=engine.estimate({runners,meeting:input.point,now});
    const name=base.selectedRunnerName||chosen?.name||null;
    if(base.status==='passed'||base.status==='arrived')return {...empty(base.reason,name,engine.format?.(base,{now})?.fullText||''),status:base.status,minutes:0};
    if(base.status!=='available'||!chosen?.paceUsable||chosen.id!==base.selectedRunnerId){
      return empty(base.reason||'missing-pace',name,engine.format?.(base,{now})?.fullText);
    }
    const runner=chosen.runner,history=contiguousHistory(runner),recordedAt=stamp(runner.recordedAt);
    const recentBaseline=history.filter(p=>recordedAt-p.at>=2*MINUTE&&recordedAt-p.at<=5*MINUTE).at(-1);
    if(recentBaseline&&runner.routeKm-recentBaseline.routeKm<=.02)return empty('stopped',name,'The latest route reports show no forward movement. Waiting for a new moving pace.');
    // After a measured rest, the hours before that rest must not make the
    // future slowdown trend treat the restart as a continuing deceleration.
    const stopEnd=runner.paceExcludesStops?engine.lastStopEndIndex?.(history)??-1:-1;
    const trend=trendFor(stopEnd>=0?history.slice(stopEnd):history);
    const hours=travelHours(base.remainingKm,base.speedKmh,trend.rate);
    const arrivalTime=recordedAt+hours*HOUR,earliestArrivalTime=base.arrivalAt;
    if(!finite(arrivalTime)||arrivalTime<=now)return empty('estimate-elapsed',name);
    // Choose precision from the report-anchored forecast horizon, so the
    // absolute displayed time does not drift merely because the UI redraws.
    const roundingMinutes=hours<=2?5:15,roundingMs=roundingMinutes*MINUTE;
    const roundedArrivalTime=Math.ceil(arrivalTime/roundingMs)*roundingMs;
    // Round the scenarios outwards: preparation must not start later than
    // the unchanged-pace arrival. Keep both raw times for opening-hour checks.
    const roundedEarliest=Math.floor(earliestArrivalTime/roundingMs)*roundingMs;
    const latestClock=clock(roundedArrivalTime,now),earliestClock=clock(roundedEarliest,now);
    const rateText=String(Math.round(trend.rate*100));
    const methodNote=trend.method==='observed-trend'
      ?'Recent route history shows a slowdown; this planning scenario uses '+rateText+'% more min/km per future hour (bounded at 5–15%/hour).'
      :'This planning scenario allows 5% more min/km per future hour; it is an allowance, not a prediction that they must slow down.';
    const held=runner.paceSource==='held-tracker-route';
    const paceLabel=held?'Earlier GPS-measured route pace (provisional): ':'Recent route pace: ';
    const caution=held?' The tracker has a fresh position but too few new GPS samples for a current pace. The old pace is carried for at most 15 minutes; the runner may have stopped or slowed.':runner.paceExcludesStops?' This pace is measured from GPS progress after the latest verified stop, without counting the rest time.':runner.paceResetAfterGap?' This pace is measured since GPS reports resumed; the reporting gap is excluded and any stops within it are uncertain.':' The pace comes from recent GPS route progress; unrecorded stops may change it.';
    const note=paceLabel+paceText(base.paceMinPerKm)+'. '+methodNote+' Future pace is capped at 1.5× the measured min/km. The planning range spans unchanged measured pace to this slower scenario; it is not a confidence interval. A faster pace could mean arriving before this range; it is not a guaranteed window.'+caution+' Extra future stops are not included.';
    return {status:'ready',arrivalTime,formattedTime:earliestClock,
      earliestFormattedTime:earliestClock,latestFormattedTime:latestClock,
      readyByTime:roundedEarliest,readyByText:roundedEarliest<=now?'Be ready now':'Be ready by '+earliestClock,
      minutes:Math.ceil((arrivalTime-now)/MINUTE/roundingMinutes)*roundingMinutes,
      rangeText:roundedEarliest===roundedArrivalTime?'around '+earliestClock:earliestClock+'–'+latestClock,
      method:held?'held-route-pace':trend.method,note,paceHeld:held,paceMeasuredAt:base.paceMeasuredAt,selectedRunnerName:name,reason:null,
      earliestArrivalTime,roundedArrivalTime,roundingMinutes,ratePerHour:trend.rate,historyMinutes:trend.historyMinutes,selectedRunnerId:chosen.id,remainingKm:base.remainingKm};
  }
  return {estimate};
});
