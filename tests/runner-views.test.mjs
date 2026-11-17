import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Load the real view functions without the unrelated network bootstrap.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\nboot\(\);\s*$/, '\n');
const milestoneSource = readFileSync(new URL('../public/race-milestones.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../guide/index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../public/data/poster-manifest.json', import.meta.url), 'utf8'));
const RELEASED_AT = '2026-11-14T10:00:00.000Z';
function crossing(milestoneId, runnerId = 'emily') {
  return { id: `35950:${runnerId}:${milestoneId}`, eventId: 35950, runnerId, milestoneId, crossedAt: '2026-11-14T09:55:00.000Z', firstSeenBeyondAt: '2026-11-14T09:56:00.000Z' };
}
function load(pathname = '/') {
  const elements = new Map(), navigations = [], refreshes = [];
  let snapshot = { room: { owner: false }, releases: [], achievements: { records: [], persisted: true } };
  const element = id => ({ id, hidden: false, innerHTML: '', textContent: '', isConnected: false, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, focus() {} });
  const q = selector => { if (!elements.has(selector)) elements.set(selector, element(selector.replace(/^#/, ''))); return elements.get(selector); };
  const panels = ['now', 'milestones', 'charging', 'parkrun', 'more', 'allstops', 'facilities'].map(id => q('#panel-' + id));
  const crewControls = [q('#crew-controls')];
  const context = {
    console, Date, Set, Number, testPosters: manifest,
    localStorage: { getItem: () => null, setItem() {} }, navigator: {},
    document: { querySelector: q, querySelectorAll: selector => selector === '.tab-panel' ? panels : selector === '#panel-milestones .crew-controls-only' ? crewControls : [], activeElement: element('none') },
    location: { pathname, search: '' },
    window: { dispatchEvent() {}, scrollTo() {}, liveGuide: { getSnapshot: () => snapshot }, raceMoments: { refresh(value) { refreshes.push(value); }, recordText() { return '~09:55 crossed'; } } },
    history: { replaceState(_state, _title, url) { navigations.push(url); } }, requestAnimationFrame: fn => fn(),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  };
  vm.runInNewContext(milestoneSource, context, { filename: 'race-milestones.js' });
  vm.runInNewContext(source + `
    globalThis.viewTest = {
      configure(unlocked, mode='runner') {
        state.mode=mode; state.unlocked=unlocked;
        stops=[{id:'start',routeKm:0},{id:'marathon',routeKm:42.195},...['50','60','70','80','90','100'].map(n=>({id:'km-'+n,routeKm:Number(n)})),{id:'gold',routeKm:106}];
        posterFiles=testPosters;
      },
      renderPosters, switchTab, tab:()=>currentTab
    };`, context, { filename: 'app.js' });
  return { q, api: context.viewTest, navigations, window: context.window, refreshes, setSnapshot(value) { snapshot = value; } };
}

test('the menu has one visible Moments & milestones entry and one canonical sheet', () => {
  const menu = html.match(/<section id="panel-more"[\s\S]*?<\/section>/)?.[0];
  assert(menu);
  assert.equal((menu.match(/data-tab-target="milestones"/g) || []).length, 1);
  assert.match(menu, /<button id="revealed-moments-link" data-tab-target="milestones">/);
  assert.match(menu, /Moments &amp; milestones/);
  assert.doesNotMatch(menu, /data-tab-target="posters"|Our happy moments|Race milestones/);
  assert.equal((html.match(/id="panel-milestones"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="panel-posters"/);
});

test('the combined view opens before any poster is released, without exposing future posters', () => {
  const f = load(); f.api.configure({}); f.api.renderPosters();
  assert.equal(f.q('#poster-grid').innerHTML, '');
  assert.equal(f.q('#poster-grid').hidden, true);
  assert.equal(f.q('#crew-poster-grid').innerHTML, '');
  assert.equal(f.q('#crew-controls').hidden, true);
  assert.equal(f.q('#revealed-moments-link').hidden, false);
  assert.equal(f.q('#moments-title').textContent, 'Moments & milestones');
  f.api.switchTab('milestones');
  assert.equal(f.api.tab(), 'milestones');
  assert.equal(f.q('#panel-milestones').hidden, false);
  assert.equal(f.q('#sheet-backdrop').hidden, false);
  assert.equal(f.refreshes.length, 1, 'crossing and ETA rendering is refreshed even when the poster gallery is empty');
});

test('legacy posters, journey and moments links open the same combined sheet for runners and supporters', () => {
  for (const mode of ['runner', 'supporter']) {
    const f = load(); f.api.configure({}, mode);
    for (const tab of ['posters', 'journey', 'moments', 'milestones']) {
      f.api.switchTab(tab);
      assert.equal(f.api.tab(), 'milestones');
      assert.equal(f.q('#panel-milestones').hidden, false);
      assert.equal(f.navigations.at(-1), '/#milestones');
    }
  }
});

test('choosing supporter view alone never exposes future posters or crew release controls', () => {
  const f = load(); f.api.configure({}, 'supporter'); f.api.renderPosters();
  assert.equal(f.q('#poster-grid').innerHTML, '');
  assert.equal(f.q('#crew-poster-grid').innerHTML, '');
  assert.equal(f.q('#crew-controls').hidden, true);
  f.api.switchTab('posters');
  assert.equal(f.api.tab(), 'milestones');
});

test('a shared milestone poster belongs with its crossing ledger, rather than a duplicate gallery tile', () => {
  const f = load(), unlocked = { 'km-60': Date.parse(RELEASED_AT), marathon: Date.parse(RELEASED_AT) };
  const snapshot = { room: { owner: false }, achievements: { persisted: true, records: [crossing('km-60'), crossing('marathon'), crossing('marathon', 'jeff')] }, releases: [{ id: 'km-60', releasedAt: RELEASED_AT }, { id: 'marathon', releasedAt: RELEASED_AT }] };
  f.setSnapshot(snapshot); f.api.configure(unlocked); f.api.renderPosters();
  assert.equal(f.q('#poster-grid').innerHTML, '');
  assert.equal(f.q('#poster-grid').hidden, true);
  assert.equal(f.q('#crew-poster-grid').innerHTML, '');
  assert.equal(f.refreshes.length, 1);
  assert.equal(f.refreshes[0], snapshot, 'the combined ledger receives both crossing records and poster releases');
});

test('the send-off and a released moment without a shared ledger remain available without future teasers', () => {
  const f = load();f.api.configure({ start: Date.parse(RELEASED_AT), 'km-60': Date.parse(RELEASED_AT) });
  f.setSnapshot({ room: { owner: false }, achievements: { persisted: true, records: [] }, releases: [{ id: 'start', releasedAt: RELEASED_AT }, { id: 'km-60', releasedAt: RELEASED_AT }] });
  f.api.renderPosters();
  const rendered = f.q('#poster-grid').innerHTML;
  assert.match(rendered, /data-replay-cheer="start"/);
  assert.match(rendered, /data-replay-cheer="km-60"/);
  assert.doesNotMatch(rendered, /Potterspury|Milton Keynes|Dunstable|data-reveal|km-50|km-70|km-80|km-90|km-100/);
  assert.equal(f.q('#poster-grid').hidden, false);
  f.api.switchTab('posters');assert.equal(f.api.tab(), 'milestones');
  f.api.switchTab('charging');assert.equal(f.api.tab(), 'now');
});

test('crew-only future controls stay in their own section and do not duplicate earned posters', () => {
  const f = load(); f.api.configure({ 'km-60': Date.parse(RELEASED_AT) }, 'supporter');
  f.setSnapshot({ room: { owner: true }, achievements: { persisted: true, records: [crossing('km-60')] }, releases: [{ id: 'km-60', releasedAt: RELEASED_AT }] });
  f.api.renderPosters();
  assert.equal(f.q('#crew-controls').hidden, false);
  assert.equal(f.q('#poster-grid').innerHTML, '');
  const controls = f.q('#crew-poster-grid').innerHTML;
  assert.match(controls, /data-reveal="marathon"/);
  assert.match(controls, /data-reveal="km-100"/);
  assert.doesNotMatch(controls, /data-reveal="km-60"|data-replay-cheer="km-60"|<img/);
});

test('sheet navigation keeps the poster URL when its asset base points to the original root', () => {
  const f = load('/poster/');f.api.configure({});
  f.api.switchTab('more');f.api.switchTab('posters');f.api.switchTab('now');
  assert.deepEqual(f.navigations, ['/poster/#more', '/poster/#milestones', '/poster/#now']);
});

test('runner navigation cannot open the meeting planner while supporters retain it', () => {
  const f = load();f.api.configure({});
  f.api.switchTab('allstops');
  assert.equal(f.api.tab(), 'now');
  assert.equal(f.q('#panel-allstops').hidden, true);
  f.api.configure({}, 'supporter');f.api.switchTab('allstops');
  assert.equal(f.api.tab(), 'allstops');
  assert.equal(f.q('#panel-allstops').hidden, false);
});

test('charging and old crew links open the shared EV directory only in the supporter view', () => {
  const f = load(), opens = [];
  f.window.raceMap = { showAmenities(filter) { opens.push(filter);f.api.switchTab('facilities'); } };
  f.api.configure({}, 'supporter');
  for (const tab of ['charging', 'crew']) {
    f.api.switchTab(tab);
    assert.equal(f.api.tab(), 'facilities');
    assert.equal(f.q('#panel-charging').hidden, true);
    assert.equal(f.q('#panel-facilities').hidden, false);
  }
  assert.deepEqual(opens, ['charger', 'charger']);
  f.api.configure({}, 'runner');f.api.switchTab('charging');
  assert.equal(f.api.tab(), 'now');
  assert.equal(opens.length, 2);
});
