import plannedRoute from "../public/data/milestone-route.json" with { type: "json" };
import type { PublicCrewConfig } from "./crew-room.ts";

// Official organiser: silver 30 miles, gold 60 miles, measured as the crow
// flies. Marathon and the 50–123 km celebrations use the planned route.
// The rounded Meriden Cross origin makes all mapped crossings estimates;
// the organiser's results, not this guide, determine medal qualification.
export const RACE_EVENT_ID = 35950;
const ORIGIN = { lat: 52.4379, lng: -1.6496 };
const RUNNERS = { "247": { id: "emily", name: "emily simmons" }, "133": { id: "jeff", name: "jeff simmons" } } as const;
const DEFINITIONS = [
  { id: "marathon", basis: "route", thresholdKm: 42.195 },
  { id: "silver", basis: "crow", thresholdKm: 48.28032 },
  { id: "gold", basis: "crow", thresholdKm: 96.56064 },
  { id: "km-50", basis: "route", thresholdKm: 50, emilyOnly: true },
  { id: "km-60", basis: "route", thresholdKm: 60, emilyOnly: true },
  { id: "km-70", basis: "route", thresholdKm: 70, emilyOnly: true },
  { id: "km-80", basis: "route", thresholdKm: 80, emilyOnly: true },
  { id: "km-90", basis: "route", thresholdKm: 90, emilyOnly: true },
  { id: "km-100", basis: "route", thresholdKm: 100, emilyOnly: true },
  { id: "km-110", basis: "route", thresholdKm: 110, emilyOnly: true },
  { id: "km-120", basis: "route", thresholdKm: 120, emilyOnly: true },
  { id: "km-123", basis: "route", thresholdKm: 123, emilyOnly: true },
] as const;
const MINUTE = 60_000;
type Point = { lat: number; lng: number };
type Report = Point & { recordedAt: string };
type Sample = Report & { at: number; routeKm: number | null; crowKm: number };
type EventInfo = { id: number; active: boolean; start: string };
type Participant = { bib: string; name: string; lat: number | null; lng: number | null; updatedAt: string | null };
export type RaceAchievement = {
  id: string;
  eventId: number;
  runnerId: "emily" | "jeff";
  bib: "247" | "133";
  milestoneId: typeof DEFINITIONS[number]["id"];
  crossedAt: string | null;
  firstSeenBeyondAt: string;
  recordedAt: string;
  estimated: true;
  backfilled: boolean;
  evidence: { beforeAt: string | null; afterAt: string };
};
export type AchievementLedger = { eventId: number; records: RaceAchievement[]; persisted: boolean };

