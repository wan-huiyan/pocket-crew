import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/celebrations.js', import.meta.url), 'utf8');
const ids = ['start', 'marathon', 'km-50', 'km-60', 'km-70', 'km-80', 'km-90', 'km-100', 'gold', 'km-110', 'km-120', 'km-123'];
function element() {
  const handlers = new Map(), classes = new Set();
  return { open: false, hidden: false, textContent: '', style: {}, classList: { add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, contains(name) { return classes.has(name); } },
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeAttribute(name) { delete this[name]; },
    replaceChildren() {}, append() {}, showCount: 0,
    showModal() { this.open = true; this.showCount++; },
    close() { this.open = false; handlers.get('close')?.(); },
    click() { handlers.get('click')?.({}); }
  };
}
function load({ releases = [], mode = 'runner', storage = new Map(), acknowledged = new Set(), room = null } = {}) {
  const elements = new Map(), timers = new Map();
  const get = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const state = { mode, unlocked: {} }, calls = { persist: 0, render: 0, release: 0, poster: [], paths: [], acknowledged: [] };
  const listeners = new Map(), docListeners = new Map();
  const context = {
    console, Date, Set, Number,
    state, stops: ids.map(id => ({ id, routeKm: id === 'start' ? 0 : id === 'marathon' ? 42.195 : id === 'gold' ? 106 : Number(id.slice(3)) })),
    chapter: stop => ({ title: stop.id, cheer: 'Cheer ' + stop.id }),
    posterPath(stop) { calls.paths.push(stop.id); return state.unlocked[stop.id] ? 'assets/surprises/opaque-' + stop.id + '.webp' : ''; },
    document: { hidden: false, querySelector: get, createElement: element, addEventListener(type, handler) { docListeners.set(type, handler); } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: true }), setTimeout(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    persist() { calls.persist++; }, renderPosters() { calls.render++; }, syncRevealedCache() {}, notify() {}, switchTab() {}, showPoster(id) { calls.poster.push(id); }, confirm: () => true,
    window: {
      addEventListener(type, handler) { listeners.set(type, handler); },
      liveGuide: {
        getSnapshot: () => ({ room: room || { joined: true, owner: mode === 'supporter', loaded: true }, releases }),
        pendingReleases: () => releases.filter(r => !acknowledged.has(r.id + r.releasedAt)),
        acknowledgeCelebration(id, releasedAt) { acknowledged.add(id + releasedAt); calls.acknowledged.push({ id, releasedAt }); },
        async releaseCelebration() { calls.release++; return { ok: false }; }
      }
    }
  };
  vm.runInNewContext(source, context, { filename: 'celebrations.js' });
  return { context, state, calls, get, storage, timers, acknowledged, api: context.window.crowCelebrations, emit: type => listeners.get(type)?.(),
    clickReplay(id) { docListeners.get('click')?.({ target: { closest(selector) { return selector === '[data-replay-cheer]' ? { dataset: { replayCheer: id } } : null; } } }); },
    runTimer(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); } }
  };
}

test('an anonymous viewer sees the actual released poster and the raw ISO is acknowledged', () => {
  const releasedAt = '2026-11-14T10:00:00.000Z';
  const f = load({ releases: [{ id: 'km-50', releasedAt }], room: { joined: false, loaded: true, owner: false } });
  assert.equal(f.get('#cheer-dialog').open, true);
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 50 km!');
  assert.equal(f.state.unlocked['km-50'], Date.parse(releasedAt));
  assert.equal(f.get('#cheer-poster-frame').hidden, false);
  assert.equal(f.get('#cheer-poster').src, 'assets/surprises/opaque-km-50.webp');
  assert.equal(f.get('#cheer-dialog').classList.contains('has-poster'), true);
  assert.deepEqual(f.calls.acknowledged, [{ id: 'km-50', releasedAt }]);
  assert.equal(f.calls.release, 0);
  assert.deepEqual(f.calls.paths, ['km-50'], 'future poster images are never requested');
  assert.match(f.get('#cheer-saved-note').textContent, /Saved in Moments & milestones/);
});

test('a legitimate release waits for the intro, keeps its history, and plays once afterward', () => {
  const releases = [];
  const f = load({ releases });
  let blocking = true;
  f.context.window.guideIntro = { isBlocking: () => blocking };
  const release = { id: 'km-60', releasedAt: '2026-11-14T10:00:00.000Z' };
  releases.push(release);
  f.emit('celebrationrelease');
  assert.equal(f.state.unlocked['km-60'], Date.parse(release.releasedAt), 'released history is retained during the intro');
  assert.equal(f.state.unlocked['km-70'], undefined, 'future moments remain unreleased');
  assert.equal(f.calls.persist, 1);
  assert.equal(f.get('#cheer-dialog').showCount, 0, 'a top-layer dialog must not interrupt the intro');
  assert.deepEqual(f.calls.acknowledged, []);
  assert.equal(f.storage.has('crow-seen-celebrations-v2'), false, 'the unseen cheer is still pending');
  blocking = false;
  f.api.flushPending();
  assert.equal(f.get('#cheer-dialog').showCount, 1);
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 60 km!');
  assert.deepEqual(f.calls.acknowledged, [release]);
  f.get('#close-cheer').click();
  f.emit('liveupdate'); f.api.flushPending();
  assert.equal(f.get('#cheer-dialog').showCount, 1);
  assert.deepEqual(f.calls.acknowledged, [release]);
  assert.equal(f.calls.release, 0, 'displaying an existing release never creates a new one');
});

