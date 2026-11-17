import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { handleCrewRequest } from '../lib/crew-room.ts';
import { publicCrewConfig } from '../lib/public-crew-config.ts';

// Exercise the real SQL through SQLite, with only D1's transport adapted.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_flimsy_betty_ross.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const query = { sql, args: [], bind(...args) { this.args = args; return this; }, async run() { const result = sqlite.prepare(sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; } };
      return query;
    },
    async batch(queries) {
      sqlite.exec('BEGIN');
      try {
        const results = queries.map(q => {
          const statement = sqlite.prepare(q.sql);
          if (/^SELECT\b/i.test(q.sql)) return { results: statement.all(...q.args), meta: { changes: 0 } };
          const result = statement.run(...q.args);
          return { results: [], meta: { changes: Number(result.changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return { db, sqlite };
}

const ORIGIN = 'https://crew.example.test';
const NOW = Date.parse('2026-11-13T22:00:00Z');
function request(method, token, body, origin = ORIGIN) {
  return new Request(ORIGIN + '/api/crew', {
    method, headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
const meetup = { id: 'point-6', label: 'Point 6', routeKm: 64.2, lat: 52.13, lng: -0.99, mapUrl: 'https://www.google.com/maps/search/?api=1&query=52.13,-0.99', note: 'Agreed entrance' };

async function fixture() {
  const storage = database();
  const created = await handleCrewRequest(request('POST', null, { action: 'create' }), storage.db, NOW);
  assert.equal(created.status, 201);
  const room = await created.json();
  const patch = async (body, at = NOW + 1000, token = room.publishToken) => {
    const response = await handleCrewRequest(request('PATCH', token, body), storage.db, at);
    return { response, body: await response.json() };
  };
  const read = async (at = NOW + 2000) => {
    const response = await handleCrewRequest(request('GET', room.viewToken), storage.db, at);
    return { response, body: await response.json() };
  };
  return { ...storage, room, patch, read };
}

test('a room has no future celebration schedule; releases need a publish token', async () => {
  const f = await fixture();
  assert.equal(Date.parse(f.room.expiresAt), NOW + 48 * 60 * 60 * 1000);
  assert.deepEqual((await f.read()).body.releases, []);
  const denied = await f.patch({ celebration: 'km-60' }, NOW + 1000, f.room.viewToken);
  assert.equal(denied.response.status, 404);
  assert.deepEqual((await f.read()).body.releases, []);
  const invalid = await f.patch({ celebration: 'unexpected-poster' });
  assert.equal(invalid.response.status, 400);
  const crossOrigin = await handleCrewRequest(request('PATCH', f.room.publishToken, { celebration: 'km-60' }, 'https://elsewhere.test'), f.db, NOW + 1000);
  assert.equal(crossOrigin.status, 403);
});

test('releasing preserves position, bib and meet-up; retry keeps release time', async () => {
  const f = await fixture();
  const position = { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 };
  assert.equal((await f.patch({ sharing: true, position, bib: '123', meetup })).response.status, 200);
  const release = await f.patch({ celebration: 'km-60' }, NOW + 2000);
  assert.equal(release.response.status, 200);
  assert.deepEqual(release.body.meetup, meetup);
  assert.equal(release.body.position.lat, position.lat);
  assert.equal(release.body.sharing, true);
  assert.equal(release.body.bib, '123');
  assert.deepEqual(release.body.releases, [{ id: 'km-60', releasedAt: new Date(NOW + 2000).toISOString() }]);
  const repeated = await f.patch({ celebration: 'km-60' }, NOW + 3000);
  assert.deepEqual(repeated.body.releases, release.body.releases);
  const changed = await f.patch({ meetup: { ...meetup, note: 'Other entrance' }, bib: '456' }, NOW + 4000);
  assert.deepEqual(changed.body.releases, release.body.releases);
  assert.equal(changed.body.meetup.note, 'Other entrance');
  const stopped = await f.patch({ sharing: false }, NOW + 5000);
  assert.equal(stopped.body.position, null);
  assert.deepEqual(stopped.body.releases, release.body.releases);
});

test('legacy plain meet-up JSON is read and promoted without losing fields', async () => {
  const f = await fixture();
  f.sqlite.prepare('UPDATE crew_rooms SET meetup_json = ?').run(JSON.stringify(meetup));
  assert.deepEqual((await f.read()).body.meetup, meetup);
  const release = await f.patch({ celebration: 'km-70' });
  assert.deepEqual(release.body.meetup, meetup);
  assert.equal(release.body.releases[0].id, 'km-70');
  const cleared = await f.patch({ meetup: null }, NOW + 3000);
  assert.equal(cleared.body.meetup, null);
  assert.equal(cleared.body.releases[0].id, 'km-70');
});

test('combined metadata patch merges atomically, reads only released IDs in time order', async () => {
  const f = await fixture();
  await f.patch({ meetup, celebration: 'start' });
  await f.patch({ celebration: 'km-70' }, NOW + 3000);
  const updated = await f.patch({ celebration: 'km-60' }, NOW + 4000);
  assert.deepEqual(updated.body.meetup, meetup);
  assert.deepEqual(updated.body.releases.map(r => r.id), ['start', 'km-70', 'km-60']);
  assert.equal(JSON.stringify(updated.body).includes('km-90'), false);
});

test('GPS patches never release celebrations, reject older fixes, and require explicit sharing', async () => {
  const f = await fixture();
  const position = { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 };
  assert.equal((await f.patch({ position })).response.status, 409);
  const started = await f.patch({ sharing: true, position });
  assert.deepEqual(started.body.releases, []);
  const outdated = await f.patch({ position: { ...position, recordedAt: NOW } }, NOW + 2000);
  assert.equal(outdated.response.status, 409);
  assert.deepEqual((await f.read()).body.releases, []);
});

test('new rooms cover the full race, then expire after 48 hours', async () => {
  const f = await fixture();
  const afterRace = await f.read(NOW + 30 * 60 * 60 * 1000);
  assert.equal(afterRace.response.status, 200);
  const expired = await f.patch({ celebration: 'gold' }, NOW + 49 * 60 * 60 * 1000);
  assert.equal(expired.response.status, 404);
  const unavailable = await f.read(NOW + 49 * 60 * 60 * 1000);
  assert.equal(unavailable.response.status, 404);
});

test('existing rooms keep their earlier expiry on reads and updates', async () => {
  const f = await fixture();
  const priorExpiry = NOW + 24 * 60 * 60 * 1000;
  f.sqlite.prepare('UPDATE crew_rooms SET expires_at = ?').run(priorExpiry);
  const changed = await f.patch({ bib: '456', celebration: 'km-60' });
  assert.equal(Date.parse(changed.body.expiresAt), priorExpiry);
  assert.equal(Date.parse((await f.read()).body.expiresAt), priorExpiry);
  assert.equal((await f.read(NOW + 25 * 60 * 60 * 1000)).response.status, 404);
});

test('the publisher can revoke before expiry; a view token cannot', async () => {
  const f = await fixture();
  const denied = await handleCrewRequest(request('DELETE', f.room.viewToken, {}), f.db, NOW + 1000);
  assert.equal(denied.status, 404);
  assert.equal((await f.read()).response.status, 200);
  const revoked = await handleCrewRequest(request('DELETE', f.room.publishToken, {}), f.db, NOW + 2000);
  assert.equal(revoked.status, 200);
  assert.equal((await f.read()).response.status, 404);
});

const PUBLIC_PUBLISH_TOKEN = 'public-publisher-'.padEnd(43, 'p');
const PUBLIC_VIEW_TOKEN = 'public-view-'.padEnd(43, 'v');
const LOCATION_TOKEN = 'public-location-'.padEnd(43, 'l');
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const PUBLIC_CONFIG = {
  viewHash: tokenHash(PUBLIC_VIEW_TOKEN),
  publishHash: tokenHash(PUBLIC_PUBLISH_TOKEN),
  expiresAt: NOW + 48 * 60 * 60 * 1000,
};
function publicRequest() { return new Request(ORIGIN + '/api/crew?public=1'); }
async function publicFixture(config = PUBLIC_CONFIG) {
  const storage = database();
  const call = async (req, at = NOW) => {
    const response = await handleCrewRequest(req, storage.db, at, config);
    return { response, body: await response.json() };
  };
  const activate = at => call(request('POST', PUBLIC_PUBLISH_TOKEN, { action: 'activate-public' }), at);
  return { ...storage, call, activate };
}

test('public readers need no token and receive only the configured safe room', async () => {
  const f = await publicFixture();
  const waiting = await f.call(publicRequest());
  assert.equal(waiting.response.status, 200);
  assert.deepEqual(waiting.body, { public: true, status: 'waiting', room: null });
  const activated = await f.activate();
  assert.equal(activated.response.status, 201);
  assert.equal(activated.body.room.expiresAt, new Date(PUBLIC_CONFIG.expiresAt).toISOString());
  const position = { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 };
  const update = await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { sharing: true, position, bib: '321', meetup }), NOW + 1000);
  assert.equal(update.response.status, 200);
  const publicRead = await f.call(publicRequest(), NOW + 2000);
  assert.equal(publicRead.body.status, 'active');
  assert.equal(publicRead.body.room.bib, '321');
  assert.equal(publicRead.body.room.position.lat, position.lat);
  assert.deepEqual(publicRead.body.room.meetup, meetup);
  assert.deepEqual(publicRead.body.room.releases, []);
  const text = JSON.stringify(publicRead.body);
  for (const secret of [PUBLIC_PUBLISH_TOKEN, PUBLIC_VIEW_TOKEN, PUBLIC_CONFIG.viewHash, PUBLIC_CONFIG.publishHash, 'km-90']) assert.equal(text.includes(secret), false);
  assert.match(publicRead.response.headers.get('cache-control'), /no-store/);
  const repeated = await f.activate(NOW + 60 * 60 * 1000);
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.room.expiresAt, activated.body.room.expiresAt);
  assert.equal(repeated.body.room.position.lat, position.lat);
});

const LOCATION_CONFIG = { ...PUBLIC_CONFIG, locationHash: tokenHash(LOCATION_TOKEN) };
const activateLocation = () => request('POST', LOCATION_TOKEN, { action: 'activate-location' });

test('location recovery opens only the existing public room, without changing it or exposing credentials', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  assert.equal((await f.call(activateLocation())).response.status, 404);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM crew_rooms').get().n, 0);
  await f.activate();
  await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { bib: '247 / 133', meetup, celebration: 'start', googleMapsUrl: 'https://maps.app.goo.gl/example' }), NOW + 1000);
  const before = f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  const activated = await f.call(activateLocation(), NOW + 2000);
  assert.equal(activated.response.status, 200);
  assert.equal(activated.body.public, true);
  assert.equal(activated.body.status, 'active');
  assert.equal(activated.body.capability, 'location');
  assert.deepEqual(activated.body.room.meetup, meetup);
  assert.equal(activated.body.room.bib, '247 / 133');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(), before);
  for (const value of [LOCATION_TOKEN, LOCATION_CONFIG.locationHash, PUBLIC_PUBLISH_TOKEN, PUBLIC_CONFIG.publishHash, PUBLIC_CONFIG.viewHash, 'km-90']) {
    assert.equal(JSON.stringify(activated.body).includes(value), false);
  }
  assert.match(activated.response.headers.get('cache-control'), /no-store/);
});

test('a location grant publishes fresh GPS atomically while preserving full-publisher metadata and authority', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { bib: '247 / 133', meetup, celebration: 'start', googleMapsUrl: 'https://maps.app.goo.gl/example' }), NOW + 1000);
  const position = { lat: 52.11, lng: -1.22, accuracy: 8, recordedAt: NOW + 2000 };
  const started = await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true, position }), NOW + 2000);
  assert.equal(started.response.status, 200);
  assert.equal(started.body.position.recordedAt, new Date(position.recordedAt).toISOString());
  assert.equal(started.body.position.updatedAt, new Date(NOW + 2000).toISOString());
  assert.equal(started.body.sharing, true);
  assert.equal(started.body.bib, '247 / 133');
  assert.deepEqual(started.body.meetup, meetup);
  assert.equal(started.body.googleMapsUrl, 'https://maps.app.goo.gl/example');
  assert.deepEqual(started.body.releases, [{ id: 'start', releasedAt: new Date(NOW + 1000).toISOString() }]);
  const read = await f.call(publicRequest(), NOW + 3000);
  assert.deepEqual(read.body.room, started.body);
  const outdated = await f.call(request('PATCH', LOCATION_TOKEN, { position: { ...position, recordedAt: NOW + 1000 } }), NOW + 3000);
  assert.equal(outdated.response.status, 409);
  assert.equal(outdated.body.code, 'position_outdated');
  const stale = await f.call(request('PATCH', LOCATION_TOKEN, { position: { ...position, recordedAt: NOW - 3 * 60 * 1000 } }), NOW + 3000);
  assert.equal(stale.response.status, 400);
  const stopped = await f.call(request('PATCH', LOCATION_TOKEN, { sharing: false }), NOW + 4000);
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.body.position, null);
  assert.deepEqual(stopped.body.meetup, meetup);
  const withoutStart = await f.call(request('PATCH', LOCATION_TOKEN, { position: { ...position, recordedAt: NOW + 5000 } }), NOW + 5000);
  assert.equal(withoutStart.response.status, 409);
  assert.equal(withoutStart.body.code, 'sharing_stopped');
  const publisher = await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { bib: '133 / 247', meetup: { ...meetup, note: 'Updated by publisher' }, celebration: 'km-60' }), NOW + 6000);
  assert.equal(publisher.response.status, 200);
  assert.equal(publisher.body.bib, '133 / 247');
  assert.equal(publisher.body.releases.length, 2);
  assert.equal(Date.parse(publisher.body.expiresAt), PUBLIC_CONFIG.expiresAt);
});

