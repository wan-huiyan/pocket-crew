/**
 * Emily & Jeff · The Great Escape — isolated, dependency-free introduction.
 *
 * mountGreatEscapeIntro({ host, assetBase, onComplete, force, remember,
 *                        reducedMotion }) → { replay, skip, destroy }
 *
 * Mount the real map first. This component owns only its temporary overlay;
 * it does not request location, load a map, or know any runner information.
 * Completion reasons: complete, skipped, reduced-motion, remembered,
 * asset-error, asset-timeout. One callback is emitted per playback.
 */

export const GREAT_ESCAPE_INTRO_DURATION = 8800;
export const GREAT_ESCAPE_INTRO_STORAGE_KEY = 'emily-jeff-intro-v1';

const STYLE = `
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483000;
    display: block; color: #075b50; font-family: Arial, Helvetica, sans-serif;
    -webkit-tap-highlight-color: transparent; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; cursor: pointer; -webkit-appearance: none; }
  button:focus-visible { outline: 3px solid #075b50; outline-offset: 4px; }
  .frame { position: absolute; inset: 0; overflow: hidden; isolation: isolate;
    background: #fff1d1; display: flex; flex-direction: column;
    padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
    --duration: ${GREAT_ESCAPE_INTRO_DURATION}ms; }
  .frame::before { content: ''; position: absolute; inset: 0; z-index: -1;
    background: radial-gradient(ellipse at 48% 55%, #ffe5b066, transparent 62%);
    pointer-events: none; }
  .grain { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .13;
    pointer-events: none; z-index: 20; mix-blend-mode: multiply; }
  .top, .bottom { width: 100%; max-width: 460px; margin-inline: auto; flex: 0 0 auto;
    position: relative; z-index: 30; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; }
  .identity { font-weight: 900; font-size: 12px; letter-spacing: .09em; line-height: 1.35; }
  .identity span { display: block; font-weight: 600; font-size: 9px; letter-spacing: .15em; opacity: .65; margin-top: 3px; }
  .skip { border: 1px solid #075b5030; border-radius: 30px; background: #fff6e5bf;
    color: #075b50; padding: 12px 14px; min-height: 44px; font-size: 12px; font-weight: 700;
    display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
  .skip svg { width: 15px; height: 15px; }
  .stage { flex: 1 1 auto; width: 100%; max-width: 460px; margin-inline: auto;
    position: relative; min-height: 0; }
  .script { position: absolute; top: 5.5%; left: 0; width: 100%; text-align: center;
    z-index: 8; pointer-events: none; }
  .script h2 { margin: 0; color: #e74924; font-family: 'Arial Black', 'Trebuchet MS', Arial, sans-serif;
    font-weight: 950; font-size: clamp(29px, 8.5vw, 43px); line-height: 1.04;
    letter-spacing: -.065em; text-wrap: balance; }
  .script .line { display: block; transform-origin: 50% 80%; }
  .script .coffee-word { font-size: 1.58em; line-height: 1.04; letter-spacing: -.06em; margin-top: 2px; }
  .script .underline { height: 7px; margin: 10px auto 0; width: 66%; border-radius: 50%;
    background: #e74924; transform: rotate(-2deg); opacity: .84; }
  .punch { opacity: 0; top: 5%; }
  .punch h2 { font-size: clamp(34px, 10.7vw, 51px); line-height: 1.04; }
  .punch .teal { color: #075b50; }
  .subline { margin: 15px 0 0; font-size: 10px; font-weight: 800; letter-spacing: .12em; line-height: 1.7; }
  .coffee { position: absolute; width: 36%; max-width: 166px; left: 50%; bottom: 21%;
    transform: translateX(-50%); z-index: 5; transform-origin: 50% 90%; }
  .coffee svg { display: block; width: 100%; overflow: visible; }
  .steam { stroke-dasharray: 150; stroke-dashoffset: 150; }
  .coffee-shadow { fill: #bb835233; }
  .cast { position: absolute; left: -3%; right: -3%; bottom: 1%; height: 62%;
    pointer-events: none; }
  .crow, .runner { position: absolute; display: block; object-fit: contain; object-position: center bottom;
    user-select: none; -webkit-user-drag: none; transform-origin: 50% 95%; }
  .crow { width: 118%; height: 112%; left: -9%; bottom: 14%; z-index: 1; opacity: 0; }
  .crow-load { display: none; }
  .crow-left { transform-origin: 405px 425px; }
  .crow-right { transform-origin: 790px 440px; }
  .runner { height: 104%; width: 70%; bottom: 0; z-index: 3; opacity: 0; }
  .emily { left: -2%; }
  .jeff { right: -2%; z-index: 2; }
  .ground { position: absolute; width: 80%; height: 9%; left: 10%; bottom: -1%; z-index: 0;
    border-radius: 50%; background: radial-gradient(ellipse, #e9914b42, #e9914b00 70%); opacity: 0; }
  .cheers { position: absolute; top: 32%; right: 2%; width: 14%; transform: rotate(9deg); opacity: 0; z-index: 4; }
  .route { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;
    z-index: 6; pointer-events: none; opacity: 0; }
  .route-path { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .route-halo { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .bottom { display: flex; align-items: center; justify-content: space-between; min-height: 52px; gap: 10px; }
  .tofu { display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 900;
    letter-spacing: .1em; opacity: 0; transform-origin: 0 50%; }
  .tofu svg { width: 37px; height: 39px; flex-shrink: 0; }
  .pause { border: 0; background: transparent; color: #075b50; display: inline-flex;
    align-items: center; justify-content: center; gap: 6px; font-size: 11px; min-height: 44px;
    padding: 10px 3px 10px 10px; opacity: .8; }
  .pause svg { width: 12px; height: 12px; }
  .open { display: none; border: 0; border-radius: 24px; padding: 12px 17px; min-height: 44px;
    font-weight: 700; font-size: 12px; color: #fff7e8; background: #075b50; white-space: nowrap; }
  .progress { height: 2px; width: 100%; max-width: 460px; flex: 0 0 auto; margin: 3px auto 0;
    background: #075b5012; border-radius: 4px; overflow: hidden; }
  .progress span { display: block; width: 100%; height: 100%; background: #075b5060;
    transform: scaleX(0); transform-origin: left; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .frame[data-running='true'] { animation: curtain var(--duration) linear both; }
  [data-running='true'] .opening { animation: opening var(--duration) linear both; }
  [data-running='true'] .opening .line:nth-child(1) { animation: firstLine var(--duration) linear both; }
  [data-running='true'] .opening .line:nth-child(2) { animation: secondLine var(--duration) linear both; }
  [data-running='true'] .opening .line:nth-child(3) { animation: thirdLine var(--duration) linear both; }
  [data-running='true'] .opening .underline { animation: underline var(--duration) linear both; }
  [data-running='true'] .punch { animation: punch var(--duration) linear both; }
  [data-running='true'] .coffee { animation: coffee var(--duration) linear both; }
  [data-running='true'] .steam { animation: steam var(--duration) linear both; }
  [data-running='true'] .steam.two { animation-delay: 120ms; }
  [data-running='true'] .crow { animation: crow var(--duration) linear both; }
  [data-running='true'] .crow-left { animation: leftWing var(--duration) linear both; }
  [data-running='true'] .crow-right { animation: rightWing var(--duration) linear both; }
  [data-running='true'] .emily { animation: emily var(--duration) linear both; }
  [data-running='true'] .jeff { animation: jeff var(--duration) linear both; }
  [data-running='true'] .ground { animation: ground var(--duration) linear both; }
  [data-running='true'] .cheers { animation: cheers var(--duration) linear both; }
  [data-running='true'] .tofu { animation: tofu var(--duration) linear both; }
  [data-running='true'] .route { animation: route var(--duration) linear both; }
  [data-running='true'] .route-path, [data-running='true'] .route-halo { animation: routeDraw var(--duration) linear both; }
  [data-paused='true'], [data-paused='true'] * { animation-play-state: paused !important; }
  @keyframes curtain { 0%, 90% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes opening { 0%, 48% { opacity: 1; transform: translateY(0); } 53%, 100% { opacity: 0; transform: translateY(-12px); } }
  @keyframes firstLine { 0% { opacity: 0; transform: translateY(9px) rotate(-2deg); } 8%,100% { opacity: 1; transform: translateY(0) rotate(0); } }
  @keyframes secondLine { 0%, 7% { opacity: 0; transform: translateY(8px) rotate(1deg); } 15%,100% { opacity: 1; transform: translateY(0) rotate(0); } }
  @keyframes thirdLine { 0%,14% { opacity: 0; transform: scale(.9) rotate(-3deg); } 23% { opacity: 1; transform: scale(1.025) rotate(-1deg); } 27%,100% { opacity: 1; transform: scale(1) rotate(-1deg); } }
  @keyframes underline { 0%,21% { transform: scaleX(0) rotate(-2deg); opacity: 0; } 28%,100% { transform: scaleX(1) rotate(-2deg); opacity: .84; } }
  @keyframes punch { 0%,52% { opacity: 0; transform: translateY(12px); } 58%,86% { opacity: 1; transform: translateY(0); } 97%,100% { opacity: 0; transform: translateY(-22px); } }
  @keyframes coffee { 0% { opacity: 0; transform: translateX(-50%) translateY(10px) rotate(-4deg); }
    10%,25% { opacity: 1; transform: translateX(-50%) translateY(0) rotate(0); }
    37%,65% { opacity: .85; transform: translateX(-132%) translateY(76%) scale(.44) rotate(-3deg); }
    78%,100% { opacity: 0; transform: translateX(-132%) translateY(76%) scale(.44) rotate(-3deg); } }
  @keyframes steam { 0%,4% { stroke-dashoffset: 150; opacity: 0; } 22%,48% { stroke-dashoffset: 0; opacity: .65; } 66%,100% { stroke-dashoffset: -150; opacity: 0; } }
  @keyframes crow { 0%,27% { opacity: 0; transform: translateY(55px) rotate(-5deg); }
    38% { opacity: 1; transform: translateY(-10px) rotate(1.5deg); }
    43% { opacity: 1; transform: translateY(0) rotate(0); }
    51% { opacity: 1; transform: translateY(-8px) rotate(-1deg); }
    56%,86% { opacity: 1; transform: translateY(0) rotate(0); }
    100% { opacity: 0; transform: translateY(-35px) rotate(0); } }
  @keyframes leftWing { 0%,46% { transform: rotate(0); } 51% { transform: rotate(5deg); } 55% { transform: rotate(-1deg); } 60%,100% { transform: rotate(0); } }
  @keyframes rightWing { 0%,46% { transform: rotate(0); } 51% { transform: rotate(-5deg); } 55% { transform: rotate(1deg); } 60%,100% { transform: rotate(0); } }
  @keyframes emily { 0%,29% { opacity: 0; transform: translate(-28px,30px) rotate(-4deg); }
    40% { opacity: 1; transform: translate(0,-4px) rotate(1deg); }
    44%,86% { opacity: 1; transform: translate(0,0) rotate(0); }
    100% { opacity: 0; transform: translate(-20px,-34px) rotate(-2deg); } }
  @keyframes jeff { 0%,32% { opacity: 0; transform: translate(27px,35px) rotate(4deg); }
    43% { opacity: 1; transform: translate(0,-4px) rotate(-1deg); }
    47%,86% { opacity: 1; transform: translate(0,0) rotate(0); }
    100% { opacity: 0; transform: translate(20px,-34px) rotate(2deg); } }
  @keyframes ground { 0%,30% { opacity: 0; } 42%,85% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes cheers { 0%,45% { opacity: 0; transform: scale(.5) rotate(-5deg); }
    51%,58% { opacity: 1; transform: scale(1) rotate(9deg); } 65%,100% { opacity: 0; transform: scale(1.05) rotate(9deg); } }
  @keyframes tofu { 0%,62% { opacity: 0; transform: scale(.8); } 70% { opacity: 1; transform: scale(1.07); } 75%,100% { opacity: 1; transform: scale(1); } }
  @keyframes route { 0%,63% { opacity: 0; transform: scale(1); } 68%,87% { opacity: .85; transform: scale(1); } 100% { opacity: 0; transform: scale(1.08); } }
  @keyframes routeDraw { 0%,65% { stroke-dashoffset: 1; } 90%,100% { stroke-dashoffset: 0; } }
  .frame[data-reduced='true'] { animation: none !important; opacity: 1 !important; }
  [data-reduced='true'] * { animation: none !important; }
  [data-reduced='true'] .opening, [data-reduced='true'] .coffee, [data-reduced='true'] .cheers,
  [data-reduced='true'] .route, [data-reduced='true'] .pause, [data-reduced='true'] .progress { display: none; }
  [data-reduced='true'] .punch, [data-reduced='true'] .crow, [data-reduced='true'] .runner,
  [data-reduced='true'] .ground, [data-reduced='true'] .tofu { opacity: 1; transform: none; }
  [data-reduced='true'] .open { display: inline-block; }
  @media (max-width: 350px) {
    .frame { padding-inline: 12px; }
    .script h2 { font-size: 28px; }
    .punch h2 { font-size: 34px; }
    .identity { font-size: 11px; }
    .skip { padding-inline: 11px; font-size: 11px; }
    .tofu { font-size: 9px; gap: 6px; }
  }
  @media (max-height: 690px) and (max-width: 599px) {
    .frame { padding-top: max(10px, env(safe-area-inset-top)); padding-bottom: max(10px, env(safe-area-inset-bottom)); }
    .script { top: 3%; }
    .script h2 { font-size: clamp(26px, 7.7vw, 36px); }
    .punch h2 { font-size: clamp(30px, 9vw, 41px); }
    .subline { margin-top: 9px; font-size: 9px; }
    .cast { height: 59%; }
    .bottom { min-height: 44px; }
  }
  @media (max-height: 540px) and (min-width: 600px) {
    .top, .bottom, .stage, .progress { max-width: 900px; }
    .frame { padding-block: 10px; }
    .stage .script { width: 43%; left: 0; top: 16%; }
    .script h2 { font-size: clamp(27px, 4.6vw, 42px); }
    .punch h2 { font-size: clamp(31px, 5.1vw, 46px); }
    .cast { left: 42%; right: 0; height: 94%; bottom: 0; }
    .coffee { width: 18%; max-width: 125px; left: 70%; bottom: 12%; }
    .tofu { font-size: 10px; }
    .tofu svg { width: 29px; height: 30px; }
    .bottom { min-height: 36px; }
    .cheers { top: 5%; }
  }
`;