export function distanceKm(a: Point, b: Point) {
  const r = Math.PI / 180, y = (b.lat - a.lat) * r, x = (b.lng - a.lng) * r;
  const s = Math.sin(y / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(x / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

// A small spatial index avoids projecting every historical sample against
// every route segment on each Worker request. Outside its route corridor,
// route-distance evidence is unavailable; crow-flight evidence remains independent.
let routeLength = 0;
const route = plannedRoute.coordinates.map(([lng, lat], i, all) => {
  if (i) routeLength += distanceKm({ lat: all[i - 1][1], lng: all[i - 1][0] }, { lat, lng });
  return { lat, lng, km: routeLength };
});
const cells = new Map<string, number[]>();
for (let i = 1; i < route.length; i++) {
  const a = route[i - 1], b = route[i];
  for (let y = Math.floor((Math.min(a.lat, b.lat) - .006) / .02); y <= Math.floor((Math.max(a.lat, b.lat) + .006) / .02); y++) {
    for (let x = Math.floor((Math.min(a.lng, b.lng) - .010) / .02); x <= Math.floor((Math.max(a.lng, b.lng) + .010) / .02); x++) {
      const key = y + ":" + x, ids = cells.get(key) || [];
      ids.push(i); cells.set(key, ids);
    }
  }
}
export function projectRoute(point: Point): { routeKm: number; offRouteM: number } | null {
  const ids = cells.get(Math.floor(point.lat / .02) + ":" + Math.floor(point.lng / .02));
  if (!ids) return null;
  const longitudeScale = Math.cos(point.lat * Math.PI / 180);
  let best = Infinity, result: { routeKm: number; offRouteM: number } | null = null;
  for (const i of ids) {
    const a = route[i - 1], b = route[i];
    const ax = (a.lng - point.lng) * longitudeScale, ay = a.lat - point.lat;
    const dx = (b.lng - a.lng) * longitudeScale, dy = b.lat - a.lat;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const offRouteM = distanceKm(point, { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }) * 1000;
    if (offRouteM < best) { best = offRouteM; result = { routeKm: a.km + t * (b.km - a.km), offRouteM }; }
  }
  return result && result.offRouteM < 500 ? result : null;
}

function sanePoint(point: unknown): point is Point {
  const p = point as Point | null;
  return Boolean(p && Number.isFinite(p.lat) && p.lat >= 49 && p.lat <= 56 && Number.isFinite(p.lng) && p.lng >= -6 && p.lng <= 3);
}
const iso = (value: unknown) => typeof value === "string" && /^2026-11-1[345]T/.test(value) && Number.isFinite(Date.parse(value));
function plausible(a: Sample, b: Sample, maxGap = 10 * MINUTE) {
  const dt = b.at - a.at;
  return dt > 0 && dt <= maxGap && distanceKm(a, b) / dt * 3_600_000 <= 35;
}

/** Called only with a validated unique participant from the fixed event feed. */
export function deriveAchievements(event: EventInfo, participant: Participant, reports: Report[], now = Date.now()): RaceAchievement[] {
  const runner = RUNNERS[participant.bib as keyof typeof RUNNERS];
  const start = Date.parse(event.start), end = start + 24 * 60 * MINUTE;
  if (!runner || participant.name.toLowerCase().trim().replace(/\s+/g, " ") !== runner.name || event.id !== RACE_EVENT_ID || !event.active
    || !event.start.startsWith("2026-11-13T") || !Number.isFinite(start) || now < start) return [];
  const byTime = new Map<number, Report>();
  for (const p of reports) {
    const at = Date.parse(p?.recordedAt);
    if (sanePoint(p) && Number.isFinite(at) && at >= start && at <= Math.min(now, end)) byTime.set(at, p);
  }
  if (sanePoint(participant) && participant.updatedAt) {
    const at = Date.parse(participant.updatedAt);
    if (at >= start && at <= Math.min(now, end)) byTime.set(at, { lat: participant.lat!, lng: participant.lng!, recordedAt: participant.updatedAt });
  }
  const samples: Sample[] = [...byTime].sort(([a], [b]) => a - b).map(([at, p]) => ({ ...p, at, routeKm: projectRoute(p)?.routeKm ?? null, crowKm: distanceKm(ORIGIN, p) }));
  const records: RaceAchievement[] = [];
  for (const def of DEFINITIONS) {
    const routeCelebration = "emilyOnly" in def;
    if (routeCelebration && runner.id !== "emily") continue;
    const revealsPoster = routeCelebration || (runner.id === "emily" && def.id === "gold");
    let before: Sample | null = null;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i], metric = def.basis === "route" ? p.routeKm : p.crowKm;
      if (metric === null) { before = null; continue; }
      if (metric < def.thresholdKm) { before = p; continue; }
      // A little distance beyond the boundary avoids celebrating rounding or
      // boundary jitter. We still interpolate the threshold, not this margin.
      if (metric < def.thresholdKm + .03) continue;
      const beforeMetric = before && (def.basis === "route" ? before.routeKm : before.crowKm);
      const crossedCleanly = before && beforeMetric !== null && plausible(before, p)
        && (def.basis !== "route" || (metric - beforeMetric!) / (p.at - before.at) * 3_600_000 <= 35);
      const adjacent = [samples[i - 1], samples[i + 1]].filter((q): q is Sample => Boolean(q));
      const corroborated = adjacent.some(q => {
        const qm = def.basis === "route" ? q.routeKm : q.crowKm;
        return qm !== null && qm >= def.thresholdKm + (revealsPoster ? .03 : 0)
          && (q.at < p.at ? plausible(q, p, 30 * MINUTE) : plausible(p, q, 30 * MINUTE))
          && (def.basis !== "route" || Math.abs(metric - qm) / Math.abs(p.at - q.at) * 3_600_000 <= 35);
      });
      // Newly revealed posters need two plausible fixes beyond the boundary.
      // A single noisy or delayed point must not reveal a future surprise.
      // A valid before-fix still supplies the estimated crossing time.
      if (revealsPoster && !corroborated) continue;
      if (!crossedCleanly && !corroborated) { before = null; continue; }
      const crossedAt = crossedCleanly && before && beforeMetric !== null
        ? new Date(Math.round((before.at + (p.at - before.at) * (def.thresholdKm - beforeMetric!) / (metric - beforeMetric!)) / 1000) * 1000).toISOString() : null;
      records.push({
        id: `${RACE_EVENT_ID}:${runner.id}:${def.id}`, eventId: RACE_EVENT_ID,
        runnerId: runner.id, bib: participant.bib as "247" | "133", milestoneId: def.id,
        crossedAt, firstSeenBeyondAt: p.recordedAt, recordedAt: new Date(now).toISOString(), estimated: true,
        backfilled: !crossedAt || now - p.at > 5 * MINUTE,
        evidence: { beforeAt: crossedAt ? before!.recordedAt : null, afterAt: p.recordedAt },
      });
      break;
    }
  }
  return records;
}

/** Whitelist only non-location achievement facts for both live and archived reads. */
export function safeAchievements(value: unknown): RaceAchievement[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, RaceAchievement>();
  for (const item of value.slice(0, 32)) {
    if (!item || typeof item !== "object") continue;
    const p = item as RaceAchievement, runner = RUNNERS[p.bib];
    const definition = DEFINITIONS.find(d => d.id === p.milestoneId);
    if (!runner || p.eventId !== RACE_EVENT_ID || p.runnerId !== runner.id || !definition || ("emilyOnly" in definition && runner.id !== "emily")
      || p.id !== `${RACE_EVENT_ID}:${p.runnerId}:${p.milestoneId}` || !iso(p.firstSeenBeyondAt) || !iso(p.recordedAt)
      || (p.crossedAt !== null && !iso(p.crossedAt)) || !p.evidence || !iso(p.evidence.afterAt)
      || (p.evidence.beforeAt !== null && !iso(p.evidence.beforeAt))) continue;
    result.set(p.id, { id: p.id, eventId: RACE_EVENT_ID, runnerId: p.runnerId, bib: p.bib, milestoneId: p.milestoneId,
      crossedAt: p.crossedAt, firstSeenBeyondAt: p.firstSeenBeyondAt, recordedAt: p.recordedAt,
      estimated: true, backfilled: p.backfilled === true,
      evidence: { beforeAt: p.evidence.beforeAt, afterAt: p.evidence.afterAt } });
  }
  return [...result.values()].sort((a, b) => (a.crossedAt || a.firstSeenBeyondAt).localeCompare(b.crossedAt || b.firstSeenBeyondAt) || a.id.localeCompare(b.id));
}

type MetadataRow = { meetup_json: string | null; expires_at: number };
function envelope(json: string | null): Record<string, unknown> {
  try {
    const value = json ? JSON.parse(json) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.hasOwn(value, "id") ? { meetup: value, celebrations: {} } : value;
  } catch { return {}; }
}

function reachedBy(record: RaceAchievement, now: number) {
  return Date.parse(record.firstSeenBeyondAt) <= now && Date.parse(record.recordedAt) <= now
    && Date.parse(record.evidence.afterAt) <= now
    && (record.evidence.beforeAt === null || Date.parse(record.evidence.beforeAt) <= now)
    && (record.crossedAt === null || Date.parse(record.crossedAt) <= now);
}

function posterId(record: RaceAchievement) {
  return record.runnerId === "emily" && (record.milestoneId.startsWith("km-") || record.milestoneId === "gold")
    ? record.milestoneId : null;
}

/** Server-only write: no client supplied record or new publish capability. */
export async function recordAchievements(db: D1Database | undefined, config: PublicCrewConfig | undefined, candidates: RaceAchievement[], now = Date.now()): Promise<AchievementLedger> {
  const earned = safeAchievements(candidates).filter(record => reachedBy(record, now));
  const fallback = { eventId: RACE_EVENT_ID, records: earned, persisted: false };
  if (!db || !config || !/^[a-f0-9]{64}$/.test(config.viewHash) || !/^[a-f0-9]{64}$/.test(config.publishHash)) return fallback;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await db.batch<MetadataRow>([db.prepare("SELECT meetup_json, expires_at FROM crew_rooms WHERE view_hash = ? AND publish_hash = ? LIMIT 1").bind(config.viewHash, config.publishHash)]);
    const row = rows[0].results[0];
    if (!row) return fallback;
    const metadata = envelope(row.meetup_json), previous = safeAchievements(metadata.raceAchievements);
    if (now >= row.expires_at || now >= config.expiresAt) return { eventId: RACE_EVENT_ID, records: previous, persisted: true };
    const records = new Map(previous.map(p => [p.id, p]));
    for (const candidate of earned) if (!records.has(candidate.id)) records.set(candidate.id, candidate);
    const merged = safeAchievements([...records.values()]);
    const releases = metadata.celebrations && typeof metadata.celebrations === "object" && !Array.isArray(metadata.celebrations)
      ? { ...metadata.celebrations as Record<string, unknown> } : {};
    const reached = merged.filter(record => reachedBy(record, now));
    const eligiblePosters = new Set<string>();
    for (const record of reached) {
      const id = posterId(record);
      if (id) eligiblePosters.add(id);
    }
    // This is a shared achievement: both recorded marathon crossings must
    // exist in the committed ledger. Jeff's historical record still counts
    // after his tracker is retired; a missing crossing is never inferred.
    if (["emily", "jeff"].every(runnerId => reached.some(record => record.runnerId === runnerId && record.milestoneId === "marathon"))) {
      eligiblePosters.add("marathon");
    }
    let released = false;
    for (const id of eligiblePosters) {
      if (typeof releases[id] === "number" && Number.isFinite(releases[id]) && releases[id] > 0) continue;
      // A first detected/backfilled crossing is released now. The ledger keeps
      // the estimated race time separately; late joins must not invent it.
      releases[id] = now;
      released = true;
    }
    if (merged.length === previous.length && !released) return { eventId: RACE_EVENT_ID, records: previous, persisted: true };
    metadata.raceAchievements = merged;
    if (released) metadata.celebrations = releases;
    // Preserve simultaneous location, checkpoint, EV and poster updates.
    // Achievement writes deliberately do not refresh any location timestamp.
    const result = await db.prepare("UPDATE crew_rooms SET meetup_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE view_hash = ? AND publish_hash = ? AND expires_at > ? AND meetup_json IS ?")
      .bind(JSON.stringify(metadata), now, config.viewHash, config.publishHash, now, row.meetup_json).run();
    if (result.meta.changes > 0) return { eventId: RACE_EVENT_ID, records: merged, persisted: true };
  }
  return fallback;
}