test('the location grant rejects arbitrary settings, revocation, full activation and cross-origin writes', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  const before = f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for (const field of [{ bib: '123' }, { meetup }, { meetup: null }, { googleMapsUrl: null }, { celebration: 'start' }, { unknown: true }, { position: null, bib: '123' }]) {
    const denied = await f.call(request('PATCH', LOCATION_TOKEN, field), NOW + 1000);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, 'location_only');
  }
  assert.equal((await f.call(request('DELETE', LOCATION_TOKEN, {}), NOW + 1000)).response.status, 403);
  assert.equal((await f.call(request('POST', LOCATION_TOKEN, { action: 'activate-public' }), NOW + 1000)).response.status, 403);
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true }, 'https://elsewhere.test'), NOW + 1000)).response.status, 403);
  assert.equal((await f.call(request('POST', LOCATION_TOKEN, { action: 'activate-location' }, 'https://elsewhere.test'), NOW + 1000)).response.status, 403);
  assert.equal((await f.call(request('POST', null, { action: 'activate-location' }), NOW + 1000)).response.status, 401);
  assert.equal((await f.call(request('POST', PUBLIC_VIEW_TOKEN, { action: 'activate-location' }), NOW + 1000)).response.status, 403);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(), before);
});

test('location recovery cannot write a replacement room or revive a revoked public session', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  const position = { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 };
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true, position }), NOW + 1000)).response.status, 404);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM crew_rooms').get().n, 0);
  await f.activate();
  await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true, position }), NOW + 1000);
  assert.equal((await f.call(request('DELETE', PUBLIC_PUBLISH_TOKEN, {}), NOW + 2000)).response.status, 200);
  const tombstone = f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  assert.equal((await f.call(activateLocation(), NOW + 3000)).response.status, 410);
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true, position: { ...position, recordedAt: NOW + 3000 } }), NOW + 3000)).response.status, 410);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(), tombstone);
  assert.deepEqual((await f.call(publicRequest(), NOW + 3000)).body, { public: true, status: 'ended', room: null, releases: [] });
});

test('location recovery obeys absolute public expiry even if a database row lasts longer', async () => {
  for (const action of ['activate', 'patch']) {
    const f = await publicFixture(LOCATION_CONFIG);
    await f.activate();
    await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true, position: { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 } }), NOW + 1000);
    f.sqlite.prepare('UPDATE crew_rooms SET expires_at = ?').run(PUBLIC_CONFIG.expiresAt + 60 * 60 * 1000);
    const expired = await f.call(action === 'activate' ? activateLocation() : request('PATCH', LOCATION_TOKEN, { sharing: true, position: { lat: 52.2, lng: -1, accuracy: 10, recordedAt: PUBLIC_CONFIG.expiresAt } }), PUBLIC_CONFIG.expiresAt);
    assert.equal(expired.response.status, 410);
    const row = f.sqlite.prepare('SELECT * FROM crew_rooms').get();
    assert.equal(row.expires_at, PUBLIC_CONFIG.expiresAt);
    assert.equal(row.sharing, 0);
    assert.equal(row.lat, null);
    assert.equal(row.publish_hash, PUBLIC_CONFIG.publishHash);
  }
});