const MARKUP = `
  <div class="frame" role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-description" data-running="false" data-paused="false" data-reduced="false">
    <h1 class="sr-only" id="intro-title">Emily and Jeff’s great escape</h1>
    <p class="sr-only" id="intro-description">Some siblings just go for coffee. These two kept going. Escape from Meriden. Twenty-four hours. Powered by tofu.</p>
    <svg class="grain" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#paper)" opacity=".35"/></svg>
    <header class="top">
      <div class="identity" aria-hidden="true">EMILY &amp; JEFF<span>THE GREAT ESCAPE</span></div>
      <button class="skip" type="button">Skip to map<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </header>
    <div class="stage" aria-hidden="true">
      <div class="script opening"><h2><span class="line">SOME SIBLINGS</span><span class="line">JUST GO FOR</span><span class="line coffee-word">COFFEE.</span></h2><div class="underline"></div></div>
      <div class="script punch"><h2><span class="line teal">THESE TWO</span><span class="line">KEPT GOING.</span></h2><p class="subline">ESCAPE FROM MERIDEN · 24 HOURS</p></div>
      <div class="coffee"><svg viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg">
        <ellipse class="coffee-shadow" cx="76" cy="182" rx="63" ry="9"/>
        <path class="steam" d="M68 102C34 81 97 78 66 54S94 21 75 8" fill="none" stroke="#c88548" stroke-width="7" stroke-linecap="round"/>
        <path class="steam two" d="M93 98c-25-19 23-31 9-48" fill="none" stroke="#c88548" stroke-width="4" stroke-linecap="round"/>
        <path d="M119 123c37-6 38 38 2 39" fill="none" stroke="#c6381e" stroke-width="12"/>
        <path d="M30 115q48-8 94 0l-7 48q-5 18-38 19-38-2-42-19Z" fill="#ee5329"/>
        <path d="M43 124l6 36q3 7 8 10" fill="none" stroke="#ff9c51" stroke-width="7" stroke-linecap="round"/>
        <ellipse cx="77" cy="115" rx="47" ry="8" fill="#b4331b"/>
        <ellipse cx="77" cy="114" rx="39" ry="5" fill="#6b3e29"/>
        <path d="M27 181q50 14 101-1" fill="none" stroke="#d18c54" stroke-width="6" stroke-linecap="round"/>
      </svg></div>
      <div class="cast">
        <div class="ground"></div>
        <img class="crow-load" alt="" decoding="async"/>
        <svg class="crow" viewBox="0 0 1254 1254" preserveAspectRatio="xMidYMax meet">
          <defs>
            <path id="left-feathers" d="M0 270H235Q350 320 415 420Q380 500 345 535Q318 610 270 755L0 820Z"/>
            <path id="right-feathers" d="M780 420Q850 350 955 320H1254V870L1080 800Q1000 730 949 675Q840 600 780 540Q735 460 780 420Z"/>
            <clipPath id="left-wing"><use href="#left-feathers"/></clipPath>
            <clipPath id="right-wing"><use href="#right-feathers"/></clipPath>
            <mask id="crow-body"><rect width="1254" height="1254" fill="white"/><use href="#left-feathers" fill="black"/><use href="#right-feathers" fill="black"/></mask>
          </defs>
          <image class="crow-art" width="1254" height="1254" mask="url(#crow-body)"/>
          <g class="crow-left"><image class="crow-art" width="1254" height="1254" clip-path="url(#left-wing)"/></g>
          <g class="crow-right"><image class="crow-art" width="1254" height="1254" clip-path="url(#right-wing)"/></g>
        </svg>
        <img class="runner emily" alt="" draggable="false" decoding="async"/>
        <img class="runner jeff" alt="" draggable="false" decoding="async"/>
        <svg class="cheers" viewBox="0 0 70 80"><path d="m12 45 12-32m9 42 20-29m-8 43 21-12" stroke="#e74924" stroke-width="7" stroke-linecap="round"/></svg>
      </div>
      <svg class="route" viewBox="0 0 460 650" preserveAspectRatio="none">
        <path class="route-halo" pathLength="1" d="M94 560C47 520 55 455 100 444S202 474 186 405 62 367 81 305 222 329 231 256 338 204 341 151 418 86 403 23" stroke="#fff1d1" stroke-width="9" fill="none" stroke-linecap="round"/>
        <path class="route-path" pathLength="1" d="M94 560C47 520 55 455 100 444S202 474 186 405 62 367 81 305 222 329 231 256 338 204 341 151 418 86 403 23" stroke="#e74924" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      </svg>
    </div>
    <footer class="bottom">
      <div class="tofu" aria-hidden="true"><svg viewBox="0 0 48 52"><path d="m8 19 25-5 10 9-3 23-25 4-9-9Z" fill="#f6cf88" stroke="#55432b" stroke-width="2.2" stroke-linejoin="round"/><path d="m8 19 10 8 25-4M18 27l-3 23" fill="none" stroke="#55432b" stroke-width="1.7"/><path d="M27 16c-13 0-15-12-15-12 12-2 17 9 15 12Zm0 0c-1-13 13-15 13-15s2 14-13 15Z" fill="#6b9637" stroke="#365c2c" stroke-width="1.6"/><circle cx="24" cy="35" r="1.6" fill="#55432b"/><circle cx="35" cy="33" r="1.6" fill="#55432b"/><path d="M27 39q3 3 6-1" stroke="#55432b" fill="none" stroke-width="1.8" stroke-linecap="round"/><circle cx="22" cy="39" r="2.2" fill="#ef815f"/><circle cx="37" cy="37" r="2.2" fill="#ef815f"/></svg><span>POWERED BY TOFU</span></div>
      <button class="pause" type="button" aria-label="Pause animation" aria-pressed="false"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2v8M9 2v8" stroke="currentColor" stroke-width="2.5"/></svg><span>Pause</span></button>
      <button class="open" type="button">Open map <span aria-hidden="true">↗</span></button>
    </footer>
    <div class="progress" aria-hidden="true"><span></span></div>
  </div>
`;

