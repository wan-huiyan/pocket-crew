/** The alternative shell uses the current guide's complete content and handlers. */
export function renderPosterGuide(source, home) {
  if (!source.includes('id="panel-now"') || !home.includes('id="panel-now"')) throw new Error('Race guide shell is missing');
  return source
    .replace('<head>', '<head>\n<base href="/">')
    .replace('<body>', '<body class="poster-mode">')
    .replace('<main id="main"', '<main tabindex="-1" id="main"')
    .replace('href="manifest.webmanifest"', 'href="/poster.webmanifest"')
    .replace(/<section id="panel-now"[\s\S]*?<\/section>/, home.trim())
    .replace(/<title>[\s\S]*?<\/title>/, '<title>Emily & Jeff · The Great Escape · Poster view</title>')
    .replace('content="#fff8e9"', 'content="#C93625"')
    .replace('rel="canonical" href="https://emily-jeff-meriden-crew.whylaura413.chatgpt.site/"', 'rel="canonical" href="https://emily-jeff-meriden-crew.whylaura413.chatgpt.site/poster/"')
    .replace('</head>', '<link rel="stylesheet" href="/poster-view.css"><script src="/poster-view.js" defer></script>\n</head>')
    .replace('<div class="more-menu">', '<div class="poster-tools-title"><p>THE WHOLE CREW,<br>IN YOUR POCKET.</p><img src="/assets/crow.svg" alt="" width="82" height="82"></div><div class="more-menu">')
    .replace('<div class="settings-actions">', '<p class="poster-edition-note">You’re using the bold poster view. <a href="/">Open the original view ↗</a></p><div class="settings-actions">');
}
