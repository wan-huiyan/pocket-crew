'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.upcomingPoints = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const finite = Number.isFinite;
  const isPin = p => p && finite(p.lat) && Math.abs(p.lat) <= 90 && finite(p.lng) && Math.abs(p.lng) <= 180;
  const samePosition = (a, b) => isPin(a) && isPin(b) && a.lat === b.lat && a.lng === b.lng;
  const samePoint = (a, b) => Boolean(a && b && ((a.id && a.id === b.id) || samePosition(a, b)));
  const groupKey = p => p.groupNumber !== null && p.groupNumber !== undefined
    ? 'group-' + String(p.groupNumber)
    : p.pointNumber !== null && p.pointNumber !== undefined
      ? 'group-' + String(p.pointNumber).split('.')[0]
      : 'pin-' + (p.id || p.lat + ',' + p.lng);

  function plan(input = {}) {
    const limit = input.limit === 1 ? 1 : 2;
    const source = Array.isArray(input.points) ? input.points.filter(isPin) : [];
    const statuses = input.statuses && typeof input.statuses === 'object' ? input.statuses : {};
    const knownProgress = finite(input.progressKm) && input.progressKm >= 0;
    const requestedBase = knownProgress ? input.progressKm : 0;
    const finish = finite(input.planningEndKm) && input.planningEndKm >= 0
      ? input.planningEndKm
      : Math.max(requestedBase + 10, ...source.map(p => finite(p.routeKm) ? p.routeKm : 0));
    const pointStatus = p => {
      const value = statuses[p.id];
      return typeof value === 'string' ? value : value?.status;
    };
    // A confirmed passed stop can frame the next section when GPS is missing.
    // It is not a runner position: knownProgress stays false and distances null.
    const confirmedBase = Math.max(0, ...source.filter(p => ['passed','met'].includes(pointStatus(p)) && !p.beyondPlannedFinish && finite(p.routeKm) && p.routeKm <= finish).map(p => p.routeKm));
    const fromKm = Math.min(knownProgress ? requestedBase : confirmedBase, finish);
    const done = p => {
      const status = pointStatus(p);
      return status === 'met' || status === 'skipped' || status === 'passed';
    };
    const inPlan = p => !p.beyondPlannedFinish && (!finite(p.routeKm) || p.routeKm <= finish);
    const ahead = p => finite(p.routeKm) && p.routeKm >= fromKm - .15;
    const usable = p => isPin(p) && inPlan(p) && !done(p);
    const rawSelection = isPin(input.selected) ? input.selected : null;
    // Shared crew state only carries a small meeting payload. Restore the
    // original point's group and landmark metadata without moving its pin.
    const original = rawSelection && source.find(p => samePoint(p, rawSelection));
    let selected = rawSelection ? {...original, ...rawSelection} : null;
    if (original) {
      selected.id = original.id;
      if (rawSelection.id && rawSelection.id !== original.id) selected.sharedId = rawSelection.id;
      if (!finite(rawSelection.routeKm) && finite(original.routeKm)) selected.routeKm = original.routeKm;
    }
    if (selected && (!usable(selected) || (finite(selected.routeKm) && !ahead(selected)))) selected = null;

    const seen = new Set();
    const available = source.filter(p => {
      // Charging stops are extra choices for supporters. They become the
      // runners' destination only after the crew explicitly selects one.
      if (p.optionalMeetup || !usable(p) || !ahead(p)) return false;
      const key = p.id || p.lat + ',' + p.lng;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.routeKm - b.routeKm);
    const chosen = selected ? [selected] : [];
    const groups = new Set(chosen.map(groupKey));
    // A deliberately agreed later point takes precedence over intermediate
    // options. It is never silently replaced by an automatic recommendation.
    const selectedKm = finite(selected?.routeKm) ? selected.routeKm : null;
    for (const p of available) {
      if (chosen.length >= limit) break;
      if (selected && samePoint(p, selected)) continue;
      if (selectedKm !== null && p.routeKm < selectedKm) continue;
      const group = groupKey(p);
      if (groups.has(group)) continue;
      chosen.push(p);
      groups.add(group);
    }

    const points = chosen.map((p, index) => ({
      ...p,
      agreed: Boolean(selected && samePoint(selected, p)),
      sequence: index === 0 ? 'next' : 'then',
      distanceKm: knownProgress && finite(p.routeKm) ? Math.max(0, p.routeKm - fromKm) : null,
      alternatives: available.filter(other => groupKey(other) === groupKey(p) && !samePoint(other, p))
        .map(other => ({...other, distanceKm: knownProgress ? Math.max(0, other.routeKm - fromKm) : null}))
    }));
    const furthest = Math.max(fromKm, ...points.map(p => finite(p.routeKm) ? p.routeKm : fromKm));
    // Keep the next meet-up in frame for runners; crew can plan one further
    // ahead. Never invent an intermediate stop just to fill a distance window.
    const endKm = Math.min(finish, Math.max(fromKm + 10, furthest + .5));
    return {points, fromKm, endKm};
  }
  return {plan};
});
