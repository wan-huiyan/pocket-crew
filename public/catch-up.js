'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.catchUp = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MINUTE = 60_000, HOUR = 3_600_000;
  const MAX_AGE_MS = 5 * MINUTE, MAX_TIME_DIFFERENCE_MS = 2 * MINUTE;
  const MAX_FUTURE_MS = 30_000, MAX_OFF_ROUTE_M = 500, NEAR_KM = .1;
  const finite = Number.isFinite;
  const time = value => typeof value === 'number' && finite(value) && value > 0 ? value
    : typeof value === 'string' ? Date.parse(value) : NaN;
  const speed = runner => runner?.paceSource === 'recent-tracker-route'
    ? finite(runner.speedKmh) ? runner.speedKmh
      : finite(runner.paceMinPerKm) && runner.paceMinPerKm > 0 ? 60 / runner.paceMinPerKm : null
    : null;

  const reasons = {
    'missing-report':'Waiting for fresh GPS reports from both Jeff and Matt.',
    'stale-report':'One tracker report is over five minutes old. Catch-up estimates will return with fresh reports.',
    'future-report':'A tracker time is ahead of this device. Waiting for usable report times.',
    'off-route':'Jeff and Matt need to be on the same planned route for a useful catch-up estimate.',
    'route-unavailable':'Waiting for both tracker positions to match the planned route.',
    'missing-jeff-pace':'Waiting for enough recent Jeff GPS reports to estimate his route pace.',
    'missing-matt-pace':'Waiting for enough recent Matt GPS reports to estimate his route pace.',
    'invalid-pace':'The recent route pace is not suitable for a catch-up estimate.',
    'unaligned-reports':'Their tracker times are more than two minutes apart. Waiting for closer reports before comparing progress.',
    retired:'A runner is marked retired on the event tracker.',
    finished:'A runner is marked finished on the event tracker.',
    'route-end':'The latest pace would put a runner beyond our planned route. Waiting for a fresh position.',
    'no-closing':'At their recent route paces, the gap is not closing.',
    'catch-beyond-route':'At these paces, the projected catch would be beyond our planned route.',
    'target-beyond-route':'Matt would be beyond our planned route at that target time. Choose a shorter target.',
    'target-too-fast':'That target would require more than 30 km/h. Choose a longer target.'
  };

  function issue(runner, now) {
    if (!runner) return 'missing-report';
    if (runner.retired) return 'retired';
    if (runner.finished) return 'finished';
    const at = time(runner.recordedAt || runner.updatedAt);
    if (!finite(now) || !finite(at)) return 'missing-report';
    if (at > now + MAX_FUTURE_MS) return 'future-report';
    if (now - at >= MAX_AGE_MS) return 'stale-report';
    if (runner.fresh !== true || !finite(runner.lat) || Math.abs(runner.lat) > 90 || !finite(runner.lng) || Math.abs(runner.lng) > 180) return 'missing-report';
    if (finite(runner.offRouteM) && runner.offRouteM >= MAX_OFF_ROUTE_M) return 'off-route';
    if (!finite(runner.routeKm) || runner.routeKm < 0 || !finite(runner.offRouteM) || runner.offRouteM < 0) return 'route-unavailable';
    return null;
  }

  function estimate(input = {}) {
    const now = input.now === undefined ? Date.now() : input.now;
    const horizonMinutes = [120,300].includes(input.horizonMinutes) ? input.horizonMinutes : 120;
    const jeff = input.jeff, rivalSnapshot = input.rival;
    const matt = rivalSnapshot?.position ? {...rivalSnapshot.position, retired:rivalSnapshot.retired === true || rivalSnapshot.position.retired === true, finished:rivalSnapshot.finished === true || rivalSnapshot.position.finished === true} : rivalSnapshot;
    const base = {
      status:'unavailable', reason:null, reasonText:'', horizonMinutes,
      referenceAt:null, sampleAt:null, gapKm:null, timeAligned:false, alignmentSeconds:null,
      jeffPaceMinPerKm:null, mattPaceMinPerKm:null, requiredPaceMinPerKm:null,
      requiredSpeedKmh:null, targetAt:null, targetReason:null, targetReasonText:'',
      catchAtCurrentPace:null, catchMinutes:null, catchRouteKm:null,
      catchReason:null, catchReasonText:'',
      note:'Estimates use recent GPS progress along the planned route, including recent stops. The target pace must be sustained for the selected time and assumes Matt keeps his recent pace; stops, detours or pace changes will alter it.'
    };
    const unavailable = reason => ({...base, reason, reasonText:reasons[reason] || reasons['missing-report']});
    const positionIssue = issue(jeff, now) || issue(matt, now);
    if (positionIssue) return unavailable(positionIssue);
    const jeffSpeed = speed(jeff), mattSpeed = speed(matt);
    if (jeffSpeed === null) return unavailable('missing-jeff-pace');
    if (mattSpeed === null) return unavailable('missing-matt-pace');
    if (![jeffSpeed,mattSpeed].every(value => finite(value) && value >= .5 && value <= 30)) return unavailable('invalid-pace');
    base.jeffPaceMinPerKm = 60 / jeffSpeed;
    base.mattPaceMinPerKm = 60 / mattSpeed;
    const jeffAt = time(jeff.recordedAt || jeff.updatedAt), mattAt = time(matt.recordedAt || matt.updatedAt);
    if (Math.abs(jeffAt - mattAt) > MAX_TIME_DIFFERENCE_MS) return unavailable('unaligned-reports');

    // Compare at one common time. Each report may advance for at most the
    // five-minute freshness window, and source times must be within two
    // minutes of one another. These are estimates, never new GPS positions.
    const referenceAt = Math.max(now, jeffAt, mattAt);
    const jeffKm = jeff.routeKm + jeffSpeed * (referenceAt - jeffAt) / HOUR;
    const mattKm = matt.routeKm + mattSpeed * (referenceAt - mattAt) / HOUR;
    const routeEnd = finite(input.routeLengthKm) ? input.routeLengthKm
      : finite(matt.routeLengthKm) ? matt.routeLengthKm : Infinity;
    if (jeffKm > routeEnd || mattKm > routeEnd) return unavailable('route-end');
    const gapKm = mattKm - jeffKm;
    Object.assign(base, {
      referenceAt, sampleAt:Math.max(jeffAt,mattAt), gapKm,
      timeAligned:referenceAt !== jeffAt || referenceAt !== mattAt,
      alignmentSeconds:Math.max(referenceAt - jeffAt,referenceAt - mattAt) / 1000
    });
    if (gapKm < -NEAR_KM) return {...base,status:'ahead',reason:null,reasonText:'Jeff is estimated ahead of Matt along the planned route.'};
    if (gapKm <= NEAR_KM) return {...base,status:'together',reason:null,reasonText:'Their estimated route positions are within 100 metres of each other.'};

    base.status = 'available';
    const targetHours = horizonMinutes / 60, targetMattKm = mattKm + mattSpeed * targetHours;
    const requiredSpeedKmh = mattSpeed + gapKm / targetHours;
    if (targetMattKm > routeEnd) base.targetReason = 'target-beyond-route';
    else if (requiredSpeedKmh > 30) base.targetReason = 'target-too-fast';
    else Object.assign(base,{requiredSpeedKmh,requiredPaceMinPerKm:60 / requiredSpeedKmh,targetAt:referenceAt + horizonMinutes * MINUTE});
    base.targetReasonText = reasons[base.targetReason] || '';
    const closingSpeed = jeffSpeed - mattSpeed;
    if (closingSpeed <= 0) base.catchReason = 'no-closing';
    else {
      const catchHours = gapKm / closingSpeed;
      const catchRouteKm = mattKm + mattSpeed * catchHours;
      if (catchRouteKm > routeEnd) base.catchReason = 'catch-beyond-route';
      else Object.assign(base,{catchAtCurrentPace:referenceAt + catchHours * HOUR,catchMinutes:catchHours * 60,catchRouteKm});
    }
    base.catchReasonText = reasons[base.catchReason] || '';
    return base;
  }

  function formatPace(paceMinPerKm) {
    if (!finite(paceMinPerKm) || paceMinPerKm <= 0) return 'Pace waiting';
    const seconds = Math.round(paceMinPerKm * 60);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0') + ' /km';
  }

  return {estimate,formatPace};
});
