import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const moduleUrl = new URL('../app/api/tracker/route.ts', import.meta.url);
let scenarioId = 0;
const metadata = { event: { id: 35950, slug: 'escapefrommeriden', start: '2026-11-13T23:59:00+00:00[Europe/London]', active: true } };
const reportTime = () => new Date(Date.now() - 60_000).toISOString();
const person = (bib, name, lat = 52.2, lon = -1.1) => ({
  id: bib === '247' ? 208495 : 208504,
  bib, name, tracker: 'not-public',
  lastReport: { lat, lon, timestamp: reportTime(), distance: 999 },
  routes: [{ dist: 33.4 }], finished: false, retired: false,
});

const pathPoint = (timestamp, lat = 52.2, lon = -1.1) => ({
  lat, lon, gnssTime: new Date(timestamp).toISOString(),
  timeLocal: new Date(timestamp).toISOString() + '[Europe/London]',
  sendTime: new Date(new Date(timestamp).getTime() + 20_000).toISOString(),
});

async function scenario(event = metadata, participants = [], paths = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.headers.Accept, 'application/json');
    const pathMatch = String(url).match(/\/participants\/(\d+)\/path$/);
    if (pathMatch) {
      const path = paths[pathMatch[1]] ?? [];
      if (path instanceof Error) throw path;
      return Response.json(path);
    }
    return Response.json(String(url).endsWith('/participants') ? participants : event);
  };
  const { GET } = await import(moduleUrl.href + '?case=' + scenarioId++);
  return {
    calls,
    async read(bib) {
      const response = await GET(new Request('https://example.test/api/tracker?bib=' + encodeURIComponent(bib)));
      return { http: response.status, ...(await response.json()) };
    },
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('Emily 247 and Jeff 133 match independently and share one provider fetch when requested together', async () => {
  const f = await scenario(metadata, [person('247', 'Emily Simmons', 52.2), person('133', 'Jeff Simmons', 52.21), person('1247', 'Someone else')]);
  try {
    const [emily, jeff] = await Promise.all([f.read('247'), f.read('133')]);
    assert.equal(emily.status, 'live');
    assert.equal(jeff.status, 'live');
    assert.deepEqual(emily.participants.map(p => [p.bib, p.name, p.lat]), [['247', 'Emily Simmons', 52.2]]);
    assert.deepEqual(jeff.participants.map(p => [p.bib, p.name, p.lat]), [['133', 'Jeff Simmons', 52.21]]);
    assert.deepEqual(f.calls.slice(0, 2), ['https://track.trail.live/event/35950', 'https://track.trail.live/event/35950/participants']);
    assert.deepEqual(f.calls.slice(2).sort(), [
      'https://track.trail.live/event/35950/participants/208495/path',
      'https://track.trail.live/event/35950/participants/208504/path',
    ]);
    assert.equal(emily.participants[0].crowKm, 33.4);
    assert(!JSON.stringify(emily).includes('not-public'));
    assert(!JSON.stringify(emily).includes('999'));
    assert.equal((await f.read('24')).status, 'not-found');
  } finally { f.restore(); }
});

test('pre-start confirms each bib but exposes no old or placeholder position', async () => {
  const f = await scenario({ event: { ...metadata.event, active: false } }, [person('247', 'Emily Simmons'), { ...person('133', 'Jeff Simmons'), lastReport: null }]);
  try {
    for (const bib of ['247', '133']) {
      const result = await f.read(bib);
      assert.equal(result.status, 'waiting');
      assert.equal(result.event.active, false);
      assert.equal(result.participants.length, 1);
      assert.equal(result.participants[0].bib, bib);
      assert.equal(result.participants[0].lat, null);
      assert.equal(result.participants[0].lng, null);
      assert.equal(result.participants[0].updatedAt, null);
      assert.equal(result.participants[0].crowKm, null);
      assert.deepEqual(result.participants[0].recentReports, []);
    }
    assert(!f.calls.some(url => url.endsWith('/path')));
  } finally { f.restore(); }
});

test('one missing report does not borrow the other runner’s position', async () => {
  const f = await scenario(metadata, [{ ...person('247', 'Emily Simmons'), lastReport: null }, person('133', 'Jeff Simmons')]);
  try {
    const [emily, jeff] = await Promise.all([f.read('247'), f.read('133')]);
    assert.equal(emily.status, 'waiting');
    assert.equal(emily.participants[0].lat, null);
    assert.equal(jeff.status, 'live');
    assert.equal(jeff.participants[0].lat, 52.2);
  } finally { f.restore(); }
});

test('wrong event ID, slug or year is rejected before any participants are read', async () => {
  for (const change of [{ id: 35951 }, { slug: 'different-race' }, { start: '2027-11-13T23:59:00Z' }]) {
    const f = await scenario({ event: { ...metadata.event, ...change } }, [person('247', 'Emily Simmons')]);
    try {
      assert.equal((await f.read('247')).status, 'wrong-event');
      assert.equal(f.calls.length, 1);
    } finally { f.restore(); }
  }
});

test('ambiguous bibs and invalid coordinates remain unusable', async () => {
  let f = await scenario(metadata, [person('247', 'Emily Simmons'), person('247', 'Another entry')]);
  try { assert.equal((await f.read('247')).status, 'ambiguous'); } finally { f.restore(); }
  f = await scenario(metadata, [person('247', 'Emily Simmons', null)]);
  try { assert.equal((await f.read('247')).status, 'waiting'); } finally { f.restore(); }
});

test('invalid inputs make no provider call and provider failures reveal no internal details', async () => {
  const f = await scenario();
  try {
    assert.equal((await f.read('')).status, 'need-number');
    assert.equal((await f.read('1'.repeat(25))).http, 400);
    assert.equal(f.calls.length, 0);
    globalThis.fetch = async () => { throw new Error('sensitive internal detail'); };
    const result = await f.read('247');
    assert.equal(result.status, 'unavailable');
    assert(!JSON.stringify(result).includes('sensitive internal detail'));
  } finally { f.restore(); }
});

test('recent pace history uses only each matched bib’s official event path, with cache and in-flight deduplication', async () => {
  const emily = person('247', 'Emily Simmons', 52.2);
  const jeff = person('133', 'Jeff Simmons', 52.21);
  const f = await scenario(metadata, [emily, jeff], {
    208495: [pathPoint(emily.lastReport.timestamp, 52.2)],
    208504: [pathPoint(jeff.lastReport.timestamp, 52.21)],
  });
  try {
    const [a, b, c] = await Promise.all([f.read('247'), f.read('247'), f.read('133')]);
    assert.deepEqual(a.participants[0].recentReports, [{ lat: 52.2, lng: -1.1, recordedAt: emily.lastReport.timestamp }]);
    assert.deepEqual(b.participants[0].recentReports, a.participants[0].recentReports);
    assert.equal(c.participants[0].recentReports[0].lat, 52.21);
    await f.read('247');
    assert.equal(f.calls.filter(url => url.endsWith('/208495/path')).length, 1);
    assert.equal(f.calls.filter(url => url.endsWith('/208504/path')).length, 1);
    assert.equal(f.calls.filter(url => url.endsWith('/participants')).length, 1);
    assert(!JSON.stringify(a).includes('sendTime'));
    assert.equal(a.participants[0].speedKmh, undefined);
  } finally { f.restore(); }
});

test('recent reports are sorted, deduplicated and restricted to valid GPS times in this race and the latest 20 minutes', async () => {
  const emily = person('247', 'Emily Simmons');
  const at = Date.parse(emily.lastReport.timestamp);
  const old = pathPoint(at - 25 * 60_000);
  const first = pathPoint(at - 15 * 60_000, 52.19);
  const second = pathPoint(at - 3 * 60_000, 52.199);
  const current = pathPoint(at);
  const f = await scenario(metadata, [emily], { 208495: [
    current, second, first, second, old,
    pathPoint(Date.parse('2026-11-13T23:58:00Z')),
    pathPoint(at + 30_000),
    pathPoint(Date.now() + 60_000),
    { ...first, timeLocal: 'invalid' },
    { ...first, gnssTime: new Date(at).toISOString() },
    { lat: 52.2, lon: -1.1, sendTime: new Date(at).toISOString() },
    { ...first, lat: '52.2' },
    { ...first, lon: 181 },
    { ...first, lat: null },
  ] });
  try {
    const result = await f.read('247');
    assert.equal(result.status, 'live');
    assert.deepEqual(result.participants[0].recentReports, [first, second, current].map(p => ({
      lat: p.lat, lng: p.lon, recordedAt: p.gnssTime,
    })));
  } finally { f.restore(); }
});

test('at most 20 valid recent GPS samples are exposed', async () => {
  const emily = person('247', 'Emily Simmons');
  const at = Date.parse(emily.lastReport.timestamp);
  const path = Array.from({ length: 30 }, (_, index) => pathPoint(at - (29 - index) * 20_000));
  const f = await scenario(metadata, [emily], { 208495: path });
  try {
    const result = await f.read('247');
    assert.equal(result.participants[0].recentReports.length, 20);
    assert.equal(result.participants[0].recentReports[0].recordedAt, path[10].gnssTime);
    assert.equal(result.participants[0].recentReports.at(-1).recordedAt, path.at(-1).gnssTime);
  } finally { f.restore(); }
});

test('two-hour trend history uses the same validated path while the 20-minute history stays unchanged', async () => {
  const emily = person('247', 'Emily Simmons');
  const at = Date.parse(emily.lastReport.timestamp);
  const earlier = pathPoint(at - 115 * 60_000, 52.05);
  const middle = pathPoint(at - 60 * 60_000, 52.12);
  const recent = pathPoint(at - 15 * 60_000, 52.19);
  const current = pathPoint(at, 52.2);
  const tooOld = pathPoint(at - 121 * 60_000);
  const invalid = { ...pathPoint(at - 45 * 60_000), gnssTime: new Date(at).toISOString() };
  const future = pathPoint(at + 30_000);
  const f = await scenario(metadata, [emily], { 208495: [current, earlier, tooOld, recent, middle, middle, invalid, future] });
  try {
    const first = await f.read('247');
    const second = await f.read('247');
    const mapped = points => points.map(p => ({lat:p.lat,lng:p.lon,recordedAt:p.gnssTime}));
    assert.deepEqual(first.participants[0].recentReports, mapped([recent, current]));
    assert.deepEqual(first.participants[0].paceReports, mapped([earlier, middle, recent, current]));
    assert.deepEqual(second.participants[0].paceReports, first.participants[0].paceReports);
    assert.equal(f.calls.filter(url => url.endsWith('/208495/path')).length, 1, 'both windows share one cached provider request');
  } finally { f.restore(); }
});

test('trend history is capped at 120 samples and excludes invalid or pre-race timestamps', async () => {
  const emily = person('247', 'Emily Simmons');
  const at = Date.parse(emily.lastReport.timestamp);
  const path = Array.from({length:150}, (_, index) => pathPoint(at - (149-index) * 30_000));
  path.unshift(
    pathPoint(Date.parse('2026-11-13T23:58:00Z')),
    {...pathPoint(at - 90000), timeLocal:'invalid'},
    {...pathPoint(at - 90000), gnssTime:new Date(at).toISOString()},
    {...pathPoint(at - 90000), lat:null},
    {lat:52,lng:-1,sendTime:new Date(at).toISOString()},
  );
  const f = await scenario(metadata, [emily], { 208495:path });
  try {
    const result = await f.read('247');
    const reports = result.participants[0].paceReports;
    assert.equal(reports.length, 120);
    assert.equal(reports[0].recordedAt, path.at(-120).gnssTime);
    assert.equal(reports.at(-1).recordedAt, path.at(-1).gnssTime);
    assert.equal(result.participants[0].recentReports.length, 20);
    assert(reports.every(report => Date.parse(report.recordedAt) >= Date.parse(metadata.event.start.replace(/\[.*\]/, ''))));
  } finally { f.restore(); }
});

test('a failed, malformed or oversized history response cannot remove a valid live runner location', async () => {
  for (const path of [new Error('private provider failure'), { reports: [] }, 'x'.repeat(1_000_001)]) {
    const f = await scenario(metadata, [person('247', 'Emily Simmons')], { 208495: path });
    try {
      const result = await f.read('247');
      assert.equal(result.status, 'live');
      assert.equal(result.participants[0].lat, 52.2);
      assert.deepEqual(result.participants[0].recentReports, []);
      assert.deepEqual(result.participants[0].paceReports, []);
      assert(!JSON.stringify(result).includes('private provider failure'));
    } finally { f.restore(); }
  }
});

test('optional history is skipped when the remaining request budget cannot protect the live position response', async () => {
  const originalNow = Date.now;
  const start = originalNow();
  const f = await scenario(metadata, [person('247', 'Emily Simmons')]);
  const fixtureFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await fixtureFetch(url, options);
    if (String(url).endsWith('/participants')) Date.now = () => start + 12_600;
    return response;
  };
  Date.now = () => start;
  try {
    const result = await f.read('247');
    assert.equal(result.status, 'live');
    assert.equal(result.participants[0].lat, 52.2);
    assert.deepEqual(result.participants[0].recentReports, []);
    assert(!f.calls.some(url => url.endsWith('/path')));
  } finally { Date.now = originalNow; f.restore(); }
});

