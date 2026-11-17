import checkpointPlan from "../public/data/support-points.json" with { type: "json" };
import { RACE_EVENT_ID, safeAchievements, type RaceAchievement } from "./race-milestones.ts";

// New rooms cover pre-race setup as well as the full 24-hour event. Existing
// rooms retain their stored expiry; reads and updates never extend it.
const ROOM_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_POSITION_AGE_MS = 2 * 60 * 1000;
const MAX_CLOCK_AHEAD_MS = 30 * 1000;
const CREATE_WINDOW_MS = 15 * 60 * 1000;
const CREATE_LIMIT = 6;
const createWindows = new Map<string, { startedAt: number; count: number }>();
const CELEBRATION_IDS = ["start", "marathon", "km-50", "km-60", "km-70", "km-80", "km-90", "km-100", "gold", "km-110", "km-120", "km-123"] as const;
type CelebrationId = typeof CELEBRATION_IDS[number];
type Celebration = { id: CelebrationId; releasedAt: string };

type Meetup = {
  id: string;
  label: string;
  routeKm: number | null;
  lat: number | null;
  lng: number | null;
  mapUrl: string;
  note: string;
};

type PositionInput = { lat: number; lng: number; accuracy: number; recordedAt: number };
type SupporterId = "huiyan" | "graham" | "jeff" | "ben";
type SupporterPlan = { mode: "walking" | "meeting"; updatedAt: string };
type CheckpointAction = { action: "complete" | "skip" | "undo" | "select" | "add-ev" | "remove-ev"; pointId: string };
type CheckpointStatus = { status: "met" | "skipped"; at: string };
type PlannedPoint = { id: string; label: string; routeKm: number; lat: number; lng: number; town?: string; detail?: string; optionalMeetup?: boolean; landmark?: { meetingNote?: string } };
const CHECKPOINT_GROUPS = checkpointPlan.groups
  .filter(group => !group.beyondPlannedFinish && group.routeKm <= checkpointPlan.planningEndKm)
  .map(group => ({ id: group.id, routeKm: group.routeKm, points: group.options as PlannedPoint[] }))
  .sort((a, b) => a.routeKm - b.routeKm);
const CHECKPOINT_IDS = new Set(CHECKPOINT_GROUPS.flatMap(group => group.points.map(point => point.id)));
const EV_POINT_IDS = new Set(CHECKPOINT_GROUPS.flatMap(group => group.points.filter(point => point.optionalMeetup).map(point => point.id)));
const FIXED_PASSED_IDS = checkpointPlan.confirmedPassedPointIds.filter(id => CHECKPOINT_IDS.has(id));
type CheckpointReceipt = {
  pointId: string;
  action: "complete" | "skip";
  completedAt: string;
  previousCompletedPointIds: string[];
  previousCheckpointStatuses: Record<string, CheckpointStatus>;
  previousMeetup: Meetup | null;
  nextMeetup: Meetup | null;
};
type CrewPatch = {
  personId?: SupporterId;
  position?: PositionInput | null;
  bib?: string;
  meetup?: Meetup | null;
  googleMapsUrl?: string | null;
  sharing?: boolean;
  celebration?: CelebrationId;
  checkpoint?: CheckpointAction;
  supporterPlan?: { personId: SupporterId; mode: SupporterPlan["mode"] };
};

export type PublicCrewConfig = {
  viewHash: string;
  publishHash: string;
  /** Optional supporter location/plan recovery grant. Never returned with a room. */
  locationHash?: string;
  expiresAt: number;
};

type RoomRow = {
  view_hash: string;
  publish_hash: string;
  created_at: number;
  expires_at: number;
  updated_at: number;
  sharing: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  position_updated_at: number | null;
  position_recorded_at: number | null;
  bib: string;
  meetup_json: string | null;
  google_maps_url: string | null;
};

class CrewError extends Error {
  status: number;
  code: string;
  extraHeaders: Record<string, string>;

  constructor(status: number, code: string, message: string, extraHeaders: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extraHeaders = extraHeaders;
  }
}

function reply(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      Vary: "Authorization",
      ...extraHeaders,
    },
  });
}

function invalid(message: string): never {
  throw new CrewError(400, "invalid_request", message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Send a JSON object.");
  return value as Record<string, unknown>;
}

function checkKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("The request includes an unsupported field.");
}