test('missing, malformed or colliding optional location configuration never disrupts the original publisher', async () => {
  for (const locationHash of [undefined, '', 'malformed', PUBLIC_CONFIG.viewHash, PUBLIC_CONFIG.publishHash]) {
    const f = await publicFixture({ ...PUBLIC_CONFIG, locationHash });
    await f.activate();
    assert.equal((await f.call(activateLocation())).response.status, 503);
    assert.equal((await f.call(publicRequest())).body.status, 'active');
    const publisher = await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { bib: '247', meetup }), NOW + 1000);
    assert.equal(publisher.response.status, 200);
    assert.equal(publisher.body.bib, '247');
    assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, { sharing: true }), NOW + 1000)).response.status, 404);
  }
  const config = publicCrewConfig({ PUBLIC_CREW_VIEW_HASH: PUBLIC_CONFIG.viewHash, PUBLIC_CREW_PUBLISH_HASH: PUBLIC_CONFIG.publishHash, PUBLIC_CREW_LOCATION_HASH: LOCATION_CONFIG.locationHash, PUBLIC_CREW_EXPIRES_AT: new Date(PUBLIC_CONFIG.expiresAt).toISOString() });
  assert.deepEqual(config, LOCATION_CONFIG);
});

test('anonymous readers, view credentials and ordinary private-room owners cannot take over the public feed', async () => {
  const f = await publicFixture();
  assert.equal((await f.call(request('POST', null, { action: 'activate-public' }))).response.status, 401);
  assert.equal((await f.call(request('POST', PUBLIC_VIEW_TOKEN, { action: 'activate-public' }))).response.status, 403);
  assert.equal((await f.call(request('POST', PUBLIC_PUBLISH_TOKEN, { action: 'activate-public' }, 'https://elsewhere.test'))).response.status, 403);
  const privateMade = await f.call(request('POST', null, { action: 'create' }), NOW + 20 * 60 * 1000);
  assert.equal(privateMade.response.status, 201);
  assert.equal((await f.call(request('POST', privateMade.body.publishToken, { action: 'activate-public' }))).response.status, 403);
  await f.activate();
  assert.equal((await f.call(request('PATCH', null, { bib: 'bad' }))).response.status, 401);
  assert.equal((await f.call(request('PATCH', PUBLIC_VIEW_TOKEN, { bib: 'bad' }))).response.status, 404);
  assert.equal((await f.call(request('PATCH', privateMade.body.publishToken, { bib: 'private-only' }))).response.status, 200);
  const publicRead = await f.call(publicRequest());
  assert.equal(publicRead.body.room.bib, '');
  const stillPrivate = await handleCrewRequest(request('GET', privateMade.body.viewToken), f.db, NOW, PUBLIC_CONFIG);
  assert.equal((await stillPrivate.json()).bib, 'private-only');
});

test('revoking the public session leaves a data-free tombstone that every cleanup path preserves', async () => {
  const f = await publicFixture();
  await f.activate();
  await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { sharing: true, position: { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 }, bib: '321', meetup, celebration: 'start' }), NOW + 1000);
  assert.equal((await f.call(request('DELETE', PUBLIC_VIEW_TOKEN, {}), NOW + 2000)).response.status, 404);
  const revoked = await f.call(request('DELETE', PUBLIC_PUBLISH_TOKEN, {}), NOW + 2000);
  assert.equal(revoked.response.status, 200);
  const row = f.sqlite.prepare('SELECT * FROM crew_rooms WHERE view_hash = ?').get(PUBLIC_CONFIG.viewHash);
  assert.equal(row.expires_at, NOW + 2000);
  assert.equal(row.sharing, 0);
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  assert.equal(row.bib, '');
  assert.equal(row.meetup_json, null);
  assert.equal(row.google_maps_url, null);
  assert.deepEqual((await f.call(publicRequest(), NOW + 3000)).body, { public: true, status: 'ended', room: null, releases: [] });
  assert.equal((await f.call(request('GET', PUBLIC_PUBLISH_TOKEN), NOW + 3000)).response.status, 404);
  assert.equal((await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { bib: '321' }), NOW + 3000)).response.status, 404);
  assert.equal((await f.call(request('POST', null, { action: 'create' }), NOW + 40 * 60 * 1000)).response.status, 201);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM crew_rooms WHERE view_hash = ?').get(PUBLIC_CONFIG.viewHash).n, 1);
  assert.equal((await f.activate(NOW + 40 * 60 * 1000)).response.status, 410);
});

test('absolute public expiry cannot be extended and missing configuration does not break private rooms', async () => {
  const f = await publicFixture();
  await f.activate();
  assert.deepEqual((await f.call(publicRequest(), PUBLIC_CONFIG.expiresAt)).body, { public: true, status: 'ended', room: null, releases: [] });
  assert.equal((await f.activate(PUBLIC_CONFIG.expiresAt)).response.status, 410);
  const missing = await handleCrewRequest(publicRequest(), f.db, NOW);
  assert.equal(missing.status, 503);
  const invalidConfig = { ...PUBLIC_CONFIG, publishHash: '', expiresAt: NaN };
  const malformed = await handleCrewRequest(publicRequest(), f.db, NOW, invalidConfig);
  assert.equal(malformed.status, 503);
  const privateMade = await handleCrewRequest(request('POST', null, { action: 'create' }), f.db, NOW + 60 * 60 * 1000, invalidConfig);
  assert.equal(privateMade.status, 201);
  const credentials = await privateMade.json();
  assert.equal((await handleCrewRequest(request('GET', credentials.viewToken), f.db, NOW + 60 * 60 * 1000, invalidConfig)).status, 200);
});

test('the first public read or activation after expiry scrubs race locations and plans but retains released poster history', async () => {
  for (const action of ['read', 'activate']) {
    const f = await publicFixture();
    await f.activate();
    const patch = { sharing: true, position: { lat: 52.1, lng: -1, accuracy: 10, recordedAt: NOW + 1000 }, bib: '321', meetup, celebration: 'start', googleMapsUrl: 'https://maps.app.goo.gl/example' };
    assert.equal((await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, patch), NOW + 1000)).response.status, 200);
    const expired = action === 'read'
      ? await f.call(publicRequest(), PUBLIC_CONFIG.expiresAt)
      : await f.activate(PUBLIC_CONFIG.expiresAt);
    assert.equal(expired.response.status, action === 'read' ? 200 : 410);
    if (action === 'read') assert.deepEqual(expired.body, { public: true, status: 'ended', room: null, releases: [{id:'start',releasedAt:new Date(NOW+1000).toISOString()}] });
    const row = f.sqlite.prepare('SELECT * FROM crew_rooms WHERE view_hash = ?').get(PUBLIC_CONFIG.viewHash);
    assert.equal(row.expires_at, PUBLIC_CONFIG.expiresAt);
    assert.equal(row.sharing, 0);
    for (const key of ['lat', 'lng', 'accuracy', 'position_updated_at', 'position_recorded_at', 'google_maps_url']) assert.equal(row[key], null);
    assert.deepEqual(JSON.parse(row.meetup_json),{celebrations:{start:NOW+1000}});
    assert.equal(row.bib, '');
    const scrubbedAt = row.updated_at;
    assert.equal((await f.call(publicRequest(), PUBLIC_CONFIG.expiresAt + 1000)).body.room, null);
    assert.equal(f.sqlite.prepare('SELECT updated_at FROM crew_rooms WHERE view_hash = ?').get(PUBLIC_CONFIG.viewHash).updated_at, scrubbedAt);
    assert.equal((await f.activate(PUBLIC_CONFIG.expiresAt + 1000)).response.status, 410);
  }
});

const checkpoint = (action, pointId) => ({ checkpoint: { action, pointId } });

