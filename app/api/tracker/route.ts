import { deriveAchievements, recordAchievements, type AchievementLedger } from "../../../lib/race-milestones.ts";
import { publicCrewConfig } from "../../../lib/public-crew-config.ts";

/** A narrow adapter for the event's own public tracker feed. Only validated
 * official reports can add non-location accomplishment records. */
const PROVIDER = 'https://track.trail.live';
// The provider renamed the public slug during registration. The numeric ID
// keeps both runners attached to this exact race, while the date and slug
// checks prevent a later event from being mistaken for the current one.
const EVENT_ID = 35950;
const EVENT_SLUGS = new Set(['escape-from-meriden', 'escapefrommeriden']);
const EVENT_DATE = '2026-11-13';
const METADATA_TTL = 5 * 60_000;
const PARTICIPANTS_TTL = 30_000;
const TIMEOUT_MS = 8_000;
const PATH_TIMEOUT_MS = 8_000;
const REQUEST_BUDGET_MS = 13_000;
const RECENT_REPORT_WINDOW_MS = 20 * 60_000;
const RECENT_REPORT_LIMIT = 20;
const PACE_REPORT_WINDOW_MS = 120 * 60_000;
const PACE_REPORT_LIMIT = 120;
const PATH_CACHE_LIMIT = 8;

type FeedStatus = 'waiting' | 'live' | 'not-found' | 'unavailable' | 'wrong-event' | 'ambiguous' | 'need-number';
type EventInfo = { id: number; active: boolean; start: string };
type RecentReport = { lat: number; lng: number; recordedAt: string };
type TrackerReports = { recentReports: RecentReport[]; paceReports: RecentReport[]; achievementReports: RecentReport[] };
type PublicParticipant = {
  bib: string;
  name: string;
  lat: number | null;
  lng: number | null;
  updatedAt: string | null;
  finished: boolean;
  retired: boolean;
  crowKm: number | null;
  recentReports: RecentReport[];
  paceReports: RecentReport[];
};
type StandingsParticipant = Omit<PublicParticipant, 'recentReports' | 'paceReports'> & {
  group: string;
  ageCategory: string;
  rank?: number;
  /** An optional GPS-path movement estimate, never organiser crow-flight speed. */
  paceMinPerKm?: number;
  paceAsOf?: string;
};
type CategoryStanding = Omit<StandingsParticipant, 'lat' | 'lng'> & { hasValidLocation: boolean };
type JsonRecord = Record<string, unknown>;

let eventCache: { value: EventInfo; expires: number } | null = null;
let eventPending: Promise<EventInfo> | null = null;
let participantsCache: { eventId: number; value: JsonRecord[]; expires: number } | null = null;
let participantsPending: { eventId: number; promise: Promise<JsonRecord[]> } | null = null;
const pathsCache = new Map<string, { value: RecentReport[]; expires: number }>();
const pathsPending = new Map<string, Promise<RecentReport[]>>();