function textValue(value: unknown, name: string, max: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > max) invalid(`${name} must be text of at most ${max} characters.`);
  const text = value.trim();
  if (!allowEmpty && !text) invalid(`${name} is required.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) invalid(`${name} contains unsupported characters.`);
  return text;
}

function numberValue(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(`${name} is outside its allowed range.`);
  return value;
}

function googleMapsUrl(value: unknown, name: string): string {
  const text = textValue(value, name, 2048, false);
  let url: URL;
  try { url = new URL(text); } catch { return invalid(`${name} must be a Google Maps link.`); }
  const host = url.hostname.toLowerCase();
  const mainHosts = ["google.com", "www.google.com", "google.co.uk", "www.google.co.uk"];
  const mapsHosts = ["maps.google.com", "maps.google.co.uk"];
  const allowed = (mainHosts.includes(host) && (url.pathname === "/maps" || url.pathname.startsWith("/maps/")))
    || mapsHosts.includes(host)
    || (host === "maps.app.goo.gl" && /^\/[a-z0-9_-]+\/?$/i.test(url.pathname))
    || (host === "goo.gl" && url.pathname.startsWith("/maps/"));
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowed) invalid(`${name} must be an HTTPS Google Maps link.`);
  return url.href;
}

function parseMeetup(value: unknown): Meetup | null {
  if (value === null) return null;
  const item = asRecord(value);
  checkKeys(item, ["id", "label", "routeKm", "lat", "lng", "mapUrl", "note"]);
  const id = textValue(item.id, "Meet-up ID", 80, false);
  if (!/^[a-z0-9_-]+$/i.test(id)) invalid("Meet-up ID contains unsupported characters.");
  if ((item.lat == null) !== (item.lng == null)) invalid("Include both meet-up coordinates, or leave both empty.");
  return {
    id,
    label: textValue(item.label, "Meet-up name", 160, false),
    routeKm: item.routeKm == null ? null : numberValue(item.routeKm, "Route distance", 0, 300),
    lat: item.lat == null ? null : numberValue(item.lat, "Meet-up latitude", -90, 90),
    lng: item.lng == null ? null : numberValue(item.lng, "Meet-up longitude", -180, 180),
    mapUrl: googleMapsUrl(item.mapUrl, "Meet-up map link"),
    note: textValue(item.note ?? "", "Meet-up note", 600),
  };
}

function parsePosition(value: unknown, now: number): PositionInput | null {
  if (value === null) return null;
  const item = asRecord(value);
  checkKeys(item, ["lat", "lng", "accuracy", "recordedAt"]);
  let recordedAt: number;
  if (typeof item.recordedAt === "number") recordedAt = item.recordedAt;
  else if (typeof item.recordedAt === "string" && item.recordedAt.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(item.recordedAt)) recordedAt = Date.parse(item.recordedAt);
  else return invalid("Include the position’s recordedAt time.");
  if (!Number.isFinite(recordedAt) || recordedAt < now - MAX_POSITION_AGE_MS || recordedAt > now + MAX_CLOCK_AHEAD_MS) invalid("That position is too old or its time is invalid. Request a fresh GPS position.");
  return {
    lat: numberValue(item.lat, "Latitude", -90, 90),
    lng: numberValue(item.lng, "Longitude", -180, 180),
    accuracy: numberValue(item.accuracy, "Position accuracy", 0, 100000),
    recordedAt: Math.round(recordedAt),
  };
}

function parsePatch(value: unknown, now: number): CrewPatch {
  const input = asRecord(value);
  checkKeys(input, ["personId", "position", "bib", "meetup", "googleMapsUrl", "sharing", "celebration", "checkpoint", "supporterPlan"]);
  if (!Object.keys(input).length) invalid("Include a crew update.");
  const patch: CrewPatch = {};
  if (Object.hasOwn(input, "supporterPlan")) {
    if (Object.keys(input).length !== 1) invalid("Send the supporter plan on its own.");
    const plan = asRecord(input.supporterPlan);
    checkKeys(plan, ["personId", "mode"]);
    if (plan.personId !== "huiyan" && plan.personId !== "graham" && plan.personId !== "jeff" && plan.personId !== "ben") invalid("Choose a named supporter for this plan.");
    if (plan.mode !== "walking" && plan.mode !== "meeting") invalid("Choose walking with Emily or meeting at the next stop.");
    return { supporterPlan: { personId: plan.personId, mode: plan.mode } };
  }
  if (Object.hasOwn(input, "personId")) {
    if (input.personId !== "huiyan" && input.personId !== "graham" && input.personId !== "jeff" && input.personId !== "ben") invalid("Choose a named supporter for this location update.");
    if ((!Object.hasOwn(input, "position") && !Object.hasOwn(input, "sharing"))
      || Object.keys(input).some(key => key !== "personId" && key !== "position" && key !== "sharing")) {
      invalid("Send a person’s location or sharing change separately from the meeting plan.");
    }
    patch.personId = input.personId;
  }
  if (Object.hasOwn(input, "checkpoint")) {
    // The recovery capability can select or advance known stops, never supply arbitrary
    // meeting coordinates or combine this operation with other settings.
    if (Object.keys(input).length !== 1) invalid("Send the checkpoint action on its own.");
    const action = asRecord(input.checkpoint);
    checkKeys(action, ["action", "pointId"]);
    if (action.action !== "complete" && action.action !== "skip" && action.action !== "undo" && action.action !== "select" && action.action !== "add-ev" && action.action !== "remove-ev") invalid("Choose a supported checkpoint action.");
    const pointId = textValue(action.pointId, "Checkpoint ID", 80, false);
    if (!CHECKPOINT_IDS.has(pointId)) invalid("Choose a meeting point on the planned route.");
    if ((action.action === "add-ev" || action.action === "remove-ev") && !EV_POINT_IDS.has(pointId)) invalid("Choose a researched optional charging stop.");
    return { checkpoint: { action: action.action, pointId } };
  }
  if (Object.hasOwn(input, "sharing")) {
    if (typeof input.sharing !== "boolean") invalid("sharing must be true or false.");
    patch.sharing = input.sharing;
  }
  if (Object.hasOwn(input, "position")) patch.position = parsePosition(input.position, now);
  if (patch.position && patch.sharing === false) invalid("A stopped sharing session cannot include a position.");
  if (Object.hasOwn(input, "bib")) {
    patch.bib = textValue(input.bib, "Race number", 24);
    if (!/^[a-z0-9 ,/-]*$/i.test(patch.bib)) invalid("Use the race number shown in the tracker.");
  }
  if (Object.hasOwn(input, "meetup")) patch.meetup = parseMeetup(input.meetup);
  if (Object.hasOwn(input, "googleMapsUrl")) patch.googleMapsUrl = input.googleMapsUrl === null || input.googleMapsUrl === "" ? null : googleMapsUrl(input.googleMapsUrl, "Shared location link");
  if (Object.hasOwn(input, "celebration")) {
    if (typeof input.celebration !== "string" || !(CELEBRATION_IDS as readonly string[]).includes(input.celebration)) invalid("That celebration is not available.");
    // Client location patches cannot release a poster. Validated runner
    // crossings can release it in the server achievement ledger.
    patch.celebration = input.celebration as CelebrationId;
  }
  return patch;
}

async function readJson(request: Request, allowEmptyBody = false): Promise<unknown> {
  const isJson = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
  if (!allowEmptyBody && !isJson) throw new CrewError(415, "json_required", "Use application/json for this request.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new CrewError(413, "body_too_large", "The crew update is too large.");
  if (!request.body) {
    if (allowEmptyBody) return {};
    invalid("Include a JSON body.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new CrewError(413, "body_too_large", "The crew update is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  // Some hosts supply a non-null stream even for Content-Length: 0. Inspect
  // the actual bytes, rather than trusting that header to bypass validation.
  if (allowEmptyBody && total === 0) return {};
  if (!isJson) throw new CrewError(415, "json_required", "Use application/json for this request.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return invalid("The body is not valid JSON."); }
}

function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new CrewError(403, "origin_rejected", "Open this guide before changing the crew plan.");
}

async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function bearerHash(request: Request): Promise<string> {
  const match = /^Bearer ([a-z0-9_-]{32,256})$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new CrewError(401, "authorization_required", "Open your private crew link to use shared updates.");
  return hashToken(match[1]);
}

async function limitCreation(request: Request, now: number) {
  const rawIp = request.headers.get("cf-connecting-ip");
  const key = rawIp && rawIp.length <= 128 ? await hashToken("crew-create:" + rawIp) : "anonymous";
  for (const [entryKey, window] of createWindows) if (now - window.startedAt >= CREATE_WINDOW_MS) createWindows.delete(entryKey);
  if (createWindows.size >= 2048) createWindows.delete(createWindows.keys().next().value as string);
  const window = createWindows.get(key);
  const max = key === "anonymous" ? 12 : CREATE_LIMIT;
  if (window && window.count >= max) throw new CrewError(429, "too_many_rooms", "Please wait before creating another crew link.", { "Retry-After": String(Math.max(1, Math.ceil((window.startedAt + CREATE_WINDOW_MS - now) / 1000))) });
  createWindows.set(key, window ? { ...window, count: window.count + 1 } : { startedAt: now, count: 1 });
}

function metadataEnvelope(value: string | null): Record<string, unknown> {
  if (!value) return { meetup: null, celebrations: {} };
  const parsed = JSON.parse(value);
  // Versions before the map-first guide stored a plain Meetup here. Retain
  // those rooms, then promote to the envelope in the next metadata update.
  if (parsed && typeof parsed === "object" && Object.hasOwn(parsed, "id")) return { meetup: parsed, celebrations: {} };
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { meetup: null, celebrations: {} };
}

// Preserve old clients by retaining Huiyan's former shared stream in the
// existing columns. Graham, Jeff and Ben have independent phone streams; none
// borrows Huiyan's position or a former race-tracker position.
const METADATA_BASE_SQL = "CASE WHEN json_type(meetup_json, '$.id') IS NOT NULL THEN json_object('meetup', json(meetup_json), 'celebrations', json('{}')) ELSE COALESCE(meetup_json, '{\"meetup\":null,\"celebrations\":{}}') END";
function storedSupporterLocation(value: string | null, personId: Exclude<SupporterId, "huiyan">) {
  const metadata = metadataEnvelope(value);
  const supporters = metadata.supporters as Record<string, unknown> | undefined;
  const stored = supporters?.[personId] as { sharing?: unknown; position?: Partial<PositionInput> & { updatedAt?: number } } | undefined;
  const sharing = stored?.sharing === true || stored?.sharing === 1;
  const p = stored?.position;
  const valid = sharing && p && typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && typeof p.lng === "number" && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180
    && typeof p.accuracy === "number" && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= 100000
    && typeof p.recordedAt === "number" && Number.isFinite(p.recordedAt)
    && typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt);
  return {
    sharing,
    position: valid ? { lat: p.lat!, lng: p.lng!, accuracy: p.accuracy!, recordedAt: new Date(p.recordedAt!).toISOString(), updatedAt: new Date(p.updatedAt!).toISOString() } : null,
  };
}

function supporterPlans(value: unknown): Partial<Record<SupporterId, SupporterPlan>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const plans = value as Record<string, unknown>;
  const result: Partial<Record<SupporterId, SupporterPlan>> = {};
  for (const id of ["huiyan", "graham", "jeff", "ben"] as const) {
    const plan = plans[id] as Partial<SupporterPlan> | null;
    if (plan && (plan.mode === "walking" || plan.mode === "meeting") && typeof plan.updatedAt === "string" && Number.isFinite(Date.parse(plan.updatedAt))) {
      result[id] = { mode: plan.mode, updatedAt: plan.updatedAt };
    }
  }
  return result;
}

function completedPointIds(value: unknown): string[] {
  return [...new Set([...FIXED_PASSED_IDS, ...(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && CHECKPOINT_IDS.has(id)) : [])])];
}

function checkpointReceipt(value: unknown): CheckpointReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as CheckpointReceipt;
  return CHECKPOINT_IDS.has(receipt.pointId) && (receipt.action === "complete" || receipt.action === "skip") && typeof receipt.completedAt === "string" && Number.isFinite(Date.parse(receipt.completedAt))
    && Array.isArray(receipt.previousCompletedPointIds) ? receipt : null;
}

function checkpointStatuses(value: unknown): Record<string, CheckpointStatus> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, entry]) => CHECKPOINT_IDS.has(id) && !FIXED_PASSED_IDS.includes(id)
    && entry && typeof entry === "object" && (entry.status === "met" || entry.status === "skipped")
    && typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at))));
}

function canonicalEvIds(value: unknown): string[] {
  return [...new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && EV_POINT_IDS.has(id)) : [])];
}

function addedEvPointIds(metadata: Record<string, unknown>): string[] {
  const selectedId = (metadata.meetup as Meetup | null)?.id;
  // Older plans had no opt-in list. Retain only a charger the crew actually
  // selected or met at, not alternatives automatically stamped Skipped.
  const legacyMet = Array.isArray(metadata.addedEvPointIds) ? [] : Object.entries(checkpointStatuses(metadata.checkpointStatuses))
    .filter(([, value]) => value.status === "met").map(([id]) => id);
  return canonicalEvIds([...canonicalEvIds(metadata.addedEvPointIds), ...legacyMet, ...(selectedId ? [selectedId] : [])]);
}

function celebrationReleases(value: unknown): Celebration[] {
  const released = value as Partial<Record<CelebrationId, unknown>> | undefined;
  const releases: Celebration[] = CELEBRATION_IDS.flatMap(id => {
    const releasedAt = released?.[id];
    return typeof releasedAt === "number" && Number.isFinite(releasedAt) && releasedAt > 0
      ? [{ id, releasedAt: new Date(releasedAt).toISOString() }] : [];
  });
  releases.sort((a, b) => a.releasedAt.localeCompare(b.releasedAt) || a.id.localeCompare(b.id));
  return releases;
}

function roomMetadata(value: string | null) {
  const parsed = metadataEnvelope(value);
  const releases = celebrationReleases(parsed.celebrations);
  const receipt = checkpointReceipt(parsed.lastCheckpointAction);
  const meetup = (parsed.meetup || null) as Meetup | null;
  // A later explicit meet-up edit invalidates Undo; a GPS or celebration
  // update does not. Internal previous state never leaves the server.
  const lastCheckpointAction = receipt && JSON.stringify(meetup) === JSON.stringify(receipt.nextMeetup)
    ? { pointId: receipt.pointId, action: receipt.action, completedAt: receipt.completedAt } : null;
  return { meetup, releases, supporterPlans: supporterPlans(parsed.supporterPlans), completedPointIds: completedPointIds(parsed.completedPointIds), checkpointStatuses: checkpointStatuses(parsed.checkpointStatuses), addedEvPointIds: addedEvPointIds(parsed), lastCheckpointAction,
    achievements: { eventId: RACE_EVENT_ID, records: safeAchievements(parsed.raceAchievements), persisted: true } };
}

function safeRoom(row: RoomRow) {
  const metadata = roomMetadata(row.meetup_json);
  const position = Boolean(row.sharing) && row.lat !== null && row.lng !== null && row.accuracy !== null && row.position_updated_at !== null && row.position_recorded_at !== null ? {
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    updatedAt: new Date(row.position_updated_at).toISOString(),
    recordedAt: new Date(row.position_recorded_at).toISOString(),
  } : null;
  return {
    expiresAt: new Date(row.expires_at).toISOString(),
    position,
    supporters: { huiyan: { position, sharing: Boolean(row.sharing) }, graham: storedSupporterLocation(row.meetup_json, "graham"), jeff: storedSupporterLocation(row.meetup_json, "jeff"), ben: storedSupporterLocation(row.meetup_json, "ben") },
    supporterPlans: metadata.supporterPlans,
    bib: row.bib,
    meetup: metadata.meetup,
    completedPointIds: metadata.completedPointIds,
    checkpointStatuses: metadata.checkpointStatuses,
    addedEvPointIds: metadata.addedEvPointIds,
    lastCheckpointAction: metadata.lastCheckpointAction,
    releases: metadata.releases,
    achievements: metadata.achievements,
    googleMapsUrl: row.google_maps_url,
    sharing: Boolean(row.sharing),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function missingRoom(): never {
  throw new CrewError(404, "room_unavailable", "This crew link has expired or is no longer available.");
}

function configuredPublicRoom(config?: PublicCrewConfig): PublicCrewConfig {
  if (!config || !/^[a-f0-9]{64}$/.test(config.viewHash) || !/^[a-f0-9]{64}$/.test(config.publishHash)
    || config.viewHash === config.publishHash || !Number.isSafeInteger(config.expiresAt) || config.expiresAt <= 0) {
    throw new CrewError(503, "public_sharing_unavailable", "The shared race map is not ready yet. Please try again shortly.");
  }
  return config;
}

function hasLocationGrant(config?: PublicCrewConfig): config is PublicCrewConfig & { locationHash: string } {
  // An optional, malformed grant must not take down public reads or the
  // original publisher. A collision cannot narrow or widen an existing token.
  return Boolean(config && typeof config.locationHash === "string" && /^[a-f0-9]{64}$/.test(config.locationHash)
    && config.locationHash !== config.viewHash && config.locationHash !== config.publishHash);
}

function locationGrant(tokenHash: string, config?: PublicCrewConfig): PublicCrewConfig | undefined {
  return hasLocationGrant(config) && tokenHash === config.locationHash ? configuredPublicRoom(config) : undefined;
}

function locationOnly(): never {
  throw new CrewError(403, "location_only", "This link can share supporter locations, change walking plans and update planned meet-ups.");
}

function publicEnvelope(room: ReturnType<typeof safeRoom> | null, status: "waiting" | "active" | "ended", achievements: RaceAchievement[] = [], releases: Celebration[] = []) {
  return { public: true, status, room,
    ...(status === "ended" ? { releases } : {}),
    ...(achievements.length ? { achievements: { eventId: RACE_EVENT_ID, records: achievements, persisted: true } } : {}) };
}

async function scrubExpiredPublicRoom(db: D1Database, config: PublicCrewConfig, now: number) {
  // The public row cannot be deleted because its tombstone prevents a revoked
  // capability being reused. Retain only the requested non-location record of
  // earned accomplishments and revealed posters; clear GPS, links, meetups
  // and walking plans. Recorded celebrations remain available for replay.
  const rows = await db.batch<RoomRow>([db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? AND publish_hash = ? LIMIT 1").bind(config.viewHash, config.publishHash)]);
  const row = rows[0].results[0];
  const metadata = row ? metadataEnvelope(row.meetup_json) : {};
  const records = safeAchievements(metadata.raceAchievements);
  const releases = celebrationReleases(metadata.celebrations);
  const retained = records.length || releases.length ? JSON.stringify({
    ...(records.length ? { raceAchievements: records } : {}),
    ...(releases.length ? { celebrations: Object.fromEntries(releases.map(item => [item.id, Date.parse(item.releasedAt)])) } : {}),
  }) : null;
  const endedAt = Math.min(now, config.expiresAt);
  await db.prepare("UPDATE crew_rooms SET expires_at = MIN(expires_at, ?), updated_at = MAX(updated_at + 1, ?), sharing = 0, lat = NULL, lng = NULL, accuracy = NULL, position_updated_at = NULL, position_recorded_at = NULL, bib = '', meetup_json = ?, google_maps_url = NULL WHERE view_hash = ? AND publish_hash = ? AND (expires_at > ? OR sharing <> 0 OR lat IS NOT NULL OR lng IS NOT NULL OR accuracy IS NOT NULL OR position_updated_at IS NOT NULL OR position_recorded_at IS NOT NULL OR bib <> '' OR meetup_json IS NOT ? OR google_maps_url IS NOT NULL)")
    .bind(endedAt, now, retained, config.viewHash, config.publishHash, endedAt, retained).run();
  return { records, releases };
}

async function readPublicRoom(db: D1Database, now: number, suppliedConfig?: PublicCrewConfig) {
  const config = configuredPublicRoom(suppliedConfig);
  if (now >= config.expiresAt) {
    const history = await scrubExpiredPublicRoom(db, config, now);
    return reply(publicEnvelope(null, "ended", history.records, history.releases));
  }
  const results = await db.batch<RoomRow>([
    db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? LIMIT 1").bind(config.viewHash),
  ]);
  const row = results[0].results[0];
  if (!row) return reply(publicEnvelope(null, "waiting"));
  if (row.expires_at <= now) {
    const history = await scrubExpiredPublicRoom(db, config, now);
    return reply(publicEnvelope(null, "ended", history.records, history.releases));
  }
  if (row.publish_hash !== config.publishHash) return reply(publicEnvelope(null, "ended"));
  return reply(publicEnvelope(safeRoom(row), "active"));
}

async function activatePublicRoom(request: Request, db: D1Database, now: number, suppliedConfig?: PublicCrewConfig) {
  const config = configuredPublicRoom(suppliedConfig);
  const tokenHash = await bearerHash(request);
  if (tokenHash !== config.publishHash) throw new CrewError(403, "publisher_required", "Open the supporter control link to manage the shared race map.");
  if (now >= config.expiresAt) {
    await scrubExpiredPublicRoom(db, config, now);
    throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  }
  // This exact room is configured by the Site owner. Ordinary private room
  // creators cannot nominate, replace, or write to the public race feed.
  const results = await db.batch<RoomRow>([
    db.prepare("INSERT OR IGNORE INTO crew_rooms (view_hash, publish_hash, created_at, expires_at, updated_at, sharing, bib) VALUES (?, ?, ?, ?, ?, 0, '')").bind(config.viewHash, config.publishHash, now, config.expiresAt, now),
    db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? LIMIT 1").bind(config.viewHash),
  ]);
  const row = results[1].results[0];
  if (row && row.expires_at <= now) await scrubExpiredPublicRoom(db, config, now);
  if (!row || row.expires_at <= now || row.publish_hash !== config.publishHash) throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  return reply(publicEnvelope(safeRoom(row), "active"), results[0].meta.changes > 0 ? 201 : 200);
}

async function activateLocation(request: Request, db: D1Database, now: number, suppliedConfig?: PublicCrewConfig) {
  const config = configuredPublicRoom(suppliedConfig);
  if (!hasLocationGrant(config)) throw new CrewError(503, "location_sharing_unavailable", "Location sharing is not ready yet. Please try again shortly.");
  const tokenHash = await bearerHash(request);
  if (tokenHash !== config.locationHash) throw new CrewError(403, "location_access_required", "Open the supporter location link to share this phone's position.");
  if (now >= config.expiresAt) {
    await scrubExpiredPublicRoom(db, config, now);
    throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  }
  // Recovery can access only the already-active public room. It does not
  // create a room, replace its publisher, extend it, or revive a tombstone.
  const results = await db.batch<RoomRow>([
    db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? AND publish_hash = ? LIMIT 1").bind(config.viewHash, config.publishHash),
  ]);
  const row = results[0].results[0];
  if (!row) missingRoom();
  if (row.expires_at <= now) {
    await scrubExpiredPublicRoom(db, config, now);
    throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  }
  return reply({ ...publicEnvelope(safeRoom(row), "active"), capability: "location" });
}

async function createRoom(request: Request, db: D1Database, now: number, publicConfig?: PublicCrewConfig) {
  const payload = asRecord(await readJson(request));
  checkKeys(payload, ["action"]);
  if (payload.action === "activate-public") return activatePublicRoom(request, db, now, publicConfig);
  if (payload.action === "activate-location") return activateLocation(request, db, now, publicConfig);
  if (payload.action !== "create") invalid("Use action: create to create a crew link.");
  await limitCreation(request, now);
  const viewToken = newToken();
  const publishToken = newToken();
  const [viewHash, publishHash] = await Promise.all([hashToken(viewToken), hashToken(publishToken)]);
  const expiresAt = now + ROOM_TTL_MS;
  await db.batch([
    db.prepare("DELETE FROM crew_rooms WHERE expires_at <= ? AND view_hash <> ?").bind(now, publicConfig?.viewHash || ""),
    db.prepare("INSERT INTO crew_rooms (view_hash, publish_hash, created_at, expires_at, updated_at, sharing, bib) VALUES (?, ?, ?, ?, ?, 0, '')").bind(viewHash, publishHash, now, expiresAt, now),
  ]);
  return reply({ viewToken, publishToken, expiresAt: new Date(expiresAt).toISOString() }, 201);
}

async function readRoom(request: Request, db: D1Database, now: number, publicConfig?: PublicCrewConfig) {
  const tokenHash = await bearerHash(request);
  const results = await db.batch<RoomRow>([
    db.prepare("DELETE FROM crew_rooms WHERE (view_hash = ? OR publish_hash = ?) AND expires_at <= ? AND view_hash <> ?").bind(tokenHash, tokenHash, now, publicConfig?.viewHash || ""),
    db.prepare("SELECT * FROM crew_rooms WHERE (view_hash = ? OR publish_hash = ?) AND expires_at > ? LIMIT 1").bind(tokenHash, tokenHash, now),
  ]);
  const row = results[1].results[0];
  if (!row) missingRoom();
  return reply(safeRoom(row));
}

function plannedMeetup(point: PlannedPoint): Meetup {
  return {
    id: point.id,
    label: [point.label, point.town].filter(Boolean).join(" · "),
    routeKm: point.routeKm,
    lat: point.lat,
    lng: point.lng,
    mapUrl: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(point.lat + "," + point.lng),
    note: (point.landmark?.meetingNote || point.detail || "").slice(0, 600),
  };
}

async function updateCheckpoint(db: D1Database, publishHash: string, locationConfig: PublicCrewConfig | undefined, action: CheckpointAction, now: number) {
  const groupIndex = CHECKPOINT_GROUPS.findIndex(group => group.points.some(point => point.id === action.pointId));
  const group = CHECKPOINT_GROUPS[groupIndex];
  const target = group.points.find(point => point.id === action.pointId)!;
  const roomQuery = () => locationConfig
    ? db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? AND publish_hash = ? LIMIT 1").bind(locationConfig.viewHash, publishHash)
    : db.prepare("SELECT * FROM crew_rooms WHERE publish_hash = ? LIMIT 1").bind(publishHash);
  // The compare-and-swap covers metadata only. GPS continues independently,
  // and a concurrent celebration or plan edit is re-read before retrying.
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await db.batch<RoomRow>([roomQuery()]);
    const row = read[0].results[0];
    if (!row) missingRoom();
    if (row.expires_at <= now) {
      if (locationConfig) {
        await scrubExpiredPublicRoom(db, locationConfig, now);
        throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
      }
      missingRoom();
    }
    const metadata = metadataEnvelope(row.meetup_json);
    const completed = completedPointIds(metadata.completedPointIds);
    const statuses = checkpointStatuses(metadata.checkpointStatuses);
    const currentMeetup = (metadata.meetup || null) as Meetup | null;
    const receipt = checkpointReceipt(metadata.lastCheckpointAction);
    const addedEv = addedEvPointIds(metadata);
    const savedAddedEv = Array.isArray(metadata.addedEvPointIds) ? canonicalEvIds(metadata.addedEvPointIds) : null;
    if (action.action === "add-ev" || action.action === "remove-ev") {
      if (action.action === "remove-ev" && currentMeetup?.id === action.pointId) {
        throw new CrewError(409, "ev_current_meetup", "This is the agreed next meet-up. Choose another meeting point before removing this charging option.");
      }
      const nextAddedEv = action.action === "add-ev" ? canonicalEvIds([...addedEv, action.pointId]) : addedEv.filter(id => id !== action.pointId);
      if (JSON.stringify(savedAddedEv) === JSON.stringify(nextAddedEv)) return reply(safeRoom(row));
      // Adding a possible stop never changes the current destination or Undo.
      metadata.addedEvPointIds = nextAddedEv;
    } else if (action.action === "select") {
      // A supporter setup token may choose a researched, canonical pin but
      // still cannot submit arbitrary coordinates or alter unrelated settings.
      const latestCompletedGroup = CHECKPOINT_GROUPS.findLastIndex(entry => entry.points.some(point => completed.includes(point.id)));
      if (group.points.some(point => completed.includes(point.id)) || groupIndex < latestCompletedGroup) {
        throw new CrewError(409, "checkpoint_outdated", "This stop is already behind the shared meeting plan. Choose an upcoming option.");
      }
      const nextMeetup = plannedMeetup(target);
      const nextAddedEv = target.optionalMeetup ? canonicalEvIds([...addedEv, target.id]) : addedEv;
      const sameMeetup = JSON.stringify(currentMeetup) === JSON.stringify(nextMeetup);
      if (sameMeetup && JSON.stringify(savedAddedEv) === JSON.stringify(nextAddedEv)) return reply(safeRoom(row));
      metadata.addedEvPointIds = nextAddedEv;
      if (!sameMeetup) {
        metadata.meetup = nextMeetup;
        metadata.lastCheckpointAction = null;
        metadata.lastCheckpointUndo = null;
      }
    } else if (action.action === "undo") {
      const previousUndo = metadata.lastCheckpointUndo as { pointId?: string } | undefined;
      if (!receipt && previousUndo?.pointId === action.pointId) return reply(safeRoom(row));
      if (!receipt || receipt.pointId !== action.pointId || JSON.stringify(currentMeetup) !== JSON.stringify(receipt.nextMeetup)) {
        throw new CrewError(409, "checkpoint_conflict", "The meeting plan changed. Refresh it before undoing a stop.");
      }
      metadata.completedPointIds = completedPointIds(receipt.previousCompletedPointIds);
      metadata.checkpointStatuses = checkpointStatuses(receipt.previousCheckpointStatuses);
      metadata.addedEvPointIds = addedEv;
      metadata.meetup = receipt.previousMeetup;
      metadata.lastCheckpointAction = null;
      metadata.lastCheckpointUndo = { pointId: action.pointId, at: new Date(now).toISOString() };
    } else {
      // Repeated taps, retries and either of the two nearby alternatives must
      // not advance the plan twice, even after a later checkpoint is complete.
      if (group.points.some(point => completed.includes(point.id))) return reply(safeRoom(row));
      const currentGroupIndex = CHECKPOINT_GROUPS.findIndex(entry => entry.points.some(point => point.id === currentMeetup?.id));
      const latestCompletedGroup = CHECKPOINT_GROUPS.findLastIndex(entry => entry.points.some(point => completed.includes(point.id)));
      if (groupIndex < latestCompletedGroup || currentGroupIndex > groupIndex
        || currentGroupIndex < 0 && currentMeetup?.routeKm != null && currentMeetup.routeKm > target.routeKm + .15) {
        throw new CrewError(409, "checkpoint_outdated", "The crew has already moved to a later stop. Refresh the meeting plan.");
      }
      const at = new Date(now).toISOString();
      const nextCompleted = completedPointIds([...completed, ...group.points.map(point => point.id)]);
      const nextPoint = CHECKPOINT_GROUPS.slice(groupIndex + 1)
        .filter(entry => !entry.points.some(point => nextCompleted.includes(point.id)))
        .flatMap(entry => entry.points)
        .find(point => !point.optionalMeetup && point.routeKm >= target.routeKm - .15);
      const nextMeetup = nextPoint ? plannedMeetup(nextPoint) : null;
      metadata.addedEvPointIds = target.optionalMeetup && action.action === "complete" ? canonicalEvIds([...addedEv, target.id]) : addedEv;
      metadata.completedPointIds = nextCompleted;
      metadata.checkpointStatuses = { ...statuses, ...Object.fromEntries(group.points.map(point => [point.id, {
        status: action.action === "complete" && point.id === action.pointId ? "met" : "skipped", at,
      }])) };
      metadata.meetup = nextMeetup;
      metadata.lastCheckpointAction = {
        pointId: action.pointId, action: action.action, completedAt: at,
        previousCompletedPointIds: completed, previousCheckpointStatuses: statuses,
        previousMeetup: currentMeetup || plannedMeetup(target), nextMeetup,
      } satisfies CheckpointReceipt;
      metadata.lastCheckpointUndo = null;
    }
    const conditions = ["publish_hash = ?", "expires_at > ?", "meetup_json IS ?"];
    const values: (string | number | null)[] = [JSON.stringify(metadata), now, publishHash, now, row.meetup_json];
    if (locationConfig) { conditions.push("view_hash = ?"); values.push(locationConfig.viewHash); }
    const written = await db.batch<RoomRow>([
      db.prepare("UPDATE crew_rooms SET meetup_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE " + conditions.join(" AND ")).bind(...values),
      roomQuery(),
    ]);
    const updated = written[1].results[0];
    if (!updated) missingRoom();
    if (written[0].meta.changes > 0) return reply(safeRoom(updated));
  }
  throw new CrewError(409, "checkpoint_conflict", "The meeting plan changed at the same time. Refresh it and try again.");
}

async function updateRoom(request: Request, db: D1Database, now: number, publicConfig?: PublicCrewConfig) {
  const tokenHash = await bearerHash(request);
  const locationConfig = locationGrant(tokenHash, publicConfig);
  const payload = await readJson(request);
  if (locationConfig && Object.keys(asRecord(payload)).some(key => key !== "personId" && key !== "position" && key !== "sharing" && key !== "checkpoint" && key !== "supporterPlan")) locationOnly();
  const patch = parsePatch(payload, now);
  if (locationConfig && now >= locationConfig.expiresAt) {
    await scrubExpiredPublicRoom(db, locationConfig, now);
    throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  }
  const publishHash = locationConfig?.publishHash || tokenHash;
  if (patch.checkpoint) return updateCheckpoint(db, publishHash, locationConfig, patch.checkpoint, now);
  const storedPersonId = patch.personId === "graham" || patch.personId === "jeff" || patch.personId === "ben" ? patch.personId : null;
  // The ID is narrowed to fixed values before it becomes a JSON path.
  const locationPath = "$.supporters." + storedPersonId;
  const values = new Map<string, string | number | null>([["updated_at", now]]);
  if (!storedPersonId && patch.sharing !== undefined) values.set("sharing", patch.sharing ? 1 : 0);
  if (patch.bib !== undefined) values.set("bib", patch.bib);
  if (patch.googleMapsUrl !== undefined) values.set("google_maps_url", patch.googleMapsUrl);
  if (!storedPersonId && (patch.sharing === false || patch.position === null)) {
    ["lat", "lng", "accuracy", "position_updated_at", "position_recorded_at"].forEach(column => values.set(column, null));
  } else if (!storedPersonId && patch.position) {
    values.set("lat", patch.position.lat);
    values.set("lng", patch.position.lng);
    values.set("accuracy", patch.position.accuracy);
    values.set("position_updated_at", now);
    values.set("position_recorded_at", patch.position.recordedAt);
  }
  // Room updatedAt also orders committed snapshots. A delayed request or two
  // requests in the same millisecond must not share a version, otherwise an
  // earlier GET can replace an acknowledged position or Stop on another phone.
  // GPS observed/received timestamps keep their real values above.
  const assignments = [...values.keys()].map(column => column === "updated_at" ? "updated_at = MAX(updated_at + 1, ?)" : column + " = ?");
  const bindings: (string | number | null)[] = [...values.values()];
  if (storedPersonId || patch.meetup !== undefined || patch.celebration !== undefined || patch.supporterPlan) {
    // Merge JSON inside the UPDATE, not from a preceding SELECT. A concurrent
    // GPS, meet-up, or celebration update cannot erase another field.
    const base = METADATA_BASE_SQL;
    let metadataSql = base;
    if (storedPersonId) {
      if (patch.sharing !== undefined) {
        metadataSql = "json_set(" + metadataSql + ", '" + locationPath + ".sharing', ?)";
        bindings.push(patch.sharing ? 1 : 0);
      }
      if (patch.sharing === false || patch.position === null) {
        metadataSql = "json_set(" + metadataSql + ", '" + locationPath + ".position', NULL)";
      } else if (patch.position) {
        metadataSql = "json_set(" + metadataSql + ", '" + locationPath + ".position', json(?))";
        bindings.push(JSON.stringify({ ...patch.position, updatedAt: now }));
      }
    }
    if (patch.meetup !== undefined) {
      metadataSql = "json_set(" + metadataSql + ", '$.meetup', json(?))";
      bindings.push(JSON.stringify(patch.meetup));
    }
    if (patch.supporterPlan) {
      metadataSql = "json_set(" + metadataSql + ", ?, json(?))";
      bindings.push("$.supporterPlans." + patch.supporterPlan.personId, JSON.stringify({ mode: patch.supporterPlan.mode, updatedAt: new Date(now).toISOString() }));
    }
    if (patch.celebration !== undefined) {
      const path = '$.celebrations."' + patch.celebration + '"';
      // Idempotent release: retries keep the original time and never replay
      // a celebration already acknowledged on a family member's phone.
      metadataSql = "json_set(" + metadataSql + ", ?, COALESCE(json_extract(" + base + ", ?), ?))";
      bindings.push(path, path, now);
    }
    assignments.push("meetup_json = " + metadataSql);
  }
  const conditions = ["publish_hash = ?", "expires_at > ?"];
  bindings.push(publishHash, now);
  if (locationConfig) {
    conditions.push("view_hash = ?");
    bindings.push(locationConfig.viewHash);
  }
  if (patch.position) {
    const sharingColumn = storedPersonId ? "COALESCE(json_extract(meetup_json, '" + locationPath + ".sharing'), 0)" : "sharing";
    const recordedColumn = storedPersonId ? "json_extract(meetup_json, '" + locationPath + ".position.recordedAt')" : "position_recorded_at";
    if (patch.sharing !== true) conditions.push(sharingColumn + " = 1");
    conditions.push("(" + recordedColumn + " IS NULL OR " + recordedColumn + " <= ?)");
    bindings.push(patch.position.recordedAt);
  }
  const results = await db.batch<RoomRow>([
    db.prepare("DELETE FROM crew_rooms WHERE publish_hash = ? AND expires_at <= ? AND view_hash <> ?").bind(publishHash, now, publicConfig?.viewHash || ""),
    db.prepare("UPDATE crew_rooms SET " + assignments.join(", ") + " WHERE " + conditions.join(" AND ")).bind(...bindings),
    locationConfig
      ? db.prepare("SELECT * FROM crew_rooms WHERE view_hash = ? AND publish_hash = ? LIMIT 1").bind(locationConfig.viewHash, publishHash)
      : db.prepare("SELECT * FROM crew_rooms WHERE publish_hash = ? AND expires_at > ? LIMIT 1").bind(publishHash, now),
  ]);
  const row = results[2].results[0];
  if (!row) missingRoom();
  if (locationConfig && row.expires_at <= now) {
    await scrubExpiredPublicRoom(db, locationConfig, now);
    throw new CrewError(410, "public_session_ended", "This race sharing session has ended.");
  }
  if (results[1].meta.changes === 0) {
    const sharing = storedPersonId ? storedSupporterLocation(row.meetup_json, storedPersonId).sharing : Boolean(row.sharing);
    if (!sharing && patch.sharing !== true) throw new CrewError(409, "sharing_stopped", "Location sharing is stopped for this person. Start it again before publishing a position.");
    throw new CrewError(409, "position_outdated", "A newer position is already shared. Request a fresh GPS position.");
  }
  return reply(safeRoom(row));
}

async function deleteRoom(request: Request, db: D1Database, now: number, publicConfig?: PublicCrewConfig) {
  const tokenHash = await bearerHash(request);
  if (locationGrant(tokenHash, publicConfig)) locationOnly();
  checkKeys(asRecord(await readJson(request, true)), []);
  if (publicConfig && tokenHash === publicConfig.publishHash) {
    // Retain only the credential hashes and timestamps as a revocation marker.
    // INSERT OR IGNORE cannot revive it, even after an ordinary room cleanup.
    const result = await db.prepare("UPDATE crew_rooms SET expires_at = ?, updated_at = MAX(updated_at + 1, ?), sharing = 0, lat = NULL, lng = NULL, accuracy = NULL, position_updated_at = NULL, position_recorded_at = NULL, bib = '', meetup_json = NULL, google_maps_url = NULL WHERE view_hash = ? AND publish_hash = ?").bind(now, now, publicConfig.viewHash, tokenHash).run();
    if (result.meta.changes === 0) missingRoom();
    return reply({ revoked: true });
  }
  const result = await db.prepare("DELETE FROM crew_rooms WHERE publish_hash = ?").bind(tokenHash).run();
  if (result.meta.changes === 0) missingRoom();
  return reply({ revoked: true });
}

export async function handleCrewRequest(request: Request, db: D1Database | undefined, now = Date.now(), publicConfig?: PublicCrewConfig): Promise<Response> {
  try {
    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) throw new CrewError(405, "method_not_allowed", "This method is not available.", { Allow: "GET, POST, PATCH, DELETE" });
    if (request.method !== "GET") assertSameOrigin(request);
    if (!db) throw new CrewError(503, "sharing_unavailable", "Crew sharing is temporarily unavailable. Please try again.");
    if (request.method === "POST") return await createRoom(request, db, now, publicConfig);
    if (request.method === "GET") return new URL(request.url).searchParams.get("public") === "1"
      ? await readPublicRoom(db, now, publicConfig) : await readRoom(request, db, now, publicConfig);
    if (request.method === "PATCH") return await updateRoom(request, db, now, publicConfig);
    return await deleteRoom(request, db, now, publicConfig);
  } catch (error) {
    if (error instanceof CrewError) return reply({ error: error.message, code: error.code }, error.status, error.extraHeaders);
    return reply({ error: "Crew sharing could not complete that request. Please try again.", code: "sharing_unavailable" }, 503);
  }
}