test('a connected supporter completes a known stop once and all public viewers see the next town', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  const before = (await f.call(publicRequest())).body.room;
  assert.deepEqual(before.completedPointIds, ['meetup-mfg-coventry']);
  assert.deepEqual(before.checkpointStatuses, {});
  const done = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 1000);
  assert.equal(done.response.status, 200);
  assert.equal(done.body.meetup.id, 'point-2');
  assert.match(done.body.meetup.label, /Willoughby/);
  assert.deepEqual(done.body.completedPointIds, ['meetup-mfg-coventry', 'point-1']);
  assert.deepEqual(done.body.checkpointStatuses['point-1'], { status: 'met', at: new Date(NOW + 1000).toISOString() });
  assert.deepEqual(done.body.lastCheckpointAction, { pointId: 'point-1', action: 'complete', completedAt: new Date(NOW + 1000).toISOString() });
  assert.equal(done.body.position, null);
  assert.equal(done.body.sharing, false);
  assert.equal(done.body.expiresAt, before.expiresAt);
  const read = (await f.call(publicRequest(), NOW + 2000)).body.room;
  assert.deepEqual(read.meetup, done.body.meetup);
  assert.deepEqual(read.checkpointStatuses, done.body.checkpointStatuses);
  assert.equal(JSON.stringify(read).includes('previousMeetup'), false);
  assert.equal(JSON.stringify(read).includes('previousCheckpointStatuses'), false);
  assert.deepEqual(read.releases, []);
  const retry = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 3000);
  assert.deepEqual(retry.body, done.body);
  await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, checkpoint('skip', 'point-2')), NOW + 4000);
  const delayed = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 5000);
  assert.equal(delayed.body.meetup.id, 'point-3');
  assert.equal(delayed.body.checkpointStatuses['point-2'].status, 'skipped');
});

test('completing or skipping a nearby alternative advances one whole group, and Undo restores it', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  const done = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-4-1')), NOW + 1000);
  assert.equal(done.response.status, 200);
  assert.equal(done.body.meetup.id, 'point-5');
  assert.equal(done.body.checkpointStatuses['point-4-1'].status, 'met');
  assert.equal(done.body.checkpointStatuses['point-4-2'].status, 'skipped');
  const otherOption = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-4-2')), NOW + 2000);
  assert.equal(otherOption.body.meetup.id, 'point-5');
  assert.deepEqual(otherOption.body.lastCheckpointAction, done.body.lastCheckpointAction);
  const undone = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('undo', 'point-4-1')), NOW + 3000);
  assert.equal(undone.response.status, 200);
  assert.equal(undone.body.meetup.id, 'point-4-1');
  assert.deepEqual(undone.body.completedPointIds, ['meetup-mfg-coventry']);
  assert.deepEqual(undone.body.checkpointStatuses, {});
  assert.equal(undone.body.lastCheckpointAction, null);
  const retryUndo = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('undo', 'point-4-1')), NOW + 4000);
  assert.deepEqual(retryUndo.body, undone.body);
  const skipped = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('skip', 'point-4-2')), NOW + 5000);
  assert.equal(skipped.body.meetup.id, 'point-5');
  assert.equal(skipped.body.checkpointStatuses['point-4-1'].status, 'skipped');
  assert.equal(skipped.body.checkpointStatuses['point-4-2'].status, 'skipped');
  assert.equal(skipped.body.lastCheckpointAction.action, 'skip');
});

test('checkpoint writes are narrow, authenticated and cannot change fixed past stops or revive expired sharing', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')))).response.status, 404);
  await f.activate();
  const before = f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for (const token of [null, PUBLIC_VIEW_TOKEN, 'not-a-control-token'.padEnd(43, 'x')]) {
    const denied = await f.call(request('PATCH', token, checkpoint('complete', 'point-1')));
    assert.equal(denied.response.status, token ? 404 : 401);
  }
  for (const value of [checkpoint('complete', 'point-35'), checkpoint('edit', 'point-1'), { checkpoint: { action: 'complete', pointId: 'point-1', lat: 0 } }, { ...checkpoint('complete', 'point-1'), sharing: true }]) {
    assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, value))).response.status, 400);
  }
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1'), 'https://elsewhere.test'))).response.status, 403);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(), before);
  const fixed = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'meetup-mfg-coventry')), NOW + 1000);
  assert.equal(fixed.response.status, 200);
  assert.equal(fixed.body.lastCheckpointAction, null);
  assert.equal((await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('undo', 'meetup-mfg-coventry')), NOW + 2000)).response.status, 409);
  const expired = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), PUBLIC_CONFIG.expiresAt);
  assert.equal(expired.response.status, 410);
  assert.equal(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json, null);
});

test('stale checkpoint actions and Undo cannot move an explicitly changed plan backwards', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-3')), NOW + 1000);
  const old = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 2000);
  assert.equal(old.response.status, 409);
  assert.equal(old.body.code, 'checkpoint_outdated');
  await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, { meetup }), NOW + 3000);
  assert.equal((await f.call(publicRequest())).body.room.lastCheckpointAction, null);
  const undo = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('undo', 'point-3')), NOW + 4000);
  assert.equal(undo.response.status, 409);
  assert.equal(undo.body.code, 'checkpoint_conflict');
  assert.deepEqual((await f.call(publicRequest())).body.room.meetup, meetup);
});

test('two supporters completing the same checkpoint advance only once', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  const results = await Promise.all([
    f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 1000),
    f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, checkpoint('complete', 'point-1')), NOW + 1001),
  ]);
  for (const result of results) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.meetup.id, 'point-2');
  }
  const publicRoom = (await f.call(publicRequest(), NOW + 2000)).body.room;
  assert.deepEqual(publicRoom.completedPointIds, ['meetup-mfg-coventry', 'point-1']);
  assert.equal(publicRoom.meetup.id, 'point-2');
});

test('a simultaneous GPS and celebration update is preserved when checkpoint metadata retries', async () => {
  const f = await publicFixture(LOCATION_CONFIG);
  await f.activate();
  const originalBatch = f.db.batch.bind(f.db);
  let injected = false;
  f.db.batch = async queries => {
    if (!injected && queries.some(query => query.sql.startsWith('UPDATE crew_rooms SET meetup_json = ?'))) {
      injected = true;
      const otherUpdate = await f.call(request('PATCH', PUBLIC_PUBLISH_TOKEN, {
        sharing: true, position: { lat: 52.11, lng: -1.22, accuracy: 6, recordedAt: NOW + 2000 }, celebration: 'start',
      }), NOW + 2000);
      assert.equal(otherUpdate.response.status, 200);
    }
    return originalBatch(queries);
  };
  const done = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('complete', 'point-1')), NOW + 1000);
  assert.equal(done.response.status, 200);
  assert.equal(injected, true);
  assert.equal(done.body.meetup.id, 'point-2');
  assert.equal(done.body.position.lat, 52.11);
  assert.equal(done.body.position.recordedAt, new Date(NOW + 2000).toISOString());
  assert(Date.parse(done.body.updatedAt) > NOW + 2000, 'the retried checkpoint has a newer snapshot version than the intervening GPS update');
  assert.equal(done.body.position.updatedAt, new Date(NOW + 2000).toISOString());
  assert.deepEqual(done.body.releases, [{ id: 'start', releasedAt: new Date(NOW + 2000).toISOString() }]);
  const undo = await f.call(request('PATCH', LOCATION_TOKEN, checkpoint('undo', 'point-1')), NOW + 3000);
  assert.equal(undo.response.status, 200);
  assert.equal(undo.body.position.lat, 52.11);
  assert.deepEqual(undo.body.releases, done.body.releases);
});

test('a connected setup token selects only a canonical route pin and leaves stamps, GPS and access intact',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{sharing:true,position:{lat:52.1,lng:-1,accuracy:8,recordedAt:NOW+1000},celebration:'start'}),NOW+1000);
  await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),NOW+2000);
  const before=(await f.call(publicRequest(),NOW+2500)).body.room;
  const result=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','point-3')),NOW+3000);
  assert.equal(result.response.status,200);
  assert.equal(result.body.meetup.id,'point-3');
  assert.match(result.body.meetup.label,/Daventry/);
  assert.deepEqual(result.body.completedPointIds,before.completedPointIds);
  assert.deepEqual(result.body.checkpointStatuses,before.checkpointStatuses);
  assert.deepEqual(result.body.position,before.position);
  assert.deepEqual(result.body.releases,before.releases);
  assert.equal(result.body.expiresAt,before.expiresAt);
  assert.equal(result.body.lastCheckpointAction,null,'an explicit choice supersedes the old Undo target');
  assert.deepEqual((await f.call(publicRequest(),NOW+3500)).body.room.meetup,result.body.meetup);
  const repeated=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','point-3')),NOW+4000);
  assert.deepEqual(repeated.body,result.body,'repeated selection does not change the shared timestamp');
  for(const body of [checkpoint('select','invented-charge-stop'),checkpoint('select','point-35'),{checkpoint:{action:'select',pointId:'point-3',lat:0}},{...checkpoint('select','point-3'),sharing:false}]){
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,body),NOW+5000)).response.status,400);
  }
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','point-1')),NOW+5000)).response.status,409,'completed groups cannot be reopened by selection');
  assert.equal((await f.call(request('PATCH',PUBLIC_VIEW_TOKEN,checkpoint('select','point-2')),NOW+5000)).response.status,404);
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','point-2'),'https://elsewhere.test'),NOW+5000)).response.status,403);
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{meetup}),NOW+5000)).response.status,403,'the setup token still cannot submit arbitrary meet-up fields');
  assert.deepEqual((await f.call(publicRequest(),NOW+6000)).body.room.meetup,result.body.meetup);
});