test('repeated updates and reload do not replay a displayed release', () => {
  const releases = [{ id: 'km-60', releasedAt: '2026-11-14T10:00:00.000Z' }];
  const f = load({ releases });
  f.get('#close-cheer').click();
  f.emit('liveupdate'); f.api.flushPending();
  assert.equal(f.get('#cheer-dialog').showCount, 1);
  const reloaded = load({ releases, storage: f.storage });
  assert.equal(reloaded.get('#cheer-dialog').showCount, 0);
  assert.equal(reloaded.state.unlocked['km-60'], Date.parse(releases[0].releasedAt));
});

test('joining later shows the latest cheer once and keeps every earlier picture available', () => {
  const releases = [
    { id: 'km-50', releasedAt: '2026-11-14T09:00:00.000Z' },
    { id: 'km-60', releasedAt: '2026-11-14T10:00:00.000Z' },
    { id: 'km-70', releasedAt: '2026-11-14T11:00:00.000Z' }
  ];
  const f = load({ releases });
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 70 km!');
  for (const release of releases) assert(f.state.unlocked[release.id]);
  assert.equal(f.calls.acknowledged.length, 3);
  f.get('#close-cheer').click(); f.emit('liveupdate');
  assert.equal(f.get('#cheer-dialog').showCount, 1);
  f.clickReplay('km-50');
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 50 km!');
  assert.equal(f.get('#cheer-poster').src, 'assets/surprises/opaque-km-50.webp');
  assert.equal(f.calls.release, 0);
});

test('same-time backfilled releases preserve every poster and open only the furthest moment', () => {
  const releasedAt = '2026-11-14T14:00:00.000Z';
  const releases = ['km-50', 'km-100', 'km-60'].map(id => ({ id, releasedAt }));
  const f = load({ releases });
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 100 km!');
  assert.deepEqual(Object.keys(f.state.unlocked).sort(), ['km-100', 'km-50', 'km-60']);
  assert.equal(f.calls.acknowledged.length, 3);
  f.get('#close-cheer').click(); f.emit('liveupdate');
  assert.equal(f.get('#cheer-dialog').showCount, 1);
});

test('a different new milestone with an equal timestamp is not lost behind a global time cursor', () => {
  const releasedAt = '2026-11-14T14:00:00.000Z';
  const releases = [{ id: 'km-50', releasedAt }], f = load({ releases });
  f.get('#close-cheer').click();
  releases.push({ id: 'km-60', releasedAt });f.emit('liveupdate');
  assert.equal(f.get('#cheer-title').textContent, 'Emily, 60 km!');
  assert.equal(f.get('#cheer-dialog').showCount, 2);
  assert.equal(f.calls.acknowledged.length, 2);
});

test('shared history remains replayable for everyone after location sharing ends', () => {
  const release = { id: 'km-100', releasedAt: '2026-11-14T14:00:00.000Z' };
  const f = load({ releases: [release], room: { joined: false, loaded: true, expired: true, owner: false } });
  assert(f.state.unlocked['km-100']);
  f.get('#close-cheer').click();f.clickReplay('km-100');
  assert.equal(f.get('#cheer-poster-frame').hidden, false);
  f.get('#cheer-poster-frame').click();
  assert.equal(f.get('#cheer-dialog').open, false);
  assert.deepEqual(f.calls.poster, ['km-100']);
});

test('the auto celebration returns to the map and remains immediately dismissible with reduced motion', () => {
  const release = { id: 'km-80', releasedAt: '2026-11-14T14:00:00.000Z' };
  const f = load({ releases: [release] });
  f.runTimer(14000);
  assert.equal(f.get('#cheer-dialog').open, false);
  assert.equal(f.get('#cheer-poster').src, undefined);
  f.clickReplay('km-80');assert.equal(f.get('#cheer-dialog').open, true);
  f.get('#close-cheer').click();assert.equal(f.get('#cheer-dialog').open, false);
  assert.equal(f.timers.size, 0);
});