class WrongEventError extends Error {}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normaliseBib(value: unknown): string {
  const text = cleanText(value, 128).toLowerCase();
  if (text.length > 24) return ''; 
  // Numeric bibs match exactly, including when an input has leading zeroes.
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

function numberInRange(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120) return null;
  // The provider uses IXDTF, e.g. an ISO offset followed by [Europe/London].
  const plain = value.replace(/\[[^\]]+\]$/, '');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(plain)) return null;
  const time = Date.parse(plain);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function fetchJson(path: string, maxCharacters = 5_000_000, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  // Paths are constructed exclusively from the fixed slug or a validated numeric ID.
  const response = await fetch(PROVIDER + path, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    // Workers supports only manual/follow. Manual plus the non-2xx rejection
    // below keeps provider redirects rejected without throwing before fetch.
    redirect: 'manual',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Tracker unavailable');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('Unexpected tracker response');
  const body = await response.text();
  if (body.length > maxCharacters) throw new Error('Tracker response too large');
  return JSON.parse(body);
}

async function getEvent(): Promise<EventInfo> {
  if (eventCache && eventCache.expires > Date.now()) return eventCache.value;
  if (eventPending) return eventPending;
  eventPending = (async () => {
    const payload = record(await fetchJson('/event/' + EVENT_ID));
    const event = record(payload?.event);
    const start = isoTime(event?.start);
    if (!event || event.id !== EVENT_ID || !EVENT_SLUGS.has(String(event.slug)) || !start || !start.startsWith(EVENT_DATE)) {
      throw new WrongEventError('Unexpected event');
    }
    const id = numberInRange(event.id, 1, Number.MAX_SAFE_INTEGER);
    if (id === null || !Number.isInteger(id) || typeof event.active !== 'boolean') {
      throw new Error('Incomplete event data');
    }
    const value = { id, active: event.active, start };
    // Notice activation promptly at the start rather than retaining a pre-race
    // inactive flag for five minutes while everyone is already running.
    eventCache = { value, expires: Date.now() + (value.active ? METADATA_TTL : PARTICIPANTS_TTL) };
    return value;
  })();
  try {
    return await eventPending;
  } finally {
    eventPending = null;
  }
}

async function getParticipants(eventId: number): Promise<JsonRecord[]> {
  if (participantsCache?.eventId === eventId && participantsCache.expires > Date.now()) {
    return participantsCache.value;
  }
  if (participantsPending?.eventId === eventId) return participantsPending.promise;
  const promise = (async () => {
    const payload = await fetchJson('/event/' + eventId + '/participants');
    if (!Array.isArray(payload) || payload.length > 10_000) throw new Error('Unexpected participant data');
    const value = payload.map(record).filter((p): p is JsonRecord => p !== null);
    participantsCache = { eventId, value, expires: Date.now() + PARTICIPANTS_TTL };
    return value;
  })();
  participantsPending = { eventId, promise };
  try {
    return await promise;
  } finally {
    if (participantsPending?.promise === promise) participantsPending = null;
  }
}

async function getTrackerReports(event: EventInfo, participantId: unknown, updatedAt: string, deadline: number, forAchievements = false): Promise<TrackerReports> {
  const empty = (): TrackerReports => ({ recentReports: [], paceReports: [], achievementReports: [] });
  const id = numberInRange(participantId, 1, Number.MAX_SAFE_INTEGER);
  if (id === null || !Number.isInteger(id)) return empty();
  const key = `${event.id}:${id}`;
  const publishedAt = Date.parse(updatedAt);
  const select = (reports: RecentReport[]): TrackerReports => {
    const window = (duration: number, limit: number) => reports.filter(report => {
      const timestamp = Date.parse(report.recordedAt);
      return timestamp >= Math.max(Date.parse(event.start), publishedAt - duration) && timestamp <= publishedAt;
    }).slice(-limit);
    return {
      // Keep the original short-window contract for current arrival pace.
      recentReports: window(RECENT_REPORT_WINDOW_MS, RECENT_REPORT_LIMIT),
      // The longer, independently timed window supports trend estimation.
      // It is not a pace supplied by the crow-flight leaderboard.
      paceReports: window(PACE_REPORT_WINDOW_MS, PACE_REPORT_LIMIT),
      // The provider already returns the full path. Keep it server-side for
      // the two named runners so old crossings can be recorded accurately.
      achievementReports: forAchievements ? reports.filter(p => Date.parse(p.recordedAt) <= publishedAt) : [],
    };
  };
  const cached = pathsCache.get(key);
  if (cached && cached.expires > Date.now()) return select(cached.value);
  let pending = pathsPending.get(key);
  if (!pending) {
    // Leave room for the browser's 15-second request deadline. Optional pace
    // history must not delay a usable position beyond that limit.
    const timeoutMs = Math.min(PATH_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs < 500) return empty();
    pending = (async () => {
      const payload = await fetchJson(`/event/${event.id}/participants/${id}/path`, 1_000_000, timeoutMs);
      if (!Array.isArray(payload) || payload.length > 5_000) throw new Error('Unexpected tracker path');
      const eventStart = Date.parse(event.start);
      const now = Date.now();
      const byTime = new Map<string, RecentReport>();
      for (const item of payload) {
        const sample = record(item);
        if (!sample || typeof sample.lat !== 'number' || typeof sample.lon !== 'number') continue;
        const lat = numberInRange(sample.lat, -90, 90);
        const lng = numberInRange(sample.lon, -180, 180);
        // The official path-scrubber.js uses timeLocal as the GPS report
        // instant (IXDTF). gnssTime represents the same instant in ISO UTC;
        // sendTime is delivery time and must never determine running pace.
        const recordedAt = isoTime(sample.timeLocal);
        if (lat === null || lng === null || !recordedAt) continue;
        if (sample.gnssTime !== undefined && isoTime(sample.gnssTime) !== recordedAt) continue;
        const timestamp = Date.parse(recordedAt);
        if (timestamp < eventStart || timestamp > now) continue;
        byTime.set(recordedAt, { lat, lng, recordedAt });
      }
      const value = [...byTime.values()]
        .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
        .filter(report => forAchievements || Date.parse(report.recordedAt) >= publishedAt - PACE_REPORT_WINDOW_MS)
        .slice(forAchievements ? -5_000 : -PACE_REPORT_LIMIT);
      // Keep this read-only cache bounded even if other bibs are requested.
      if (pathsCache.size >= PATH_CACHE_LIMIT && !pathsCache.has(key)) {
        const oldest = pathsCache.keys().next().value;
        if (oldest !== undefined) pathsCache.delete(oldest);
      }
      pathsCache.set(key, { value, expires: Date.now() + PARTICIPANTS_TTL });
      return value;
    })();
    pathsPending.set(key, pending);
  }
  try {
    return select(await pending);
  } catch {
    // Pace history is optional: failure must not hide a valid live position.
    return empty();
  } finally {
    if (pathsPending.get(key) === pending) pathsPending.delete(key);
  }
}

function publicParticipant(value: JsonRecord): PublicParticipant {
  const report = record(value.lastReport);
  const firstRoute = Array.isArray(value.routes) ? record(value.routes[0]) : null;
  const lat = numberInRange(report?.lat, -90, 90);
  const lng = numberInRange(report?.lon, -180, 180);
  const timestamp = isoTime(report?.timestamp);
  // Future timestamps cannot establish a trustworthy current position.
  const updatedAt = timestamp && Date.parse(timestamp) <= Date.now() + 5 * 60_000 ? timestamp : null;
  return {
    bib: cleanText(value.bib, 24),
    name: cleanText(value.name, 120),
    lat: lat !== null && lng !== null && updatedAt ? lat : null,
    lng: lat !== null && lng !== null && updatedAt ? lng : null,
    updatedAt,
    finished: value.finished === true || firstRoute?.finished === true,
    retired: value.retired === true,
    // Meriden's route distance in this feed is as-the-crow-flies, not distance run.
    // Never expose lastReport.distance as the planned-route kilometre position.
    crowKm: numberInRange(firstRoute?.dist, 0, 1_000),
    // Do not use routes[0].speed for pace: it can be a crow-flight average.
    recentReports: [],
    paceReports: [],
  };
}

/** Recent *moving* pace only. Discard stops, large sampling gaps and GPS
 * jumps; do not interpret a quiet tracker as a runner's walking pace. */
function recentMovingPace(samples: RecentReport[], reportedAt: string): number | null {
  const latest = Date.parse(reportedAt);
  if (!Number.isFinite(latest) || Date.now() - latest > 5 * 60_000) return null;
  const rows = samples.filter(p => {
    const time = Date.parse(p.recordedAt);
    return Number.isFinite(time) && time >= latest - 12 * 60_000 && time <= latest;
  });
  let metres = 0, minutes = 0, segments = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const spanMin = (Date.parse(b.recordedAt) - Date.parse(a.recordedAt)) / 60_000;
    if (spanMin < 0.5 || spanMin > 4.5) continue;
    const r = Math.PI / 180;
    const da = (b.lat - a.lat) * r, dl = (b.lng - a.lng) * r;
    const h = Math.sin(da / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
    const km = 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
    const kmPerHour = km / spanMin * 60;
    if (kmPerHour < 1.5 || kmPerHour > 19) continue;
    metres += km * 1000; minutes += spanMin; segments++;
  }
  if (segments < 2 || metres < 180 || minutes < 3 || Date.parse(rows.at(-1)?.recordedAt || '') < latest - 5 * 60_000) return null;
  const pace = minutes / (metres / 1000);
  return pace >= 3 && pace <= 40 ? Math.round(pace * 100) / 100 : null;
}

function reply(status: FeedStatus, message: string, event: EventInfo | null = null, participants: PublicParticipant[] = [], httpStatus = 200, achievements?: AchievementLedger): Response {
  return Response.json({
    status,
    checkedAt: new Date().toISOString(),
    event: event ? { active: event.active, start: event.start } : null,
    participants,
    message,
    ...(achievements ? { achievements } : {}),
  }, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function achievementLedger(event: EventInfo, participant: PublicParticipant, reports: RecentReport[]): Promise<AchievementLedger | undefined> {
  if (!['247', '133'].includes(participant.bib)) return undefined;
  const records = deriveAchievements(event, participant, reports);
  try {
    // A missing binding or a storage failure must never hide the live feed.
    // Dynamic import also keeps this provider adapter independently testable
    // without requiring a Cloudflare runtime in Node.
    const { env } = await import('cloudflare:workers');
    return await recordAchievements(env.DB, publicCrewConfig(env), records);
  } catch {
    return { eventId: EVENT_ID, records, persisted: false };
  }
}

export async function GET(request: Request): Promise<Response> {
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const rawBib = new URL(request.url).searchParams.get('bib') || '';
  if (rawBib.length > 24 || /[\u0000-\u001f\u007f]/.test(rawBib)) {
    return reply('need-number', 'Enter a race number of up to 24 characters.', null, [], 400);
  }
  const bib = normaliseBib(rawBib);
  if (!bib) return reply('need-number', 'Add the race number after registration.');

  let event: EventInfo | null = null;
  try {
    event = await getEvent();
    const participants = await getParticipants(event.id);
    if (!participants.length) {
      return reply('waiting', 'Waiting for the official tracker to publish participants.', event);
    }
    const matches = participants.filter(p => normaliseBib(p.bib) === bib);
    if (!matches.length) {
      return reply('not-found', 'This number is not in the current tracker list. Check the number or try again after registration.', event);
    }
    const matchedPublic = matches.map(publicParticipant).map(p => event?.active ? p : {
      ...p, lat: null, lng: null, updatedAt: null, crowKm: null,
    });
    if (matches.length > 1) {
      return reply('ambiguous', 'More than one tracker entry has this number. Check the entries in the official tracker before following a position.', event, matchedPublic);
    }
    if (!event.active) {
      return reply('waiting', 'Their race number is confirmed. Positions will appear when the official tracker opens.', event, matchedPublic);
    }
    const participant = matchedPublic[0];
    if (participant.lat === null || participant.lng === null || !participant.updatedAt) {
      return reply('waiting', 'The race number is listed; waiting for a valid position report.', event, matchedPublic);
    }
    const crewRunner = ['247', '133'].includes(participant.bib);
    let achievementReports: RecentReport[] = [];
    if ((!participant.finished && !participant.retired) || crewRunner) {
      const reports = await getTrackerReports(event, matches[0].id, participant.updatedAt, deadline, crewRunner);
      if (!participant.finished && !participant.retired) {
        participant.recentReports = reports.recentReports;
        participant.paceReports = reports.paceReports;
      }
      achievementReports = reports.achievementReports;
    }
    const achievements = await achievementLedger(event, participant, achievementReports);
    return reply('live', 'Latest available report from the official tracker. Check its update time.', event, matchedPublic, 200, achievements);
  } catch (error) {
    if (error instanceof WrongEventError) {
      return reply('wrong-event', 'The tracker link now points to a different event. Open the official tracker to check.', null);
    }
    return reply('unavailable', 'The official tracker could not be reached. Try again shortly or open it directly.', event);
  }
}

/** Read-only, public race comparisons. The event's `dist` is distance from
 * Meriden as the crow flies, never kilometres travelled on the planned route.
 * Keep this separate from Emily's route-pace/meet-up ETA pipeline. */
export async function GET_LEADERBOARD(request: Request): Promise<Response> {
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const respond = (status: FeedStatus, message: string, event: EventInfo | null = null,
    femaleSolo: StandingsParticipant[] = [], roster: { bib: string; name: string; group: string; ageCategory: string }[] = [],
    followed: StandingsParticipant[] = [], allCompetitors: CategoryStanding[] = []): Response => Response.json({
    status, checkedAt: new Date().toISOString(),
    event: event ? { active: event.active, start: event.start } : null,
    metric: 'crow-flight-km',
    femaleSolo, roster, followed, allCompetitors, message,
  }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

  const params = new URL(request.url).searchParams;
  const rawFollow = params.get('follow') || '';
  const viewedCategory = params.get('category') || 'female-solo';
  // Limit response size and reject malformed search parameters without
  // forwarding anything from the user to the official tracker provider.
  if (rawFollow.length > 200 || (rawFollow && !/^\d+(?:,\d+)*$/.test(rawFollow)) ||
      !['female-solo','male-solo','pair','chained','other','all'].includes(viewedCategory)) {
    return respond('need-number', 'Invalid competitor race numbers.');
  }
  const followBibs = [...new Set(rawFollow.split(',').filter(Boolean).map(normaliseBib))].slice(0, 8);
  let event: EventInfo | null = null;
  try {
    event = await getEvent();
    if (!event.active) return respond('waiting', 'Waiting for this race tracker to open.', event);
    const rows = await getParticipants(event.id);
    if (!rows.length) return respond('waiting', 'Waiting for the race participants.', event);
    const participantRows = rows.map(value => {
      const participant = publicParticipant(value);
      const group = cleanText(value.group, 40);
      const ageCategory = cleanText(value.ageCategory, 8);
      return { ...participant, group, ageCategory };
    }).filter(p => /^\d{1,24}$/.test(p.bib) && p.name);
    // Duplicate bibs are ambiguous; do not silently attribute their position
    // or rank to one of the entries.
    const bibCounts = new Map<string, number>();
    participantRows.forEach(p => bibCounts.set(p.bib, (bibCounts.get(p.bib) || 0) + 1));
    const unique = participantRows.filter(p => bibCounts.get(p.bib) === 1).map(({recentReports, paceReports, ...p}) => p);
    const femaleSolo = unique.filter(p => p.group === 'Solo' && p.ageCategory === 'F')
      .sort((a,b) => (b.crowKm ?? -1) - (a.crowKm ?? -1) || Number(a.bib) - Number(b.bib))
      .map((p, index) => ({...p, ...(p.crowKm !== null ? {rank: index + 1} : {})}));
    // All public event categories share the same crow-flight scoring unit,
    // but this is a *comparison*, not an organiser-certified overall award.
    // No unrelated competitor coordinates or path history are sent en masse.
    const allCompetitors: CategoryStanding[] = [...unique]
      .sort((a,b) => (b.crowKm ?? -1) - (a.crowKm ?? -1) || Number(a.bib) - Number(b.bib))
      .map((p,index) => {
        const {lat,lng,...safeFields}=p;
        return {...safeFields,hasValidLocation:lat!==null && lng!==null,
          ...(p.crowKm!==null ? {rank:index+1}:{})};
      });
    const roster = unique.map(({bib, name, group, ageCategory}) => ({bib, name, group, ageCategory}))
      .sort((a,b) => a.name.localeCompare(b.name));
    const followed = followBibs.flatMap(bib => unique.filter(p => p.bib === bib));
    // Only a small, bounded selection of *currently reporting* runners gets
    // a path lookup. Paths stay server-side; the response reveals only the
    // derived pace, never other runners' private movement history.
    const fresh = (p: Pick<StandingsParticipant, 'updatedAt' | 'finished' | 'retired'>) => !!p.updatedAt && !p.finished && !p.retired &&
      Date.now() - Date.parse(p.updatedAt) >= -30_000 && Date.now() - Date.parse(p.updatedAt) <= 5 * 60_000;
    const categoryMatch = (p: CategoryStanding) => viewedCategory==='all' ||
      viewedCategory==='female-solo' && p.group==='Solo' && p.ageCategory==='F' ||
      viewedCategory==='male-solo' && p.group==='Solo' && p.ageCategory==='M' ||
      viewedCategory==='pair' && p.group==='Pair' || viewedCategory==='chained' && p.group==='Chained' ||
      viewedCategory==='other' && !(['Pair','Chained'].includes(p.group) || p.group==='Solo' && ['F','M'].includes(p.ageCategory));
    const candidates=[...followed, ...femaleSolo.filter(p=>p.bib==='247'), ...allCompetitors.filter(categoryMatch)];
    const paceCandidates=[...new Map(candidates.filter(fresh).map(p=>[p.bib,p])).values()].slice(0,8);
    await Promise.all(paceCandidates.map(async p => {
      const upstream = rows.find(row => normaliseBib(row.bib) === p.bib);
      if (!upstream || !p.updatedAt) return;
      const reports = await getTrackerReports(event!, upstream.id, p.updatedAt, deadline);
      const paceMinPerKm = recentMovingPace(reports.recentReports, p.updatedAt);
      if (paceMinPerKm === null) return;
      for (const row of [...femaleSolo, ...followed, ...allCompetitors]) if (row.bib === p.bib) {
        row.paceMinPerKm = paceMinPerKm;
        row.paceAsOf = p.updatedAt;
      }
    }));
    return respond('live', 'Public tracker standings, provisional until reports are current. Cross-category order is an informal crow-flight comparison, not an official overall title.', event, femaleSolo, roster, followed, allCompetitors);
  } catch (error) {
    return error instanceof WrongEventError
      ? respond('wrong-event', 'The official tracker now points to a different event.')
      : respond('unavailable', 'The official standings could not be reached. Try again shortly.', event);
  }
}