test('the researched Daventry charging alternative shares, stamps its group, advances past optional chargers and can be undone',async()=>{
  const plan=JSON.parse(readFileSync(new URL('../public/data/support-points.json',import.meta.url),'utf8'));
  const group=plan.groups.find(group=>group.options.some(point=>point.id==='ev-meetup-osprey-daventry'));
  assert(group,'Bowen Square is a canonical meet-up choice');
  assert(group.options.some(point=>point.id==='point-3'),'charging is an alternative within the Daventry meeting group');
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const selected=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','ev-meetup-osprey-daventry')),NOW+1000);
  assert.equal(selected.response.status,200);
  assert.equal(selected.body.meetup.id,'ev-meetup-osprey-daventry');
  assert.match(selected.body.meetup.label,/Daventry/);
  assert.deepEqual(selected.body.checkpointStatuses,{});
  const done=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','ev-meetup-osprey-daventry')),NOW+2000);
  assert.equal(done.response.status,200);
  assert.equal(done.body.meetup.id,'point-4-1','next regular checkpoint stays ahead of optional charging choices');
  assert.equal(done.body.checkpointStatuses['ev-meetup-osprey-daventry'].status,'met');
  assert.equal(done.body.checkpointStatuses['point-3'].status,'skipped');
  const retry=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-3')),NOW+3000);
  assert.deepEqual(retry.body,done.body,'the nearby original pin cannot move the plan on twice');
  const undo=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('undo','ev-meetup-osprey-daventry')),NOW+4000);
  assert.equal(undo.response.status,200);
  assert.equal(undo.body.meetup.id,'ev-meetup-osprey-daventry');
  assert.deepEqual(undo.body.checkpointStatuses,{});
  assert.deepEqual(undo.body.completedPointIds,['meetup-mfg-coventry']);
});

const EV_BOWEN='ev-meetup-osprey-daventry';
const EV_TESCO='ev-meetup-tesco-daventry-toilet';
const EV_BP='ev-meetup-bp-millennium-way-daventry';

test('adding and removing a charger persists for every viewer without changing the agreed meeting or Undo',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{sharing:true,position:{lat:52.1,lng:-1,accuracy:8,recordedAt:NOW+1000},celebration:'start'}),NOW+1000);
  await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),NOW+2000);
  const before=(await f.call(publicRequest(),NOW+2500)).body.room;
  assert.deepEqual(before.addedEvPointIds,[]);
  const added=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('add-ev',EV_BOWEN)),NOW+3000);
  assert.equal(added.response.status,200);
  assert.deepEqual(added.body.addedEvPointIds,[EV_BOWEN]);
  for(const key of ['meetup','position','sharing','bib','completedPointIds','checkpointStatuses','lastCheckpointAction','expiresAt','releases'])assert.deepEqual(added.body[key],before[key],key+' is untouched');
  assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json).addedEvPointIds,[EV_BOWEN]);
  assert.deepEqual((await f.call(publicRequest(),NOW+3500)).body.room.addedEvPointIds,[EV_BOWEN]);
  assert.deepEqual((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('add-ev',EV_BOWEN)),NOW+4000)).body,added.body,'retry is idempotent, including timestamp');
  const removed=await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,checkpoint('remove-ev',EV_BOWEN)),NOW+5000);
  assert.equal(removed.response.status,200);
  assert.deepEqual(removed.body.addedEvPointIds,[]);
  for(const key of ['meetup','position','sharing','bib','completedPointIds','checkpointStatuses','lastCheckpointAction','expiresAt','releases'])assert.deepEqual(removed.body[key],before[key],key+' survives removal');
  assert.deepEqual((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('remove-ev',EV_BOWEN)),NOW+6000)).body,removed.body);
  assert.deepEqual((await f.call(publicRequest(),NOW+6500)).body.room.addedEvPointIds,[]);
  const undone=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('undo','point-1')),NOW+7000);
  assert.equal(undone.response.status,200,'editing the option list preserves a usable checkpoint Undo receipt');
  assert.equal(undone.body.meetup.id,'point-1');
});

test('EV option writes accept optional canonical pins only and cannot remove the agreed next stop',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  for(const action of ['add-ev','remove-ev']){
    for(const id of ['point-3','unknown-ev-stop','meetup-mfg-coventry'])assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint(action,id)),NOW+1000)).response.status,400);
    assert.equal((await f.call(request('PATCH',null,checkpoint(action,EV_BOWEN)),NOW+1000)).response.status,401);
    assert.equal((await f.call(request('PATCH',PUBLIC_VIEW_TOKEN,checkpoint(action,EV_BOWEN)),NOW+1000)).response.status,404);
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,checkpoint(action,EV_BOWEN),'https://elsewhere.test'),NOW+1000)).response.status,403);
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{checkpoint:{action,pointId:EV_BOWEN,lat:0}}),NOW+1000)).response.status,400);
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{...checkpoint(action,EV_BOWEN),sharing:true}),NOW+1000)).response.status,400);
  }
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{addedEvPointIds:[EV_BOWEN]}),NOW+1000)).response.status,403);
  const chosen=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select',EV_BOWEN)),NOW+2000);
  assert.equal(chosen.response.status,200);
  assert.deepEqual(chosen.body.addedEvPointIds,[EV_BOWEN],'old direct-select clients add the chosen EV too');
  const blocked=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('remove-ev',EV_BOWEN)),NOW+3000);
  assert.equal(blocked.response.status,409);
  assert.equal(blocked.body.code,'ev_current_meetup');
  assert.match(blocked.body.error,/Choose another meeting point/);
  assert.deepEqual((await f.call(publicRequest(),NOW+3500)).body.room,chosen.body);
  await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('select','point-4-1')),NOW+4000);
  const removed=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('remove-ev',EV_BOWEN)),NOW+5000);
  assert.equal(removed.response.status,200);
  assert.deepEqual(removed.body.addedEvPointIds,[]);
  assert.equal(removed.body.meetup.id,'point-4-1');
});

test('legacy EV preservation includes a selected or actually met charger but never skipped alternatives',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const at=new Date(NOW).toISOString();
  const metadata={meetup:{...meetup,id:EV_BOWEN},completedPointIds:[EV_BOWEN,EV_TESCO,EV_BP],checkpointStatuses:{[EV_BP]:{status:'met',at},[EV_TESCO]:{status:'skipped',at}},celebrations:{}};
  f.sqlite.prepare('UPDATE crew_rooms SET meetup_json = ?').run(JSON.stringify(metadata));
  const legacy=(await f.call(publicRequest(),NOW+1000)).body.room;
  assert.deepEqual(new Set(legacy.addedEvPointIds),new Set([EV_BP,EV_BOWEN]));
  assert(!legacy.addedEvPointIds.includes(EV_TESCO),'completed/skipped siblings are not opted in');
  const removed=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('remove-ev',EV_BP)),NOW+2000);
  assert.equal(removed.response.status,200);
  assert.deepEqual(removed.body.addedEvPointIds,[EV_BOWEN]);
  assert.equal(removed.body.checkpointStatuses[EV_BP].status,'met','past stamps remain true');
  assert.deepEqual((await f.call(publicRequest(),NOW+2500)).body.room.addedEvPointIds,[EV_BOWEN],'explicit removal stays removed on the next poll');
  const stored=JSON.parse(f.sqlite.prepare('SELECT meetup_json FROM crew_rooms').get().meetup_json);
  assert.deepEqual(stored.addedEvPointIds,[EV_BOWEN]);
});

test('an explicitly completed EV adds only that charger and keeps all unused sibling options unadded',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const done=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete',EV_BOWEN)),NOW+1000);
  assert.equal(done.response.status,200);
  assert.deepEqual(done.body.addedEvPointIds,[EV_BOWEN]);
  assert.equal(done.body.checkpointStatuses[EV_TESCO].status,'skipped');
  assert.equal(done.body.checkpointStatuses[EV_BP].status,'skipped');
  const undone=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('undo',EV_BOWEN)),NOW+2000);
  assert.deepEqual(undone.body.addedEvPointIds,[EV_BOWEN]);
  assert.equal(undone.body.meetup.id,EV_BOWEN);
});

