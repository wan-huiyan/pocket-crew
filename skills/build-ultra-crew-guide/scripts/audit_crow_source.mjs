#!/usr/bin/env node
// Read-only source inventory for adapting the Crow Crew Site to a NEW race.
// Does not publish, edit, run a tracker request, read D1, or print credentials.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source = resolve(process.argv[2] || '.');
const required = [
  'guide/index.html', 'guide/poster-home.html', 'guide/poster-template.mjs',
  'scripts/prepare-guide.mjs', 'package.json', '.openai/hosting.json',
  'app/api/crew/route.ts', 'app/api/tracker/route.ts',
  'app/api/toilet-arrivals/route.ts', 'db/schema.ts',
  'lib/crew-room.ts', 'lib/public-crew-config.ts', 'lib/race-milestones.ts',
  'public/app.js', 'public/live.js', 'public/map-first.js', 'public/map-first.css',
  'public/support.js', 'public/upcoming-points.js', 'public/crew-travel.js',
  'public/arrival-eta.js', 'public/meeting-forecast.js',
  'public/race-moments.js', 'public/race-milestones.js',
  'public/celebrations.js', 'public/poster-view.js',
  'public/intro-host.js', 'public/sw.js', 'public/toilet-hours.js',
  'public/data/route.geojson', 'public/data/support-points.json',
  'public/data/guide-data.json', 'public/data/milestone-route.json',
  'public/data/facilities.json', 'public/data/poster-manifest.json',
];
const missing = required.filter(file => !existsSync(join(source, file)));
const legacyPatterns = {
  oldEventId: /\b35950\b/g,
  oldEventDate: /2026-11-13/g,
  meridenName: /meriden/gi,
  originalPublicSite: /emily-jeff-meriden-crew\.whylaura413\.chatgpt\.site/gi,
  hostedProjectId: /appgprj_[A-Za-z0-9]+/g,
  legacyLocalKey: /(crow-race-moments|meriden-crew-2026|meriden-public-location|emily-jeff-intro)/g,
};
const eventFiles = [
  'guide/index.html', 'guide/poster-home.html', 'public/app.js', 'public/live.js',
  'public/crew.js', 'public/map-first.js', 'public/support.js', 'public/sw.js',
  'public/race-moments.js', 'public/race-milestones.js', 'public/celebrations.js',
  'public/data/guide-data.json', 'public/data/support-points.json',
  'lib/race-milestones.ts', 'app/api/tracker/route.ts',
  'scripts/extend-route-123km.mjs', '.openai/hosting.json',
];
const legacyMarkers = {};
for (const file of eventFiles) {
  const path = join(source, file);
  if (!existsSync(path) || !statSync(path).isFile()) continue;
  const body = readFileSync(path, 'utf8');
  const counts = {};
  for (const [name, pattern] of Object.entries(legacyPatterns)) {
    const count = [...body.matchAll(pattern)].length;
    if (count) counts[name] = count;
  }
  if (Object.keys(counts).length) legacyMarkers[file] = counts;
}

const jsonFile = file => {
  const path = join(source, file);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { _invalidJson: true }; }
};
const manifest = jsonFile('public/data/poster-manifest.json');
const posterProblems = [];
const assetReferences = new Map();
if (manifest?._invalidJson) posterProblems.push('Manifest is invalid JSON');
else if (manifest && !Array.isArray(manifest)) {
  for (const [id, paths] of Object.entries(manifest)) {
    if (!paths || typeof paths !== 'object') { posterProblems.push(`${id}: invalid entry`); continue; }
    for (const key of ['preview', 'download']) {
      const path = paths[key];
      if (typeof path !== 'string' || path.includes('..') || path.startsWith('/')) {
        posterProblems.push(`${id}: invalid ${key} path`); continue;
      }
      const full = join(source, 'public', path);
      if (!existsSync(full)) posterProblems.push(`${id}: missing ${key} asset`);
      const usedBy = assetReferences.get(path) || [];
      usedBy.push(`${id}.${key}`); assetReferences.set(path, usedBy);
    }
  }
} else posterProblems.push('Poster manifest missing');
for (const [path, users] of assetReferences) if (users.length > 1) {
  posterProblems.push(`Repeated poster path (${users.join(', ')}) — inspect ${path}`);
}

const route = jsonFile('public/data/route.geojson');
const routeInfo = !route ? { missing: true } : route._invalidJson ? { invalidJson: true } : {
  type: route.type,
  vertexCount: Array.isArray(route.coordinates) ? route.coordinates.length : null,
  validLine: route.type === 'LineString' && Array.isArray(route.coordinates)
    && route.coordinates.length >= 2 && route.coordinates.every(p => Array.isArray(p) && p.length >= 2
      && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180
      && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90),
};
const points = jsonFile('public/data/support-points.json');
const supportInfo = !points ? { missing: true } : points._invalidJson ? { invalidJson: true } : {
  groups: Array.isArray(points.groups) ? points.groups.length : null,
  options: Array.isArray(points.groups) ? points.groups.reduce((n, group) => n + (group.options?.length || 0), 0) : null,
  planningEndKm: points.planningEndKm ?? null,
  missingTownOrLandmark: Array.isArray(points.groups) ? points.groups.flatMap(group => (group.options || [])
    .filter(p => !p.beyondPlannedFinish && !p.optionalMeetup && (!p.town || !p.landmark?.meetingNote || !p.landmark?.mapLabel))
    .map(p => p.id)).slice(0, 30) : [],
};
const testDir = join(source, 'tests');
const tests = existsSync(testDir) ? readdirSync(testDir).filter(name => name.endsWith('.test.mjs')).sort() : [];
const pack = jsonFile('package.json');
const scriptOk = Boolean(pack?.scripts?.build && pack?.scripts?.prebuild);

const report = {
  source,
  readOnly: true,
  status: missing.length || posterProblems.length || routeInfo.validLine === false || !scriptOk ? 'review-required' : 'structure-present',
  missingRequiredFiles: missing,
  buildScriptsPresent: scriptOk,
  testFileCount: tests.length,
  testFiles: tests,
  route: routeInfo,
  supportPoints: supportInfo,
  posterIds: manifest && !manifest._invalidJson ? Object.keys(manifest).sort() : [],
  posterProblems,
  legacyEventMarkerCounts: legacyMarkers,
  reminder: 'Marker counts identify migration review sites; never reuse previous event rooms/capabilities or automatically rewrite marker matches. Run tests and phone QA separately.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (missing.length || posterProblems.length || routeInfo.validLine === false || !scriptOk) process.exitCode = 1;