test('invalid IDs never request history; finished/retired crew may backfill achievements without exposing pace', async () => {
  for (const changes of [{ id: '../208504' }, { id: 2.5 }, { retired: true }, { finished: true }, { routes: [{ finished: true }] }]) {
    const f = await scenario(metadata, [{ ...person('247', 'Emily Simmons'), ...changes }]);
    try {
      const result = await f.read('247');
      assert.equal(result.status, 'live');
      assert.deepEqual(result.participants[0].recentReports, []);
      assert.equal(f.calls.some(url => url.endsWith('/path')), !Object.hasOwn(changes, 'id'));
    } finally { f.restore(); }
  }
});

test('the deployed Workers runtime can fetch both bibs and still rejects provider redirects', async () => {
  // The Node fetch mock accepts redirect:error, but the deployed Workers
  // runtime rejects it synchronously. Exercise real workerd fetch semantics.
  const { Miniflare } = await import('miniflare');
  const { build } = await import('esbuild');
  const built = await build({stdin:{contents:readFileSync(moduleUrl, 'utf8')+'\nexport default {fetch:GET};',loader:'ts',resolveDir:new URL('../app/api/tracker/',import.meta.url).pathname},bundle:true,write:false,format:'esm',target:'es2022',platform:'neutral',external:['cloudflare:workers']});
  const source = built.outputFiles[0].text;
  const calls = [];
  const worker = new Miniflare({
    modules: true, script: source, scriptPath:moduleUrl.pathname+'.bundled.js', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService: async request => {
      calls.push(request.url);
      return Response.json(request.url.endsWith('/participants')
        ? [{ ...person('247', 'Emily Simmons'), lastReport: null }, { ...person('133', 'Jeff Simmons'), lastReport: null }]
        : { event: { ...metadata.event, active: false } });
    },
  });
  try {
    for (const bib of ['247', '133']) {
      const response = await worker.dispatchFetch('https://example.test/api/tracker?bib=' + bib);
      const result = await response.json();
      assert.equal(result.status, 'waiting');
      assert.equal(result.participants[0].bib, bib);
    }
    assert.deepEqual(calls, ['https://track.trail.live/event/35950', 'https://track.trail.live/event/35950/participants']);
  } finally { await worker.dispose(); }

  // Exercise the new server-side ledger through the actual Workers env
  // import and D1 binding, not just the Node/SQLite transport adapter.
  const expiresAt=Date.now()+60*60_000;
  const liveWorker=new Miniflare({
    modules:true,script:source,scriptPath:moduleUrl.pathname+'.bundled.js',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],bindings:{PUBLIC_CREW_VIEW_HASH:'a'.repeat(64),PUBLIC_CREW_PUBLISH_HASH:'b'.repeat(64),PUBLIC_CREW_EXPIRES_AT:new Date(expiresAt).toISOString()},
    outboundService:async request=>Response.json(request.url.endsWith('/path')?[]:request.url.endsWith('/participants')?[person('247','Emily Simmons')]:metadata),
  });
  try{
    const db=await liveWorker.getD1Database('DB');
    for(const sql of readFileSync(new URL('../drizzle/0000_flimsy_betty_ross.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint','').split(';').filter(sql=>sql.trim()))await db.prepare(sql).run();
    await db.prepare('INSERT INTO crew_rooms(view_hash,publish_hash,created_at,expires_at,updated_at,sharing,bib) VALUES(?,?,?,?,?,0,?)').bind('a'.repeat(64),'b'.repeat(64),Date.now(),expiresAt,Date.now(),'').run();
    const result=await (await liveWorker.dispatchFetch('https://example.test/api/tracker?bib=247')).json();
    assert.equal(result.status,'live');
    assert.equal(result.achievements.eventId,35950);
    assert.equal(result.achievements.persisted,true);
  }finally{await liveWorker.dispose();}

  const redirects = [];
  const redirected = new Miniflare({
    modules: true, script: source, scriptPath:moduleUrl.pathname+'.bundled.js', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    outboundService: async request => {
      redirects.push(request.url);
      return new Response(null, { status: 302, headers: { Location: 'https://other.example.test/data' } });
    },
  });
  try {
    const response = await redirected.dispatchFetch('https://example.test/api/tracker?bib=247');
    assert.equal((await response.json()).status, 'unavailable');
    assert.deepEqual(redirects, ['https://track.trail.live/event/35950']);
  } finally { await redirected.dispose(); }
});
