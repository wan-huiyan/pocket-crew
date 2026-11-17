'use strict';
// The real guide and map mount first. This controller only owns the overlay.
(() => {
  const replayButton = document.getElementById('replay-intro');
  if (!document.getElementById('race-map') || !replayButton) return;
  let controller = null, mountIntro = null, loading = true, disposed = false;
  let generation = 0, deadline = 0, restoreAfterHistory = false;
  const blocking = () => loading || Boolean(document.querySelector('[data-great-escape-intro]'));
  const releasePending = () => window.crowCelebrations?.flushPending?.();

  function complete(reason) {
    loading = false;
    if (reason !== 'remembered') {
      document.querySelector('#panel-now:not([hidden])[data-map-heading]')?.focus({preventScroll:true});
    }
    releasePending();
  }
  async function start() {
    if (disposed) return;
    const attempt = ++generation;
    loading = true;
    // A failed or slow module must never hold up the race guide or its cheers.
    deadline = setTimeout(() => {
      if (attempt !== generation || disposed) return;
      generation += 1; loading = false; releasePending();
    }, 4500);
    try {
      mountIntro ||= (await import('/intro/great-escape-intro.js')).mountGreatEscapeIntro;
      if (disposed) return;
      replayButton.hidden = false;
      if (attempt !== generation) return;
      clearTimeout(deadline);
      controller = mountIntro({assetBase:'/assets/',onComplete:complete});
      loading = false;
    } catch (error) {
      if (attempt !== generation || disposed) return;
      clearTimeout(deadline); loading = false;
      console.info('Intro unavailable; the race guide is ready.');
      releasePending();
    }
  }
  function replay() {
    if (disposed || !mountIntro) return false;
    if (typeof switchTab === 'function') switchTab('now');
    if (controller) return controller.replay();
    controller = mountIntro({assetBase:'/assets/',onComplete:complete,force:true});
    return true;
  }
  function destroy() {
    disposed = true; generation += 1; clearTimeout(deadline);
    replayButton.removeEventListener('click',replay);
    window.removeEventListener('pagehide',pageHide);
    window.removeEventListener('pageshow',pageShow);
    controller?.destroy(); controller = null; loading = false;
  }
  function pageHide(event) {
    if (!event.persisted) { destroy(); return; }
    generation += 1; clearTimeout(deadline);
    controller?.destroy(); controller = null; loading = false;
    restoreAfterHistory = true;
  }
  function pageShow(event) {
    if (event.persisted && restoreAfterHistory) { restoreAfterHistory = false; start(); }
  }
  replayButton.addEventListener('click',replay);
  window.addEventListener('pagehide',pageHide);
  window.addEventListener('pageshow',pageShow);
  window.guideIntro = {isBlocking:blocking,replay,destroy};
  start();
})();
