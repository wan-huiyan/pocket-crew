import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const hostSource = readFileSync(new URL('../public/intro-host.js', import.meta.url), 'utf8')
  .replace("import('/intro/great-escape-intro.js')", 'loadIntro()');
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of [...listeners.get(type) || []]) fn(event); },
    listenerCount() { return [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0); }
  };
}
function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) { const key = ++id; tasks.set(key, { at: now + delay, fn }); return key; },
    clearTimeout(key) { tasks.delete(key); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = target;
    },
    pending: () => tasks.size
  };
}
function loadHost({ remembered = false, view = 'now' } = {}) {
  const loading = deferred(), time = clock(), window = events(), replayButton = { ...events(), hidden: true };
  let overlay = false, currentView = view;
  const calls = { imports: 0, focus: 0, navigations: [], flushes: [], storage: 0, geolocation: 0 };
  const hostState = { mode: 'supporter', meeting: 'point-4.2', bib: '123', crewRoom: 'existing-room', locationPermission: 'not-requested', map: { zoom: 14, centre: [52, -1] } };
  const before = JSON.stringify(hostState), controllers = [];
  const heading = { focus() { calls.focus++; } };
  const document = {
    getElementById(id) { return id === 'replay-intro' ? replayButton : id === 'race-map' ? hostState.map : null; },
    querySelector(selector) {
      if (selector === '[data-great-escape-intro]') return overlay ? {} : null;
      if (selector === '#panel-now:not([hidden])[data-map-heading]') return currentView === 'now' ? heading : null;
      return null;
    }
  };
  const module = {
    mountGreatEscapeIntro(options) {
      const bypass = remembered && !options.force;
      overlay = !bypass;
      const controller = {
        options, replays: 0, destroys: 0, active: !bypass,
        replay() { this.replays++; this.active = true; overlay = true; return true; },
        destroy() { this.destroys++; this.active = false; overlay = false; },
        finish(reason = 'complete') { if (!this.active) return; this.active = false; overlay = false; options.onComplete(reason); }
      };
      controllers.push(controller);
      if (bypass) queueMicrotask(() => options.onComplete('remembered'));
      return controller;
    }
  };
  window.crowCelebrations = { flushPending() { calls.flushes.push({ overlay, blocking: window.guideIntro.isBlocking() }); } };
  vm.runInNewContext(hostSource, {
    window, document, console: { info() {} }, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    loadIntro() { calls.imports++; return loading.promise; },
    switchTab(tab) { currentView = tab; calls.navigations.push(tab); },
    state: hostState,
    localStorage: { setItem() { calls.storage++; } },
    navigator: { geolocation: { getCurrentPosition() { calls.geolocation++; } } }
  }, { filename: 'intro-host.js' });
  return { window, time, replayButton, calls, controllers, module, loading, hostState, before,
    api: window.guideIntro, hasOverlay: () => overlay,
    async ready() { loading.resolve(module); await settle(); } };
}

test('first mount preserves the real host state and leaves navigation and permissions alone', async () => {
  const f = loadHost({ view: 'live' });
  assert.equal(f.api.isBlocking(), true, 'celebrations wait while the intro module loads');
  await f.ready();
  assert.equal(f.controllers.length, 1);
  assert.equal(f.controllers[0].options.assetBase, '/assets/');
  assert.equal(f.replayButton.hidden, false);
  assert.equal(f.hasOverlay(), true);
  assert.deepEqual(f.calls.navigations, []);
  assert.equal(JSON.stringify(f.hostState), f.before);
  assert.equal(f.calls.storage + f.calls.geolocation, 0);
  assert.equal(f.calls.focus, 0);
});

test('pending cheers are flushed only after cleanup, without moving an open host drawer', async () => {
  const f = loadHost({ view: 'live' }); await f.ready();
  assert.deepEqual(f.calls.flushes, []);
  f.controllers[0].finish('skipped');
  assert.deepEqual(f.calls.flushes, [{ overlay: false, blocking: false }]);
  assert.equal(f.calls.focus, 0, 'a hidden map heading must not steal drawer focus');
  assert.deepEqual(f.calls.navigations, []);
});

test('Replay returns to the map and reuses the existing controller', async () => {
  const f = loadHost({ view: 'more' }); await f.ready();
  f.controllers[0].finish();
  f.replayButton.emit('click');
  assert.deepEqual(f.calls.navigations, ['now']);
  assert.equal(f.controllers.length, 1);
  assert.equal(f.controllers[0].replays, 1);
  assert.equal(f.hasOverlay(), true);
  f.controllers[0].finish('skipped');
  assert.equal(f.calls.focus, 1);
  assert.equal(JSON.stringify(f.hostState), f.before);
});

test('remembered completion flushes pending cheers without stealing focus', async () => {
  const f = loadHost({ remembered: true }); await f.ready();
  assert.equal(f.hasOverlay(), false);
  assert.equal(f.api.isBlocking(), false);
  assert.equal(f.calls.focus, 0);
  assert.deepEqual(f.calls.navigations, []);
  assert.deepEqual(f.calls.flushes, [{ overlay: false, blocking: false }]);
});

test('an import failure leaves the guide usable and clears its deadline', async () => {
  const f = loadHost(); f.loading.reject(new Error('network unavailable')); await settle();
  assert.equal(f.api.isBlocking(), false);
  assert.equal(f.controllers.length, 0);
  assert.equal(f.time.pending(), 0);
  assert.deepEqual(f.calls.flushes, [{ overlay: false, blocking: false }]);
  assert.deepEqual(f.calls.navigations, []);
});

