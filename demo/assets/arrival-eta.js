'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arrivalEta = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MINUTE = 60_000;
  const ROUNDING_MS = 5 * MINUTE;
  const MAX_REPORT_AGE_MS = 5 * MINUTE;
  const MAX_FUTURE_MS = 30_000;
  const MAX_OFF_ROUTE_M = 500;
  // A temporary loss of GPS samples must not erase a *previously measured*
  // route pace. Never keep it indefinitely or past a known stop.
  const MAX_HELD_PACE_AGE_MS = 15 * MINUTE;
  const NEAR_MEETING_KM = .15;
  const MIN_SPEED_KMH = .5;
  const MAX_SPEED_KMH = 30;
  const finite = Number.isFinite;
  const runnerIds = ['emily', 'jeff'];
  const isPoint = p => p && finite(p.lat) && Math.abs(p.lat) <= 90 && finite(p.lng) && Math.abs(p.lng) <= 180;
  const timestamp = value => {
    if (typeof value === 'number' && finite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return NaN;
    return Date.parse(value);
  };
  const currentTime = value => value === undefined ? Date.now() : value;

  function positionIssue(runner, now) {
    if (!runner) return 'missing-report';
    if (runner.retired === true) return 'retired';
    if (runner.finished === true) return 'finished';
    const recordedAt = timestamp(runner.recordedAt);
    if (!finite(now) || !finite(recordedAt)) return 'missing-report';
    if (recordedAt > now + MAX_FUTURE_MS) return 'future-report';
    if (now - recordedAt >= MAX_REPORT_AGE_MS) return 'stale-report';
    if (runner.fresh !== true || !isPoint(runner)) return 'missing-report';
    if (finite(runner.offRouteM) && runner.offRouteM >= MAX_OFF_ROUTE_M) return 'off-route';
    if (!finite(runner.routeKm) || runner.routeKm < 0 || !finite(runner.offRouteM) || runner.offRouteM < 0) return 'route-unavailable';
    return null;
  }

  function routeSpeed(runner, now) {
    if (!['recent-tracker-route', 'held-tracker-route'].includes(runner?.paceSource)) return null;
    if (runner.paceSource === 'held-tracker-route') {
      const measuredAt=timestamp(runner.paceMeasuredAt),recordedAt=timestamp(runner.recordedAt);
      if (!finite(measuredAt) || !finite(recordedAt) || measuredAt>recordedAt || now-measuredAt>MAX_HELD_PACE_AGE_MS || measuredAt>now) return null;
    }
    const speed = finite(runner.speedKmh) ? runner.speedKmh
      : finite(runner.paceMinPerKm) && runner.paceMinPerKm > 0 ? 60 / runner.paceMinPerKm : null;
    return speed !== null && speed >= MIN_SPEED_KMH && speed <= MAX_SPEED_KMH ? speed : null;
  }

  // Distance, meeting selection and ETA must use the same person's report.
  // Prefer the latest complete route sample; a more recent position without
  // enough history must not borrow the other runner's pace.
  function selectRunner(input = {}) {
    const now = currentTime(input.now);
    const known = runnerIds.map(id => ({id, runner:input.runners?.[id], name:id === 'emily' ? 'Emily' : 'Jeff'}))
      .filter(entry => entry.runner && isPoint(entry.runner) && finite(timestamp(entry.runner.recordedAt)))
      .sort((a, b) => timestamp(b.runner.recordedAt) - timestamp(a.runner.recordedAt));
    const positions = known.filter(entry => !positionIssue(entry.runner, now));
    const paced = positions.filter(entry => routeSpeed(entry.runner, now) !== null);
    const chosen = paced[0] || positions[0] || known[0];
    if (!chosen) return null;
    const positionUsable = positions.includes(chosen), paceUsable = paced.includes(chosen);
    const reason = paceUsable ? chosen.id === positions[0].id ? 'latest-route-pace' : 'route-pace-fallback'
      : positionUsable ? 'latest-position' : 'last-known-report';
    return {...chosen, positionUsable, paceUsable, reason};
  }

  /**
   * Pace comes from actual timestamped GPS reports projected onto our planned
   * route. Meriden's crow-flight distance / average must not be used here.
   * A verified stationary stretch ends the previous pace window: after they
   * resume, only new forward progress counts towards the moving pace.
   */
  function lastStopEndIndex(reports) {
    let last = -1;
    for (let start = 0; start < reports.length - 1; start++) {
      const first = reports[start];
      if (!finite(first.at) || !finite(first.routeKm)) continue;
      for (let end = start + 1; end < reports.length; end++) {
        const current = reports[end];
        if (!finite(current.at) || !finite(current.routeKm) || current.at - first.at > 20 * MINUTE) break;
        if (current.at - first.at < 2 * MINUTE) continue;
        // Every intervening fix must corroborate the stationary plateau.
        // Do not mistake a return to a previous position for a rest.
        if (reports.slice(start, end + 1).every(p =>
          finite(p.routeKm) && Math.abs(p.routeKm - first.routeKm) <= .02 &&
          finite(p.at) && p.at >= first.at)) last = Math.max(last, end);
      }
    }
    return last;
  }

  function derivePace(input = {}) {
    const now = currentTime(input.now), runner = input.runner;
    if (positionIssue(runner, now)) return null;
    const endAt = timestamp(runner.recordedAt);
    const byTime = new Map();
    for (const report of Array.isArray(input.reports) ? input.reports : []) {
      const at = timestamp(report?.recordedAt);
      if (!finite(at) || at < endAt - 20 * MINUTE || at > endAt) continue;
      byTime.set(at, {...report, at});
    }
    // The current participant report is authoritative at its own timestamp.
    byTime.set(endAt, {...runner, at:endAt});
    const ordered = [...byTime.values()].sort((a, b) => a.at - b.at);
    // A tracker can stop reporting during a rest or lose GPS reception.
    // Start a NEW window after the last long silence; never divide progress
    // across that gap by its unknown duration, and never reuse the older
    // segment as if it described movement since the restart.
    let startIndex=0;
    for(let i=1;i<ordered.length;i++)if(ordered[i].at-ordered[i-1].at>5*MINUTE)startIndex=i;
    const reports=ordered.slice(startIndex);
    if (reports.length < 4) return null;
    const elapsedMs = endAt - reports[0].at;
    if (elapsedMs < 5 * MINUTE) return null;
    for (let i = 0; i < reports.length; i++) {
      const p = reports[i];
      if (!isPoint(p) || !finite(p.routeKm) || p.routeKm < 0 || !finite(p.offRouteM) || p.offRouteM < 0 || p.offRouteM >= MAX_OFF_ROUTE_M) return null;
      if (!i) continue;
      const previous = reports[i - 1], elapsed = p.at - previous.at;
      const advance = p.routeKm - previous.routeKm;
      if (elapsed <= 0 || elapsed > 5 * MINUTE || advance < -.15 || advance / elapsed * 3_600_000 > MAX_SPEED_KMH) return null;
    }
    // A historic moving average must not keep predicting an arrival while the
    // latest two-to-five minutes of reports show no meaningful forward motion.
    const recentBaseline = reports.filter(p => endAt - p.at >= 2 * MINUTE && endAt - p.at <= 5 * MINUTE).at(-1);
    if (!recentBaseline || runner.routeKm - recentBaseline.routeKm <= .02) return null;
    const stopEnd = lastStopEndIndex(reports);
    const moving = stopEnd >= 0 ? reports.slice(stopEnd) : reports;
    const movingElapsedMs = endAt - moving[0].at;
    const minimumDistanceKm = stopEnd >= 0 ? .08 : .15;
    // Immediately after a stop, two genuine forward intervals spanning two
    // minutes suffice. Otherwise keep the longer startup requirements.
    if (stopEnd >= 0 && (moving.length < 3 || movingElapsedMs < 2 * MINUTE ||
      moving.slice(1).filter((p, i) => p.routeKm - moving[i].routeKm >= .02).length < 2)) return null;
    const distanceKm = runner.routeKm - moving[0].routeKm;
    const speedKmh = distanceKm / movingElapsedMs * 3_600_000;
    if (distanceKm < minimumDistanceKm || speedKmh < MIN_SPEED_KMH || speedKmh > MAX_SPEED_KMH || !finite(speedKmh)) return null;
    return {speedKmh, paceMinPerKm:60 / speedKmh, paceSource:'recent-tracker-route', paceWindowMinutes:movingElapsedMs / MINUTE,
      paceExcludesStops:stopEnd >= 0,paceResetAfterGap:startIndex>0};
  }

  /**
   * Recover the latest independently measured pace from this *runner's* GPS
   * history, or a trusted previously measured snapshot. The current position
   * is never invented: it must still be live, fresh and on-route. A real
   * stationary observation overrides this fallback.
   *
   * GPS history often arrives incomplete even while the tracker has a new
   * fix, especially after poor reception. The 120-minute path lets a phone
   * that just opened the guide recover without local storage.
   */
  function carryPace(input = {}) {
    const now = currentTime(input.now), runner = input.runner;
    if (positionIssue(runner, now)) return null;
    const endAt = timestamp(runner.recordedAt);
    const history = (Array.isArray(input.reports) ? input.reports : [])
      .map(report => ({...report, at:timestamp(report?.recordedAt)}))
      .filter(report => finite(report.at) && report.at <= endAt && report.at >= endAt - 35 * MINUTE)
      .sort((a, b) => a.at - b.at);
    const options = [];
    const previous = input.previous;
    const previousAt = timestamp(previous?.recordedAt);
    if (previous?.paceSource === 'recent-tracker-route' && finite(previousAt) &&
      finite(previous?.routeKm) && finite(previous?.speedKmh)) {
      options.push({...previous, at:previousAt});
    }
    // Recheck every prospective end point through the normal GPS-derived
    // algorithm; no assumed, crow-flight or manually entered pace qualifies.
    const candidates = [...new Map(history.map(report => [report.at, report])).values()]
      .filter(report => report.at < endAt && endAt - report.at <= MAX_HELD_PACE_AGE_MS).reverse();
    for (const sample of candidates) {
      if (!isPoint(sample) || !finite(sample.routeKm) || !finite(sample.offRouteM)) continue;
      const historicalRunner = {...sample, recordedAt:new Date(sample.at).toISOString(), fresh:true, finished:false, retired:false};
      const measured = derivePace({runner:historicalRunner, reports:history, now:sample.at});
      if (measured) {options.push({...measured, recordedAt:sample.at, routeKm:sample.routeKm, at:sample.at});break;}
    }
    const trusted = options.filter(p => {
      const age=endAt-p.at, advance=runner.routeKm-p.routeKm;
      return age>=0 && age<=MAX_HELD_PACE_AGE_MS && now-p.at<=MAX_HELD_PACE_AGE_MS && p.at<=now &&
        finite(p.speedKmh) && p.speedKmh>=MIN_SPEED_KMH && p.speedKmh<=MAX_SPEED_KMH &&
        finite(p.routeKm) && p.routeKm>=0 && advance>=-.15 &&
        advance/Math.max(age,1)*3_600_000<=MAX_SPEED_KMH;
    }).sort((a,b)=>b.at-a.at)[0];
    if (!trusted) return null;
    const verifiedPath=[...new Map([...history,{...runner,at:endAt}].map(p=>[p.at,p])).values()]
      .sort((a,b)=>a.at-b.at)
      .filter(p=>isPoint(p)&&finite(p.routeKm)&&finite(p.offRouteM)&&p.offRouteM<MAX_OFF_ROUTE_M);
    const lastStop=lastStopEndIndex(verifiedPath);
    if (lastStop>=0 && verifiedPath[lastStop].at>=trusted.at) return null;
    // A fix showing no movement for at least ~2 minutes is affirmative stop
    // evidence, even when there are too few samples to compute a new pace.
    const baseline = history.filter(p => endAt-p.at>=2*MINUTE && endAt-p.at<=5*MINUTE &&
      isPoint(p) && finite(p.routeKm) && finite(p.offRouteM) && p.offRouteM<MAX_OFF_ROUTE_M).at(-1);
    if (baseline && runner.routeKm-baseline.routeKm<=.02) return null;
    if (endAt-trusted.at>=2*MINUTE && runner.routeKm-trusted.routeKm<=.02) return null;
    return {speedKmh:trusted.speedKmh, paceMinPerKm:60/trusted.speedKmh,
      paceSource:'held-tracker-route', paceMeasuredAt:new Date(trusted.at).toISOString(),
      paceWindowMinutes:trusted.paceWindowMinutes??null,paceExcludesStops:trusted.paceExcludesStops===true,
      paceResetAfterGap:trusted.paceResetAfterGap===true};
  }

  function distanceMetres(a, b) {
    if (!isPoint(a) || !isPoint(b)) return Infinity;
    const radians = x => x * Math.PI / 180;
    const lat = radians(b.lat - a.lat), lng = radians(b.lng - a.lng);
    const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function unavailable(base, reason) {
    return {...base, status:'unavailable', reason, arrivalAt:null, roundedArrivalAt:null, minutesRemaining:null};
  }

  function timing(arrivalAt, now) {
    return {arrivalAt, roundedArrivalAt:Math.ceil(arrivalAt / ROUNDING_MS) * ROUNDING_MS, minutesRemaining:Math.max(0, (arrivalAt - now) / MINUTE)};
  }

  function estimateRunner(runner, meeting, now, id) {
    const base = {
      id,
      recordedAt:finite(timestamp(runner?.recordedAt)) ? timestamp(runner.recordedAt) : null,
      remainingKm:null,
      speedKmh:null,
      paceMinPerKm:null,
      paceSource:typeof runner?.paceSource === 'string' ? runner.paceSource : null,
      paceExcludesStops:runner?.paceExcludesStops===true,
      paceResetAfterGap:runner?.paceResetAfterGap===true,
      paceWindowMinutes:finite(runner?.paceWindowMinutes) ? runner.paceWindowMinutes : null,
      paceMeasuredAt:finite(timestamp(runner?.paceMeasuredAt)) ? timestamp(runner.paceMeasuredAt) : null
    };
    if (!meeting || !finite(meeting.routeKm) || meeting.routeKm < 0) return unavailable(base, 'meeting-unavailable');
    const issue = positionIssue(runner, now);
    if (issue) return unavailable(base, issue);
    const gap = meeting.routeKm - runner.routeKm;
    base.remainingKm = Math.max(0, gap);
    if (gap < -NEAR_MEETING_KM) {
      // Passed along the planned route does not mean physically waiting there.
      return {...base, status:'passed', reason:'meeting-passed', arrivalAt:null, roundedArrivalAt:null, minutesRemaining:0};
    }
    if (Math.abs(gap) <= NEAR_MEETING_KM && distanceMetres(runner, meeting) <= 150) {
      return {...base, status:'arrived', reason:null, ...timing(base.recordedAt, now)};
    }
    if (gap <= 0) return unavailable(base, 'route-unavailable');
    // Only GPS progress along our planned route can supply this ETA. A
    // plausible event/crow-flight speed is still the wrong distance measure.
    // Never borrow another runner's speed or assume a default.
    if (!['recent-tracker-route', 'held-tracker-route'].includes(base.paceSource)) return unavailable(base, 'missing-pace');
    if (base.paceSource === 'held-tracker-route' &&
      (!finite(base.paceMeasuredAt) || base.paceMeasuredAt > base.recordedAt ||
        now-base.paceMeasuredAt > MAX_HELD_PACE_AGE_MS)) return unavailable(base, 'missing-pace');
    const speedKmh = finite(runner.speedKmh) ? runner.speedKmh
      : finite(runner.paceMinPerKm) && runner.paceMinPerKm > 0 ? 60 / runner.paceMinPerKm : null;
    if (speedKmh === null) return unavailable(base, 'missing-pace');
    if (speedKmh <= 0) return unavailable(base, 'stopped');
    if (speedKmh < MIN_SPEED_KMH || speedKmh > MAX_SPEED_KMH) return unavailable(base, 'invalid-pace');
    base.speedKmh = speedKmh;
    base.paceMinPerKm = 60 / speedKmh;
    // Anchor to the actual report, so an unchanged feed cannot slide the
    // expected arrival later every time the browser redraws or polls.
    const arrivalAt = base.recordedAt + gap / speedKmh * 3_600_000;
    if (!finite(arrivalAt) || arrivalAt <= now) return unavailable(base, 'estimate-elapsed');
    return {...base, status:'available', reason:null, ...timing(arrivalAt, now)};
  }

  function estimate(input = {}) {
    const now = currentTime(input.now);
    const runners = Object.fromEntries(runnerIds.map(id => [id, estimateRunner(input.runners?.[id], input.meeting, now, id)]));
    const selected = selectRunner({runners:input.runners, now});
    const base = {runners, selectedRunnerId:selected?.id || null, selectedRunnerName:selected?.name || null, selectionReason:selected?.reason || null};
    if (!selected) return unavailable(base, !input.meeting || !finite(input.meeting.routeKm) ? 'meeting-unavailable' : 'missing-report');
    return {...runners[selected.id], ...base};
  }

  const unavailableLabels = {
    'meeting-unavailable':['ETA · no meet-up', 'An arrival estimate needs the next meet-up on the planned route.'],
    'missing-report':['ETA · waiting', 'Waiting for a current runner tracker position before estimating arrival.'],
    'future-report':['ETA · waiting', 'The tracker report time is ahead of the current time; waiting for a usable report.'],
    'stale-report':['ETA · old report', 'The tracker position is over five minutes old. Waiting for a fresh report before estimating arrival.'],
    'off-route':['ETA · off route', 'A runner is away from the planned route, so a route arrival estimate is unavailable.'],
    'route-unavailable':['ETA · waiting', 'A reliable position on the planned route is needed to estimate arrival.'],
    'missing-pace':['ETA · no pace', 'Waiting for enough recent moving tracker reports to estimate pace along the planned route.'],
    'stopped':['ETA · paused', 'The latest pace reports no forward movement. Arrival will update when a usable moving pace is available.'],
    'invalid-pace':['ETA · no pace', 'The reported pace is not suitable for a reliable arrival estimate.'],
    'estimate-elapsed':['ETA · updating', 'The previous estimate has elapsed. Waiting for a fresh tracker position to confirm progress.'],
    'retired':['ETA unavailable', 'A runner is marked retired on the event tracker, so an arrival estimate is unavailable.'],
    'finished':['ETA unavailable', 'A runner is marked finished on the event tracker, so an onward arrival estimate is unavailable.']
  };

  function format(result, options = {}) {
    const now = currentTime(options.now);
    let clockText, remainingText = '', fullText;
    const state = result?.status || 'unavailable';
    if (state === 'available' && finite(result.arrivalAt) && finite(now)) {
      if (result.arrivalAt <= now) return format({...result, status:'unavailable', reason:'estimate-elapsed'}, options);
      const roundedAt = Math.ceil(result.arrivalAt / ROUNDING_MS) * ROUNDING_MS;
      const clock = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(roundedAt);
      const remaining = (result.arrivalAt - now) / MINUTE;
      const roundedMinutes = Math.ceil(remaining / 5) * 5;
      const hours = Math.floor(roundedMinutes / 60), minutes = roundedMinutes % 60;
      const duration = hours ? hours + 'h' + (minutes ? ' ' + minutes + 'm' : '') : roundedMinutes + ' min';
      clockText = 'ETA ~' + clock;
      remainingText = remaining < 5 ? 'in <5 min' : 'in ~' + duration;
      const dayFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London', day:'numeric', month:'short'});
      const arrivalDay = dayFormat.format(roundedAt), today = dayFormat.format(now);
      const paceNote=result.paceSource==='held-tracker-route'
        ? 'Provisional: carrying an earlier GPS-measured route pace because there are not enough new GPS samples. This is not a confirmed current moving pace; a stop or slowdown may make arrival later.'
        : result.paceExcludesStops
          ? 'Based on GPS progress since the last verified stop, excluding the rest time. Future stops or pace changes can alter it.'
          : result.paceResetAfterGap
            ? 'Based on GPS progress since reporting resumed after a gap; elapsed time without GPS is excluded, and any unrecorded stops are uncertain.'
          : 'Based on estimated route pace from recent GPS progress along our planned route. Future stops or pace changes can alter it.';
      fullText = 'Estimated arrival around ' + clock + (arrivalDay !== today ? ' on ' + arrivalDay : '') + ' UK time, ' + (remaining < 5 ? 'in less than five minutes' : 'in about ' + duration) + '. '+paceNote+' Uses the route distance remaining.';
    } else if (state === 'arrived') {
      clockText = 'At meet-up';
      fullText = 'The latest fresh tracker position is within 150 metres of the meet-up.';
    } else if (state === 'passed') {
      clockText = 'Passed meet-up';
      fullText = 'The latest fresh tracker report has reached or passed the meet-up along the planned route. This does not mean the runner is still there.';
    } else {
      [clockText, fullText] = unavailableLabels[result?.reason] || unavailableLabels['missing-report'];
    }
    if (result?.selectionReason === 'route-pace-fallback') fullText += ' The other runner has a newer position but not enough usable route history yet.';
    const text = clockText + (remainingText ? ' · ' + remainingText : '');
    return {state, clockText, remainingText, text, fullText, ariaLabel:fullText};
  }

  return {derivePace, carryPace, lastStopEndIndex, selectRunner, estimate, format};
});