/** Mount an isolated introduction and return imperative replay/skip/teardown. */
export function mountGreatEscapeIntro(options = {}) {
  const host = options.host ?? document.body;
  if (!(host instanceof HTMLElement)) throw new TypeError('Intro host must be an HTMLElement.');
  const callback = typeof options.onComplete === 'function' ? options.onComplete : () => {};
  const remember = options.remember !== false;
  const base = new URL(options.assetBase ?? '../assets/', import.meta.url);
  const assetURL = filename => new URL(filename, base).href;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionWasSpecified = typeof options.reducedMotion === 'boolean';

  let destroyed = false;
  let active = false;
  let completed = false;
  let generation = 0;
  let node = null;
  let shadow = null;
  let frame = null;
  let progress = null;
  let pauseButton = null;
  let elapsed = 0;
  let lastTime = null;
  let raf = 0;
  let assetTimeout = 0;
  let assetTimeoutRemaining = 0;
  let assetTimeoutStartedAt = null;
  let pendingAssets = 0;
  let manuallyPaused = false;
  let isReduced = motionWasSpecified ? options.reducedMotion : media.matches;
  let previousFocus = null;
  let inertRecords = [];
  let detachListeners = [];

  function hasSeen() {
    if (!remember) return false;
    try { return localStorage.getItem(GREAT_ESCAPE_INTRO_STORAGE_KEY) === 'seen'; }
    catch { return false; }
  }

  function markSeen() {
    if (!remember) return;
    try { localStorage.setItem(GREAT_ESCAPE_INTRO_STORAGE_KEY, 'seen'); } catch { /* Storage is optional. */ }
  }

  function isolateBackground() {
    let branch = node;
    let parent = branch.parentElement;
    const handled = new Set();
    while (parent) {
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !handled.has(sibling)) {
          handled.add(sibling);
          inertRecords.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
      parent = parent.parentElement;
    }
  }

  function restoreBackground() {
    for (const [element, wasInert] of inertRecords) element.inert = wasInert;
    inertRecords = [];
  }

  function listen(target, type, handler, config) {
    target.addEventListener(type, handler, config);
    detachListeners.push(() => target.removeEventListener(type, handler, config));
  }

  function cleanPlayback() {
    cancelAnimationFrame(raf);
    raf = 0;
    stopAssetTimeout();
    pendingAssets = 0;
    assetTimeoutRemaining = 0;
    for (const detach of detachListeners) detach();
    detachListeners = [];
    restoreBackground();
    node?.remove();
    node = shadow = frame = progress = pauseButton = null;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.inert) {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* Host may have navigated. */ }
    }
    previousFocus = null;
  }

  function finish(reason) {
    if (!active || completed || destroyed) return;
    completed = true;
    active = false;
    generation += 1;
    // Failed downloads should be eligible for the intro on a later visit.
    if (reason !== 'asset-error' && reason !== 'asset-timeout') markSeen();
    cleanPlayback();
    callback(reason);
  }

  function stopAssetTimeout() {
    clearTimeout(assetTimeout);
    assetTimeout = 0;
    if (assetTimeoutStartedAt !== null) {
      assetTimeoutRemaining = Math.max(0, assetTimeoutRemaining - (performance.now() - assetTimeoutStartedAt));
      assetTimeoutStartedAt = null;
    }
  }

  function syncAssetTimeout() {
    stopAssetTimeout();
    if (!active || pendingAssets === 0 || manuallyPaused || document.hidden) return;
    if (assetTimeoutRemaining <= 0) {
      finish('asset-timeout');
      return;
    }
    const thisGeneration = generation;
    assetTimeoutStartedAt = performance.now();
    assetTimeout = window.setTimeout(() => {
      if (!active || thisGeneration !== generation) return;
      // Recheck visibility, pause state and pending downloads before completing.
      syncAssetTimeout();
    }, assetTimeoutRemaining);
  }

  function updatePaused() {
    if (!frame) return;
    frame.dataset.paused = String(manuallyPaused || document.hidden);
    pauseButton?.setAttribute('aria-label', manuallyPaused ? 'Resume animation' : 'Pause animation');
    pauseButton?.setAttribute('aria-pressed', String(manuallyPaused));
    if (pauseButton) {
      pauseButton.querySelector('span').textContent = manuallyPaused ? 'Resume' : 'Pause';
      pauseButton.querySelector('svg').innerHTML = manuallyPaused
        ? '<path d="m3 1 8 5-8 5Z" fill="currentColor"/>'
        : '<path d="M3 2v8M9 2v8" stroke="currentColor" stroke-width="2.5"/>';
    }
    lastTime = null;
    syncAssetTimeout();
  }

  function tick(time) {
    if (!active || destroyed || isReduced) return;
    const paused = manuallyPaused || document.hidden;
    if (!paused && lastTime !== null) elapsed += Math.max(0, time - lastTime);
    lastTime = paused ? null : time;
    const scene = elapsed < 2400 ? 'coffee' : elapsed < 4400 ? 'cast' : elapsed < 5900 ? 'adventure' : 'route';
    if (frame && frame.dataset.scene !== scene) frame.dataset.scene = scene;
    if (progress) progress.style.transform = `scaleX(${Math.min(1, elapsed / GREAT_ESCAPE_INTRO_DURATION)})`;
    if (elapsed >= GREAT_ESCAPE_INTRO_DURATION) {
      finish('complete');
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function useReducedMotion() {
    if (!active || !frame) return;
    isReduced = true;
    cancelAnimationFrame(raf);
    raf = 0;
    frame.dataset.reduced = 'true';
    frame.dataset.running = 'false';
    // Resume the download deadline after Pause becomes hidden in static mode.
    manuallyPaused = false;
    updatePaused();
    // Do not leave focus on the Pause button after it becomes hidden.
    if (shadow?.activeElement === pauseButton) shadow.querySelector('.skip').focus({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (!active || !shadow) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('skipped');
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...shadow.querySelectorAll('button')]
      .filter(button => !button.disabled && button.getClientRects().length > 0);
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const focused = shadow.activeElement;
    if (event.shiftKey && (focused === first || !buttons.includes(focused))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (focused === last || !buttons.includes(focused))) {
      event.preventDefault();
      first.focus();
    }
  }

  function begin() {
    if (destroyed) return false;
    if (active) {
      active = false;
      generation += 1;
      cleanPlayback();
    }
    active = true;
    completed = false;
    manuallyPaused = false;
    elapsed = 0;
    lastTime = null;
    isReduced = motionWasSpecified ? options.reducedMotion : media.matches;
    const thisGeneration = ++generation;
    previousFocus = document.activeElement;

    node = document.createElement('div');
    node.dataset.greatEscapeIntro = '';
    shadow = node.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLE}</style>${MARKUP}`;
    frame = shadow.querySelector('.frame');
    progress = shadow.querySelector('.progress span');
    pauseButton = shadow.querySelector('.pause');
    host.append(node);
    isolateBackground();

    listen(shadow.querySelector('.skip'), 'click', () => finish('skipped'));
    listen(shadow.querySelector('.open'), 'click', () => finish('reduced-motion'));
    listen(pauseButton, 'click', () => {
      manuallyPaused = !manuallyPaused;
      updatePaused();
    });
    listen(shadow, 'keydown', onKeyDown);
    listen(document, 'visibilitychange', updatePaused);
    if (!motionWasSpecified) listen(media, 'change', event => {
      // A mid-intro request for less motion takes effect immediately.
      if (event.matches) useReducedMotion();
    });

    const images = [
      [shadow.querySelector('.emily'), 'emily.webp'],
      [shadow.querySelector('.jeff'), 'jeff.webp'],
      [shadow.querySelector('.crow-load'), 'crow.webp'],
    ];
    for (const crowImage of shadow.querySelectorAll('.crow-art')) crowImage.setAttribute('href', assetURL('crow.webp'));
    pendingAssets = images.length;
    assetTimeoutRemaining = 4500;
    const loaded = () => {
      if (!active || thisGeneration !== generation) return;
      pendingAssets -= 1;
      if (pendingAssets === 0) stopAssetTimeout();
    };
    const failed = () => {
      if (active && thisGeneration === generation) finish('asset-error');
    };
    // The download deadline counts only visible, unpaused time. It also runs
    // in the static reduced-motion view, independently of the animation RAF.
    for (const [img, filename] of images) {
      listen(img, 'load', loaded, { once: true });
      listen(img, 'error', failed, { once: true });
      img.src = assetURL(filename);
    }

    frame.dataset.reduced = String(isReduced);
    updatePaused();
    // Force a style flush so replay always starts at frame zero.
    void frame.offsetWidth;
    frame.dataset.running = String(!isReduced);
    if (!isReduced) raf = requestAnimationFrame(tick);
    shadow.querySelector('.skip').focus({ preventScroll: true });
    return true;
  }

  const controller = {
    replay: begin,
    skip: () => finish('skipped'),
    destroy() {
      if (destroyed) return;
      active = false;
      destroyed = true;
      generation += 1;
      cleanPlayback();
    },
  };

  if (!options.force && hasSeen()) {
    completed = true;
    const rememberedGeneration = generation;
    queueMicrotask(() => {
      if (!destroyed && !active && generation === rememberedGeneration) callback('remembered');
    });
  } else begin();
  return controller;
}

export default mountGreatEscapeIntro;