test('concurrent EV additions, GPS and celebration changes merge without losing the current plan',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),NOW+1000);
  const originalBatch=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async queries=>{
    if(!injected&&queries.some(query=>query.sql.startsWith('UPDATE crew_rooms SET meetup_json = ?'))){
      injected=true;
      const other=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('add-ev',EV_TESCO)),NOW+2000);
      assert.equal(other.response.status,200);
      const gps=await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{sharing:true,position:{lat:52.12,lng:-1.23,accuracy:6,recordedAt:NOW+2000},celebration:'start'}),NOW+2000);
      assert.equal(gps.response.status,200);
    }
    return originalBatch(queries);
  };
  const added=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('add-ev',EV_BOWEN)),NOW+1500);
  assert.equal(added.response.status,200);
  assert(injected);
  assert.deepEqual(new Set(added.body.addedEvPointIds),new Set([EV_BOWEN,EV_TESCO]));
  assert.equal(added.body.meetup.id,'point-2');
  assert.equal(added.body.checkpointStatuses['point-1'].status,'met');
  assert.equal(added.body.position.lat,52.12);
  assert.equal(added.body.position.recordedAt,new Date(NOW+2000).toISOString());
  assert(Date.parse(added.body.updatedAt)>NOW+2000,'the final metadata commit gets its own newer snapshot version');
  assert.equal(added.body.position.updatedAt,new Date(NOW+2000).toISOString());
  assert.deepEqual(added.body.releases,[{id:'start',releasedAt:new Date(NOW+2000).toISOString()}]);
  const read=(await f.call(publicRequest(),NOW+2500)).body.room;
  assert.deepEqual(read,added.body);
});

test('public supporter streams migrate the old coordinate to Huiyan only and accept independent Graham GPS',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const huiyan={lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+1000};
  const oldClient=await f.call(request('PATCH',LOCATION_TOKEN,{sharing:true,position:huiyan}),NOW+1000);
  assert.equal(oldClient.response.status,200);
  assert.deepEqual(oldClient.body.supporters.huiyan,{position:oldClient.body.position,sharing:true});
  assert.deepEqual(oldClient.body.supporters.graham,{position:null,sharing:false},'Graham never inherits the formerly shared fix');
  assert.deepEqual(oldClient.body.supporters.jeff,{position:null,sharing:false},'Jeff starts without an invented phone or old tracker position');
  const graham={lat:52.24,lng:-1.13,accuracy:9,recordedAt:NOW+2000};
  const walking=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true,position:graham}),NOW+2000);
  assert.equal(walking.response.status,200);
  assert.deepEqual(walking.body.supporters.huiyan,oldClient.body.supporters.huiyan);
  assert.deepEqual(walking.body.position,oldClient.body.position,'legacy consumers keep Huiyan as the driving origin');
  assert.equal(walking.body.supporters.graham.position.lat,graham.lat);
  assert.equal(walking.body.supporters.graham.position.recordedAt,new Date(graham.recordedAt).toISOString());
  assert.equal(walking.body.supporters.graham.position.updatedAt,new Date(NOW+2000).toISOString());
  assert.equal(walking.body.supporters.graham.sharing,true);
  const read=(await f.call(publicRequest(),NOW+3000)).body.room;
  assert.deepEqual(read.supporters,walking.body.supporters,'all unauthenticated viewers see both independent reports');
  for(const secret of [LOCATION_TOKEN,LOCATION_CONFIG.locationHash,PUBLIC_PUBLISH_TOKEN,PUBLIC_CONFIG.publishHash])assert(!JSON.stringify(read).includes(secret));
});

test('stopping either supporter affects only that person and fresh updates require their own active session',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const point={lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+1000};
  for(const personId of ['huiyan','graham']){
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true,position:point}),NOW+1000)).response.status,200);
  }
  const before=(await f.call(publicRequest(),NOW+1500)).body.room;
  const stopHuiyan=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'huiyan',sharing:false}),NOW+2000);
  assert.equal(stopHuiyan.response.status,200);
  assert.deepEqual(stopHuiyan.body.supporters.huiyan,{position:null,sharing:false});
  assert.deepEqual(stopHuiyan.body.supporters.graham,before.supporters.graham);
  const next={...point,lng:-1.21,recordedAt:NOW+3000};
  const grahamTick=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:next}),NOW+3000);
  assert.equal(grahamTick.response.status,200,'Graham continues while Huiyan is stopped');
  assert.equal(grahamTick.body.position,null);
  const blockedHuiyan=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'huiyan',position:next}),NOW+3000);
  assert.equal(blockedHuiyan.response.status,409);assert.equal(blockedHuiyan.body.code,'sharing_stopped');
  const restarted=await f.call(request('PATCH',LOCATION_TOKEN,{sharing:true,position:next}),NOW+3000);
  assert.equal(restarted.response.status,200,'an old client still controls only Huiyan');
  const stopGraham=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:false}),NOW+4000);
  assert.deepEqual(stopGraham.body.supporters.graham,{position:null,sharing:false});
  assert.deepEqual(stopGraham.body.supporters.huiyan,restarted.body.supporters.huiyan);
  const blockedGraham=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:{...next,recordedAt:NOW+5000}}),NOW+5000);
  assert.equal(blockedGraham.response.status,409);assert.equal(blockedGraham.body.code,'sharing_stopped');
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId:'huiyan',position:{...next,recordedAt:NOW+5000}}),NOW+5000)).response.status,200);
});

test('each supporter checks its own GPS ordering even when the other phone has a newer fix',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const position={lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+10000};
  await f.call(request('PATCH',LOCATION_TOKEN,{personId:'huiyan',sharing:true,position}),NOW+10000);
  const earlier={...position,lat:52.24,recordedAt:NOW+5000};
  const graham=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true,position:earlier}),NOW+11000);
  assert.equal(graham.response.status,200,'Huiyan’s newer timestamp must not reject Graham’s fresh fix');
  for(const personId of ['huiyan','graham']){
    const rejected=await f.call(request('PATCH',LOCATION_TOKEN,{personId,position:{...position,recordedAt:NOW+4000}}),NOW+12000);
    assert.equal(rejected.response.status,409);assert.equal(rejected.body.code,'position_outdated');
  }
  const advanced=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:{...earlier,recordedAt:NOW+9000}}),NOW+12000);
  assert.equal(advanced.response.status,200);
  assert.equal(advanced.body.supporters.graham.position.recordedAt,new Date(NOW+9000).toISOString());
  assert.equal(advanced.body.supporters.huiyan.position.recordedAt,new Date(NOW+10000).toISOString());
  const before=advanced.body.supporters;
  const empty=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:null}),NOW+13000);
  assert.equal(empty.body.supporters.graham.position,null);
  assert.deepEqual(empty.body.supporters.huiyan,before.huiyan);
});

test('same-clock and delayed commits have strictly ordered room versions without changing either GPS clock',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const at=NOW+1000,point={lat:52.12,lng:-1.22,accuracy:6,recordedAt:at};
  let previousVersion=NOW;
  for(const personId of ['huiyan','graham']){
    const result=await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true,position:point}),at);
    assert.equal(result.response.status,200);
    assert(Date.parse(result.body.updatedAt)>previousVersion,'separate same-clock writes have distinguishable versions');
    previousVersion=Date.parse(result.body.updatedAt);
    assert.equal(result.body.supporters[personId].position.recordedAt,new Date(at).toISOString());
    assert.equal(result.body.supporters[personId].position.updatedAt,new Date(at).toISOString());
  }
  const originalBatch=f.db.batch.bind(f.db);let intervening;
  f.db.batch=async queries=>{
    if(!intervening&&queries.some(query=>query.sql.startsWith('UPDATE crew_rooms SET meetup_json = ?'))){
      intervening=true;
      intervening=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:{...point,lat:52.24,recordedAt:NOW+2000}}),NOW+2000);
      assert.equal(intervening.response.status,200);
    }
    return originalBatch(queries);
  };
  // This older request reaches its CAS after a newer phone report commits.
  const delayed=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),at);
  assert.equal(delayed.response.status,200);
  assert(Date.parse(delayed.body.updatedAt)>Date.parse(intervening.body.updatedAt));
  assert.deepEqual(delayed.body.supporters,intervening.body.supporters,'the version bump does not freshen or replace GPS observations');
  assert.equal(delayed.body.supporters.huiyan.position.updatedAt,new Date(at).toISOString());
  assert.equal(delayed.body.supporters.graham.position.updatedAt,new Date(NOW+2000).toISOString());
  const stopped=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:false}),NOW+2000);
  assert.equal(stopped.response.status,200);
  assert(Date.parse(stopped.body.updatedAt)>Date.parse(delayed.body.updatedAt),'a delayed GET before Stop has a strictly older version');
  assert.deepEqual(stopped.body.supporters.graham,{position:null,sharing:false});
  assert.deepEqual(stopped.body.supporters.huiyan,delayed.body.supporters.huiyan);
  const refused=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',position:{...point,recordedAt:NOW+3000}}),NOW+3000);
  assert.equal(refused.response.status,409);
  assert.deepEqual((await f.call(publicRequest(),NOW+3000)).body.room,stopped.body,'a rejected update and a read do not advance the committed version');
});