test('supporter animation previews do not unlock, request future poster art, or release anything', () => {
  const f = load({ mode: 'supporter' });
  f.api.preview('km-90');
  assert.equal(f.get('#cheer-dialog').open, true);
  assert.equal(f.get('#cheer-preview-note').hidden, false);
  assert.equal(f.get('#cheer-open-poster').hidden, true);
  assert.equal(f.get('#cheer-poster-frame').hidden, true);
  assert.deepEqual(f.state.unlocked, {});
  assert.deepEqual(f.calls.paths, []);
  assert.equal(f.calls.persist, 0);
  assert.equal(f.calls.release, 0);
  const runner = load();
  runner.api.preview('km-90');runner.clickReplay('km-90');
  assert.equal(runner.get('#cheer-dialog').showCount, 0);
});

test('the poster source is initially absent and all milestone manifest assets exist', () => {
  const html = readFileSync(new URL('../guide/index.html', import.meta.url), 'utf8');
  assert.match(html, /<img id="cheer-poster" alt="" width="600" height="900">/);
  const manifest = JSON.parse(readFileSync(new URL('../public/data/poster-manifest.json', import.meta.url), 'utf8'));
  const guide = JSON.parse(readFileSync(new URL('../public/data/guide-data.json', import.meta.url), 'utf8'));
  for (const id of ids.filter(id => id !== 'start')) assert(guide.stops.some(stop => stop.id === id), 'runtime stop exists for ' + id);
  assert.equal(guide.stops.find(stop => stop.id === 'marathon').routeKm, 42.195);
  for (const id of ids) for (const key of ['preview', 'download']) assert(existsSync(new URL('../public/' + manifest[id][key], import.meta.url)), id + ' ' + key);
  for (const id of ['marathon']) { assert.equal(manifest[id].width, 1024);assert.equal(manifest[id].height, 1536); }
  assert.equal(manifest['km-50'].width, 1024);
  assert.equal(manifest['km-50'].height, 1536);
  for (const id of ['km-60', 'km-70']) { assert.equal(manifest[id].width, 1200);assert.equal(manifest[id].height, 1800); }
  for (const id of ['km-80', 'km-90', 'km-100', 'gold', 'km-110', 'km-120', 'km-123']) {
    assert.equal(manifest[id].width, 1024);
    assert.equal(manifest[id].height, 1536);
    assert.match(manifest[id].preview, /emily-crew-[\w-]+-2026-walk-v3\.webp$/);
  }
  assert.equal(manifest['km-50'].preview, 'assets/surprises/c239a8f107d452a5686f9e31.webp');
  assert.equal(manifest['km-60'].preview, 'assets/surprises/77d6f60854acf41fa503a91b.webp');
  assert.equal(manifest['km-70'].preview, 'assets/surprises/a756787213d1fc2b7c955c60.webp');
});


test('gold celebrates an estimated boundary without presenting an official award', () => {
  const f = load({ releases: [{ id: 'gold', releasedAt: '2026-11-14T22:00:00.000Z' }] });
  assert.equal(f.get('#cheer-title').textContent, 'Emily · gold-ring crossing!');
  assert.match(f.get('#cheer-subtitle').textContent, /estimated gold-ring crossing/);
  assert.match(f.get('#cheer-subtitle').textContent, /official tracker confirms the award/);
  assert.equal(f.get('#cheer-poster').src, 'assets/surprises/opaque-gold.webp');
});


test('the marathon poster celebrates both siblings at 42.195 km and is acknowledged only once', () => {
  const releasedAt = '2026-11-14T10:00:00.000Z', release = { id: 'marathon', releasedAt };
  const f = load({ releases: [release], room: { joined: false, loaded: true, owner: false } });
  assert.equal(f.get('#cheer-title').textContent, 'Emily & Jeff · a marathon!');
  assert.equal(f.get('#cheer-eyebrow').textContent, 'Emily & Jeff · 42.195 km each');
  assert.match(f.get('#cheer-subtitle').textContent, /42\.195 kilometres each/);
  assert.equal(f.get('#cheer-poster').src, 'assets/surprises/opaque-marathon.webp');
  assert.match(f.get('#cheer-poster').alt, /Emily and Jeff’s marathon/);
  assert.deepEqual(f.calls.acknowledged, [release]);
  assert.equal(f.state.unlocked.marathon, Date.parse(releasedAt));
  f.get('#close-cheer').click();f.emit('liveupdate');f.api.flushPending();
  assert.equal(f.get('#cheer-dialog').showCount, 1);
  f.clickReplay('marathon');
  assert.equal(f.get('#cheer-dialog').showCount, 2);
  assert.equal(f.get('#cheer-title').textContent, 'Emily & Jeff · a marathon!');
  assert.deepEqual(f.calls.acknowledged, [release], 'manual replay does not acknowledge or publish a new release');
  assert.equal(f.calls.release, 0);
  const reloaded = load({ releases: [release], storage: f.storage });
  assert.equal(reloaded.get('#cheer-dialog').showCount, 0);
  assert(reloaded.state.unlocked.marathon);
});