test('a slow module fails open at 4.5 seconds and cannot surprise the user with a late automatic intro', async () => {
  const f = loadHost(); f.time.advance(4499);
  assert.equal(f.api.isBlocking(), true);
  f.time.advance(1);
  assert.equal(f.api.isBlocking(), false);
  assert.deepEqual(f.calls.flushes, [{ overlay: false, blocking: false }]);
  await f.ready();
  assert.equal(f.controllers.length, 0, 'a late import must not mount an automatic overlay');
  assert.equal(f.replayButton.hidden, false, 'the now-available intro can still be explicitly replayed');
  f.replayButton.emit('click');
  assert.equal(f.controllers.length, 1);
  assert.equal(f.controllers[0].options.force, true);
  assert.equal(f.hasOverlay(), true);
});

test('a persisted history navigation cleans up playback and creates a usable controller on return', async () => {
  const f = loadHost(); await f.ready();
  const first = f.controllers[0];
  f.window.emit('pagehide', { persisted: true });
  assert.equal(first.destroys, 1);
  assert.equal(f.hasOverlay(), false);
  f.window.emit('pageshow', { persisted: true }); await settle();
  assert.equal(f.controllers.length, 2);
  assert.equal(f.calls.imports, 1, 'the already loaded module can be reused');
  assert.equal(f.hasOverlay(), true);
  f.controllers[1].finish();
  f.replayButton.emit('click');
  assert.equal(f.controllers[1].replays, 1);
});

test('destroy removes listeners, cancels its deadline and prevents a pending import from mounting', async () => {
  const f = loadHost(); f.api.destroy();
  assert.equal(f.time.pending(), 0);
  assert.equal(f.replayButton.listenerCount(), 0);
  assert.equal(f.window.listenerCount(), 0);
  assert.equal(f.api.isBlocking(), false);
  await f.ready();
  f.replayButton.emit('click'); f.window.emit('pageshow', { persisted: true });
  assert.equal(f.controllers.length, 0);
  assert.equal(f.api.replay(), false);
});

test('a normal page exit destroys active playback and cannot resurrect it', async () => {
  const f = loadHost(); await f.ready();
  f.window.emit('pagehide', { persisted: false });
  assert.equal(f.controllers[0].destroys, 1);
  assert.equal(f.hasOverlay(), false);
  assert.equal(f.window.listenerCount(), 0);
  f.window.emit('pageshow', { persisted: true });
  assert.equal(f.controllers.length, 1);
});

test('enabling reduced motion after Pause restores the pending asset deadline and safe focus', () => {
  const time = clock(), media = { ...events(), matches: false }, completions = [];
  let document, shadow, seenWrites = 0;
  class Element {
    constructor() { Object.assign(this, events()); this.children = []; this.dataset = {}; this.style = {}; this.inert = false; this.isConnected = true; }
    append(child) { child.parentElement = this; this.children.push(child); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.isConnected = false; }
    setAttribute() {}
    focus() { if (this.shadowOwner) this.shadowOwner.activeElement = this; else document.activeElement = this; }
    getClientRects() { return [{}]; }
    querySelector(selector) { this.parts ||= new Map(); if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
    attachShadow() {
      shadow = new Element(); shadow.activeElement = null;
      shadow.querySelector = selector => {
        shadow.parts ||= new Map();
        if (!shadow.parts.has(selector)) { const el = new Element(); el.shadowOwner = shadow; shadow.parts.set(selector, el); }
        return shadow.parts.get(selector);
      };
      shadow.querySelectorAll = selector => selector === '.crow-art' ? [] : ['.skip','.pause','.open'].map(s => shadow.querySelector(s));
      return shadow;
    }
  }
  const body = new Element(), background = new Element(); body.append(background);
  document = { ...events(), body, hidden: false, activeElement: background, createElement: () => new Element() };
  const componentSource = readFileSync(new URL('../public/intro/great-escape-intro.js', import.meta.url), 'utf8')
    .replaceAll('export const ', 'const ').replace('export function mountGreatEscapeIntro', 'function mountGreatEscapeIntro')
    .replace('export default mountGreatEscapeIntro;', 'globalThis.mountIntro = mountGreatEscapeIntro;')
    .replaceAll('import.meta.url', JSON.stringify('https://guide.example/intro/great-escape-intro.js'));
  const context = {
    document, HTMLElement: Element, URL, Set, console, performance: { now: time.now },
    window: { matchMedia: () => media, setTimeout: time.setTimeout },
    localStorage: { getItem: () => null, setItem() { seenWrites++; } },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, queueMicrotask
  };
  vm.runInNewContext(componentSource, context, { filename: 'great-escape-intro.js' });
  context.mountIntro({ assetBase: '/assets/', onComplete: reason => completions.push(reason) });
  assert.equal(background.inert, true);
  time.advance(1000);
  const pause = shadow.querySelector('.pause'); pause.focus(); pause.emit('click');
  time.advance(9000);
  assert.deepEqual(completions, [], 'a manually paused download deadline does not elapse');
  media.matches = true; media.emit('change', { matches: true });
  assert.equal(shadow.activeElement, shadow.querySelector('.skip'), 'focus leaves the now-hidden pause button');
  time.advance(3499); assert.deepEqual(completions, []);
  time.advance(1);
  assert.deepEqual(completions, ['asset-timeout']);
  assert.equal(seenWrites, 0, 'failed assets remain eligible for a future intro attempt');
  assert.equal(background.inert, false);
  assert.equal(body.children.length, 1, 'failed assets remove the overlay');
});