test('Jeff shares an independent third phone position with isolated ordering and Stop controls',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const point={lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+1000};
  for(const personId of ['huiyan','graham'])assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true,position:point}),NOW+1000)).response.status,200);
  const before=(await f.call(publicRequest(),NOW+1500)).body.room;
  assert.deepEqual(before.supporters.jeff,{position:null,sharing:false});
  const started=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',sharing:true,position:{...point,lat:52.3,recordedAt:NOW+500}}),NOW+2000);
  assert.equal(started.response.status,200,'the location grant can start Jeff without a race tracker');
  assert.equal(started.body.supporters.jeff.position.lat,52.3);
  assert.equal(started.body.supporters.jeff.position.recordedAt,new Date(NOW+500).toISOString(),'Jeff is ordered against his own stream, not another phone');
  assert.equal(started.body.supporters.jeff.position.updatedAt,new Date(NOW+2000).toISOString());
  for(const personId of ['huiyan','graham'])assert.deepEqual(started.body.supporters[personId],before.supporters[personId]);
  assert.deepEqual(started.body.position,before.position,'legacy location and driving consumers still use Huiyan');
  const fresh=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',position:{...point,lat:52.31,recordedAt:NOW+3000}}),NOW+3000);
  assert.equal(fresh.response.status,200);
  const stale=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',position:{...point,lat:52.32,recordedAt:NOW+2500}}),NOW+3500);
  assert.equal(stale.response.status,409);assert.equal(stale.body.code,'position_outdated');
  assert.deepEqual((await f.call(publicRequest(),NOW+3500)).body.room.supporters,fresh.body.supporters);
  const stopGraham=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:false}),NOW+4000);
  assert.deepEqual(stopGraham.body.supporters.jeff,fresh.body.supporters.jeff,'Graham stopping does not stop or erase Jeff');
  const tick=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',position:{...point,lat:52.33,recordedAt:NOW+5000}}),NOW+5000);
  assert.equal(tick.response.status,200);
  const stopJeff=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',sharing:false}),NOW+6000);
  assert.deepEqual(stopJeff.body.supporters.jeff,{position:null,sharing:false});
  assert.deepEqual(stopJeff.body.supporters.huiyan,before.supporters.huiyan);
  assert.deepEqual(stopJeff.body.supporters.graham,{position:null,sharing:false});
  const blocked=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',position:{...point,recordedAt:NOW+7000}}),NOW+7000);
  assert.equal(blocked.response.status,409);assert.equal(blocked.body.code,'sharing_stopped');
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{position:{...point,recordedAt:NOW+7000}}),NOW+7000)).response.status,200,'the legacy client continues updating only Huiyan');
  const read=(await f.call(publicRequest(),NOW+8000)).body.room;
  assert.deepEqual(read.supporters.jeff,{position:null,sharing:false});
  for(const secret of [LOCATION_TOKEN,LOCATION_CONFIG.locationHash,PUBLIC_PUBLISH_TOKEN,PUBLIC_CONFIG.publishHash])assert(!JSON.stringify(read).includes(secret));
});

test('Ben has an independent opt-in phone stream without changing existing crew positions',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const original=(await f.call(publicRequest())).body.room.supporters;
  assert.deepEqual(original.ben,{position:null,sharing:false});
  const fix={lat:52.33,lng:-1.18,accuracy:8,recordedAt:NOW+1000};
  const started=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'ben',sharing:true,position:fix}),NOW+1000);
  assert.equal(started.response.status,200);
  assert.equal(started.body.supporters.ben.position.lat,fix.lat);
  for(const id of ['huiyan','graham','jeff'])assert.deepEqual(started.body.supporters[id],original[id]);
  const stale=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'ben',position:{...fix,lat:52.34,recordedAt:NOW+500}}),NOW+2000);
  assert.equal(stale.response.status,409);assert.equal(stale.body.code,'position_outdated');
  const updated=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'ben',position:{...fix,lat:52.35,recordedAt:NOW+3000}}),NOW+3000);
  assert.equal(updated.response.status,200);assert.equal(updated.body.supporters.ben.position.lat,52.35);
  const stopped=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'ben',sharing:false}),NOW+4000);
  assert.equal(stopped.response.status,200);assert.deepEqual(stopped.body.supporters.ben,{position:null,sharing:false});
  for(const id of ['huiyan','graham','jeff'])assert.deepEqual(stopped.body.supporters[id],original[id]);
  assert.deepEqual((await f.call(publicRequest(),NOW+5000)).body.room.supporters.ben,{position:null,sharing:false});
});

test('supporter identity is a narrow location option and does not widen write access',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const before=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for(const personId of ['emily','crew','',null,{},'graham.position','jeff.position','ben.position']){
    const denied=await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true}),NOW+1000);
    assert.equal(denied.response.status,400);
  }
  for(const body of [{personId:'graham'},{personId:'jeff'},{personId:'huiyan',bib:'133',sharing:true},{personId:'graham',meetup,sharing:true},{personId:'jeff',meetup,sharing:true},{personId:'graham',...checkpoint('complete','point-1')}]){
    assert.equal((await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,body),NOW+1000)).response.status,400);
  }
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true,celebration:'start'}),NOW+1000)).response.status,403);
  assert.equal((await f.call(request('PATCH',null,{personId:'graham',sharing:true}),NOW+1000)).response.status,401);
  assert.equal((await f.call(request('PATCH',PUBLIC_VIEW_TOKEN,{personId:'graham',sharing:true}),NOW+1000)).response.status,404);
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true},'https://elsewhere.test'),NOW+1000)).response.status,403);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(),before);
});

test('checkpoint retries preserve simultaneous independent GPS streams and celebration metadata',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const originalBatch=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async queries=>{
    if(!injected&&queries.some(query=>query.sql.startsWith('UPDATE crew_rooms SET meetup_json = ?'))){
      injected=true;
      const huiyan=await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{sharing:true,position:{lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+2000},celebration:'start'}),NOW+2000);
      assert.equal(huiyan.response.status,200);
      const graham=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true,position:{lat:52.24,lng:-1.13,accuracy:9,recordedAt:NOW+2500}}),NOW+2500);
      assert.equal(graham.response.status,200);
      const jeff=await f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',sharing:true,position:{lat:52.3,lng:-1.1,accuracy:7,recordedAt:NOW+2700}}),NOW+2700);
      assert.equal(jeff.response.status,200);
    }
    return originalBatch(queries);
  };
  const done=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),NOW+1000);
  assert.equal(done.response.status,200);assert(injected);
  assert.equal(done.body.meetup.id,'point-2');
  assert.equal(done.body.checkpointStatuses['point-1'].status,'met');
  assert.equal(done.body.supporters.huiyan.position.lat,52.12);
  assert.equal(done.body.supporters.graham.position.lat,52.24);
  assert.equal(done.body.supporters.jeff.position.lat,52.3);
  assert.equal(done.body.supporters.graham.position.recordedAt,new Date(NOW+2500).toISOString());
  assert(Date.parse(done.body.updatedAt)>NOW+2700,'the checkpoint retry sorts after all three phone commits');
  assert.equal(done.body.supporters.graham.position.updatedAt,new Date(NOW+2500).toISOString());
  assert.equal(done.body.supporters.jeff.position.updatedAt,new Date(NOW+2700).toISOString());
  assert.deepEqual(done.body.releases,[{id:'start',releasedAt:new Date(NOW+2000).toISOString()}]);
  const changed=await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{meetup,celebration:'km-60'}),NOW+3000);
  assert.deepEqual(changed.body.supporters,done.body.supporters,'later atomic plan writes retain every independent phone stream');
  assert.deepEqual((await f.call(publicRequest(),NOW+4000)).body.room.supporters,done.body.supporters);
});

test('expiry and revocation scrub all four supporter streams while expiry retains only safe achievements',async()=>{
  const at=new Date(NOW).toISOString();
  const record={id:'35950:emily:marathon',eventId:35950,runnerId:'emily',bib:'247',milestoneId:'marathon',crossedAt:at,firstSeenBeyondAt:at,recordedAt:at,estimated:true,backfilled:false,evidence:{beforeAt:at,afterAt:at}};
  for(const action of ['read','activate','patch','revoke']){
    const f=await publicFixture(LOCATION_CONFIG);await f.activate();
    for(const personId of ['huiyan','graham','jeff','ben']){
      assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true,position:{lat:52.12,lng:-1.22,accuracy:6,recordedAt:NOW+1000}}),NOW+1000)).response.status,200);
      assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan:{personId,mode:'walking'}}),NOW+1000)).response.status,200);
    }
    f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = json_set(meetup_json, '$.raceAchievements', json(?))").run(JSON.stringify([record]));
    const result=await f.call(action==='read'?publicRequest():action==='activate'?activateLocation():action==='revoke'?request('DELETE',PUBLIC_PUBLISH_TOKEN,{}):request('PATCH',LOCATION_TOKEN,{personId:'graham',sharing:true,position:{lat:52.12,lng:-1.22,accuracy:6,recordedAt:PUBLIC_CONFIG.expiresAt}}),action==='revoke'?NOW+2000:PUBLIC_CONFIG.expiresAt);
    assert.equal(result.response.status,action==='read'||action==='revoke'?200:410);
    const row=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
    for(const key of ['lat','lng','accuracy','position_updated_at','position_recorded_at'])assert.equal(row[key],null);
    assert.equal(row.sharing,0);
    if(action==='revoke')assert.equal(row.meetup_json,null);
    else assert.deepEqual(JSON.parse(row.meetup_json),{raceAchievements:[record]});
    const publicRead=(await f.call(publicRequest(),PUBLIC_CONFIG.expiresAt+1000)).body;
    assert.equal(publicRead.room,null);assert.equal(publicRead.status,'ended');
    assert(!JSON.stringify(publicRead).includes('supporters'));
  }
});

test('each supporter can change their walking or meeting plan without changing any phone location or another plan',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  assert.deepEqual((await f.call(publicRequest())).body.room.supporterPlans,{},'no walking or waiting assignment is invented');
  for(const [i,personId] of ['huiyan','graham','jeff','ben'].entries()){
    const updated=await f.call(request('PATCH',LOCATION_TOKEN,{personId,sharing:true,position:{lat:52.1+i*.01,lng:-1.2,accuracy:6,recordedAt:NOW+1000}}),NOW+1000);
    assert.equal(updated.response.status,200);
  }
  const before=(await f.call(publicRequest(),NOW+2000)).body.room;
  for(const [i,personId] of ['huiyan','graham','jeff','ben'].entries()){
    const changed=await f.call(request('PATCH',i===0?PUBLIC_PUBLISH_TOKEN:LOCATION_TOKEN,{supporterPlan:{personId,mode:i===1?'walking':'meeting'}}),NOW+3000+i);
    assert.equal(changed.response.status,200);
    assert.deepEqual(changed.body.supporters,before.supporters,'plans do not start, stop, move or refresh phones');
  }
  const planned=(await f.call(publicRequest(),NOW+4000)).body.room;
  assert.deepEqual(planned.supporterPlans,{
    huiyan:{mode:'meeting',updatedAt:new Date(NOW+3000).toISOString()},
    graham:{mode:'walking',updatedAt:new Date(NOW+3001).toISOString()},
    jeff:{mode:'meeting',updatedAt:new Date(NOW+3002).toISOString()},
    ben:{mode:'meeting',updatedAt:new Date(NOW+3003).toISOString()},
  });
  const switched=await f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan:{personId:'huiyan',mode:'walking'}}),NOW+5000);
  assert.equal(switched.body.supporterPlans.huiyan.mode,'walking');
  for(const id of ['graham','jeff','ben'])assert.deepEqual(switched.body.supporterPlans[id],planned.supporterPlans[id]);
  assert.deepEqual(switched.body.supporters,before.supporters);
  const visible=(await f.call(publicRequest(),NOW+6000)).body.room;
  assert.deepEqual(visible.supporterPlans,switched.body.supporterPlans,'every unauthenticated viewer sees the shared walking plan');
  assert.deepEqual(visible.supporters,before.supporters);
});

test('supporter plans accept only fixed people and modes as a standalone authorized update',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const before=f.sqlite.prepare('SELECT * FROM crew_rooms').get();
  for(const supporterPlan of [null,{}, {personId:'emily',mode:'walking'},{personId:'jeff.position',mode:'meeting'},{personId:'huiyan',mode:'running'},{personId:'jeff',mode:'walking',lat:52},{personId:'graham',mode:'walking',updatedAt:'tomorrow'}]){
    assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan}),NOW+1000)).response.status,400);
  }
  const supporterPlan={personId:'graham',mode:'walking'};
  for(const extra of [{sharing:true},{personId:'jeff'},{position:{lat:52,lng:-1,accuracy:5,recordedAt:NOW+1000}},{checkpoint:{action:'complete',pointId:'point-1'}},{celebration:'km-50'}]){
    assert.equal((await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{supporterPlan,...extra}),NOW+1000)).response.status,400);
  }
  assert.equal((await f.call(request('PATCH',null,{supporterPlan}),NOW+1000)).response.status,401);
  assert.equal((await f.call(request('PATCH',PUBLIC_VIEW_TOKEN,{supporterPlan}),NOW+1000)).response.status,404);
  assert.equal((await f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan},'https://elsewhere.test'),NOW+1000)).response.status,403);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM crew_rooms').get(),before);
});

test('checkpoint retry preserves concurrent supporter plans, independent GPS and poster releases',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  const originalBatch=f.db.batch.bind(f.db);let injected=false;
  f.db.batch=async queries=>{
    if(!injected&&queries.some(query=>query.sql.startsWith('UPDATE crew_rooms SET meetup_json = ?'))){
      injected=true;
      const responses=await Promise.all([
        f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan:{personId:'huiyan',mode:'walking'}}),NOW+2000),
        f.call(request('PATCH',LOCATION_TOKEN,{supporterPlan:{personId:'graham',mode:'meeting'}}),NOW+2001),
        f.call(request('PATCH',LOCATION_TOKEN,{personId:'jeff',sharing:true,position:{lat:52.2,lng:-1.1,accuracy:7,recordedAt:NOW+2002}}),NOW+2002),
        f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{celebration:'km-50'}),NOW+2003),
      ]);
      for(const result of responses)assert.equal(result.response.status,200);
    }
    return originalBatch(queries);
  };
  const done=await f.call(request('PATCH',LOCATION_TOKEN,checkpoint('complete','point-1')),NOW+1000);
  assert(injected);assert.equal(done.response.status,200);
  assert.equal(done.body.meetup.id,'point-2');
  assert.equal(done.body.supporterPlans.huiyan.mode,'walking');
  assert.equal(done.body.supporterPlans.graham.mode,'meeting');
  assert.equal(done.body.supporterPlans.jeff,undefined);
  assert.equal(done.body.supporters.jeff.position.updatedAt,new Date(NOW+2002).toISOString());
  assert.deepEqual(done.body.releases,[{id:'km-50',releasedAt:new Date(NOW+2003).toISOString()}]);
  const release=await f.call(request('PATCH',PUBLIC_PUBLISH_TOKEN,{celebration:'km-100'}),NOW+3000);
  assert.deepEqual(release.body.releases.map(p=>p.id),['km-50','km-100']);
  assert.deepEqual(release.body.supporterPlans,done.body.supporterPlans);
});

test('public supporter plans whitelist known people, valid modes and timestamps without leaking stored extra fields',async()=>{
  const f=await publicFixture(LOCATION_CONFIG);await f.activate();
  f.sqlite.prepare("UPDATE crew_rooms SET meetup_json = ?").run(JSON.stringify({supporterPlans:{
    huiyan:{mode:'walking',updatedAt:new Date(NOW).toISOString(),secret:'private'},
    graham:{mode:'other',updatedAt:new Date(NOW).toISOString()},
    jeff:{mode:'meeting',updatedAt:'bad-time'},
    unknown:{mode:'walking',updatedAt:new Date(NOW).toISOString()},
  }}));
  assert.deepEqual((await f.call(publicRequest())).body.room.supporterPlans,{huiyan:{mode:'walking',updatedAt:new Date(NOW).toISOString()}});
});
