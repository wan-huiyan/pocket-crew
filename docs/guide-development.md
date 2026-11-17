# Crow crew · Emily & Jeff

## Ben joins the support crew · 14 November 2026

Ben (Emily’s partner) has his own warm illustrated portrait, a separate map cutout/status, phone GPS sharing selector and walking/meet-up plan, alongside Huiyan, Graham and Jeff. His position stays unknown until his phone explicitly connects and shares; older supporter locations and race tracker reports are never reused for him. The portrait is based on the supplied photos, not a public upload of the photographs. No existing race milestones, celebrations, GPS positions or support plans are changed.

## ETA range simplification · 14 November 2026

Arrival estimates retain the early-to-late time range in runner and supporter views, meeting details, milestone rows and charger cards. The separate “Be ready by”/“Be ready now” line is no longer shown; the beginning of the displayed range already provides the earlier planning bound. Forecast calculations and permissions remain unchanged.

## Illustrated portrait restoration · 14 November 2026

Restored the previous soft illustrated `avatars-v5` portraits across the map, person sheets, milestone moments and status strip. The newer realistic `avatars-v6` image assets remain available in source but are no longer used by the people display. Emily and Matt's portraits were already identical between versions. Race feeds, ETA logic, support plans, permissions and meeting controls remain as in the latest version.

Phone-first public guide for Escape from Meriden, 13–14 November 2026. The existing Site identity is in `.openai/hosting.json`; publish edits to that Site rather than creating another.

## Alternative poster display

`/poster/` is the bold red, yellow, teal and navy alternative. `guide/poster-home.html` supplies its new map dashboard and `guide/poster-template.mjs` combines that shell with the complete current guide. `public/poster-view.css` and `public/poster-view.js` provide the alternative presentation. The two views share the same original scripts, data, crew rooms and local state; no tracking or meeting information is copied into a second system. The main guide's sections remain authoritative when rebuilt. The root service worker includes the alternative shell and styles for offline use without caching live APIs or unreleased pictures.

## Coffee can wait intro

Both guide layouts mount their real map before `public/intro-host.js` loads the supplied 8.8-second overlay from `public/intro/great-escape-intro.js`. Its three compressed images are `public/assets/emily.webp`, `jeff.webp` and `crow.webp` (728,336 bytes together). No preview map or demonstration positions are included.

The silent intro supports immediate Skip, Pause/Resume and a static reduced-motion view with Open map. Completion or skipping is remembered per browser under `emily-jeff-intro-v1`; Replay intro lives in the existing tools menu. The adapter preserves the map, selected role, agreed meeting point, tracker and location permissions. It restores map focus after a shown intro and disposes or restores the controller across page lifecycle events. Missing or slow intro files fail open to the guide.

Legitimate milestone releases continue to update history, but their celebration modal waits until the intro closes. The intro never releases or unlocks a milestone. The supplied component includes a targeted fix that resumes its image-download deadline if reduced motion is enabled while playback was manually paused.

`docs/phone-intro-preview.jpg` shows the integrated static reduced-motion view at 390 × 844. Browser checks cover Replay, Pause/Resume, natural completion, immediate Skip and Open map. They do not imply physical-iPhone testing or a live race report.

## Authored application

- `guide/celebration-home.html` is the celebration home page, served by `app/route.ts` and copied to `public/index.html` as a static fallback. `guide/index.html` remains the original race-day Crow Crew guide, copied to `public/crew.html` before builds.
- `public/app.js` handles drawers, runner/supporter views, preferences and offline saving. The home screen is a single fixed phone map.
- `public/map-first.js` shows runners one automatic next meet-up, with an agreed crew selection taking priority. `public/upcoming-points.js` advances past passed/met/skipped pins and frames the next destination in runner mode. Supporters can switch between upcoming points and an All meet-ups map of every option along the planned route. Meeting labels and details include verified town/locality names alongside the original point number and landmark. Tapping a pin opens its details; alternative choices and plan editing remain supporter-only. Re-centre map resumes automatic following after panning. Runner mode only adds a relevant WC; crew mode adds nearby parking, charging and cafés. Stale and off-route reports are explicitly labelled.
- The fixed glance summary shows the next meeting-point name beside a 44–52 px distance, plus 28 px route progress. People labels and primary runner buttons stay 18 px on short phones, with a clearly labelled WC marker. Label placement measures the rendered text and reserves the space occupied by the header and dock; map zoom does not change label size.
- `public/celebrations.js` plays finite crow/heart/toast/crown moments after an explicit reached-milestone release, with reduced-motion styles. Crew previews are local and have no unlock side effects. Runner mode has no future poster list or teaser. New releases sync through the existing crew room, are acknowledged on each phone and do not replay on polling/reload. Future artwork is not precached.
- `public/data/facilities.json` records checked venues, access notes, regular advertised hours, coordinate precision and source URLs. The Toilets action shows named WC stops over the next 20 route kilometres, independently of the next meet-up. The Coventry–Dunchurch additions distinguish retailer-declared station toilets with unconfirmed night access from daytime-only backups. It does not claim live availability.
- `public/assets/avatars-v5/` contains the four soft illustrated portraits. Each person has an individual transparent cutout and name on the map and status strip. Emily and Jeff each use their own official runner report; Huiyan/Graham share the actual crew report. Portrait placement stays near the exact GPS dots with short solid stems, rather than packing people into distant free map space; nearby people use compact placement. No separate GPS feeds or coordinates are inferred. Unknown positions stay in the fixed status strip, with each supporter able to open the on-site location controls.
- `public/support.js` manages numbered Google Map meeting points, optional nearby alternatives and shared Met/Skipped checkpoint stamps. Runners have a read-only next meet-up; the complete planning list and changes remain in supporter mode. Automatic progression does not publish a crew agreement or claim the crew actually met. Connected supporters can use Met here → Next stop, Skip, and Undo; the server atomically persists stamps and selects the following distinct group. Completing one of a pair marks its unused alternative Skipped. Public reads include confirmed stamps and the latest reversible action, never internal undo history. `public/data/support-points.json` preserves the original pin coordinates. Its 19 planned meeting options in 18 groups include the first Coventry stop and both Point 4 alternatives, with town/locality labels and landmark source URLs. No unlocated 10/20 km placeholders are drawn as meeting pins. The user's confirmation that Coventry has been passed is stored in `confirmedPassedPointIds`; every view skips that stop automatically when GPS is unavailable, while keeping its pin in the full-route overview. Confirmed passed stops affect planning and map framing only, never a runner's reported distance or ETA.
- `public/crew.js` contains charger/parkrun cards, the race-number setting and extra crew notes.
- `public/live.js` automatically polls the public race feed and official runner reports while the page is visible. Viewers need no crew token, sign-in or GPS permission. Registration is configured in `public/crew.js`: Emily Simmons #247 and Jeff Simmons #133. Each is polled separately and mapped only from their own report. A missing runner never borrows the other runner’s coordinate. The main distance, next meet-up and ETA use one selected tracker: the newest actual GPS report with usable on-route history, falling back to the newest usable position if neither has enough pace history. The UI names the selected source. A recent cached report can survive a temporary poll failure until its original five-minute expiry; HTTP delivery never refreshes its GPS time. Delayed reports cannot regress the stored position. Route distance is an approximate projection, not an official gold-distance calculation. Tracking never unlocks posters.
- `app/api/tracker/route.ts` proxies only the official event and validates its year/start before returning one exact bib match. Event ID 35950 is pinned with date and slug checks; its current public URL is `https://track.trail.live/event/escapefrommeriden`. Pre-start roster matches remain waiting with null positions. The official page has a client-side Participants search; no supported prefiltered URL was found, so the guide offers individual copy-number controls and explains the Simmons filter.
- `public/arrival-eta.js` estimates arrival at the current next meet-up for both roles and both layouts. Its shared `selectRunner` function supplies both the live summary and the main ETA; position and pace always come from the same selected runner. If the newest position lacks usable route history, another fresh runner with valid history can supply the estimate and that fallback is explained. If neither has usable pace, route distance can still display while ETA waits. Individual avatar cards keep each runner’s own time and pace. The adapter retrieves a bounded recent window of each runner’s official timed GPS path, and `live.js` projects it onto the planned route. Pace is recent net route progress divided by elapsed report time, including pauses, explicitly labelled “Estimated route pace.” This estimates progress along the planned roads and paths; it is not a watch-recorded total and cannot measure every detour or backtrack. ETA accepts only the declared `recent-tracker-route` pace source. Crow-flight speed and manual planning speed are never used. Fresh, near-route reports and sufficient coherent history are required. Missing, stale, stopped, finished, retired or implausible data produces an explanatory waiting state. Arrival is anchored to the actual report time, so re-polling the same fix cannot push the clock later. Times are approximate, rounded to five minutes and displayed in Europe/London time. Changing the next meet-up or receiving a new report recomputes the estimate; it never publishes a plan or releases a surprise.
- The map uses a consistent **Re-centre map** action to restore automatic framing of the runners, the route ahead and the next meeting point(s). A direct tap confirms the action even when the view was already centred. Panning pauses automatic framing; re-centring resumes it. Meeting details remain on the meet-up/ETA card and the Meet-up action. The focused toilet map retains its **Back to meet-up** action.
- `app/api/crew/route.ts` and `lib/crew-room.ts` implement D1 sharing. Anonymous `GET /api/crew?public=1` exposes only the designated public race room: its latest supporter position, agreed meet-up, bib, optional Maps link and already-released celebrations. It returns a waiting or ended state when appropriate, never credentials or a future celebration schedule. Public visitors cannot list or replace rooms. No location history is retained.

## Public race sharing and supporter controls

The ordinary site URL is the shared viewing link. Switching to Supporting changes the presentation; it does not grant permission to publish locations, edit the shared plan or release celebrations. A separately supplied `#support=` capability enables supporter controls on that browser. The client removes the fragment, stores it locally and authenticates `POST /api/crew` with `action: "activate-public"`. Only successful server verification enables editing. Activation is idempotent, preserves the current shared plan and never starts GPS or publishes old phone settings. Public share buttons always share the ordinary guide URL, without this capability.

The server selects the room using `PUBLIC_CREW_VIEW_HASH` and checks writes using `PUBLIC_CREW_PUBLISH_HASH`; both are SHA-256 hashes of separate random capabilities. `PUBLIC_CREW_EXPIRES_AT` is the fixed absolute ISO deadline. Store configuration through Sites environment settings, never raw capabilities in source or client assets. The public session cannot be extended by activation. Revocation clears its race data and leaves a tombstone that automatic cleanup cannot delete or reactivate. The first public read or activation after expiry also scrubs its former location, bib, meet-up, releases and Maps link while retaining that tombstone.

Legacy `#crew=` invitations still use their original private room and credentials. Saved private-room state does not intercept a normal public visit. Legacy rooms retain their original expiry; newly created private rooms last 48 hours.

Browser location sharing requires an explicit action and browser permission on a supporter's phone. Opening a viewer or supporter link, or tapping an avatar, never starts GPS. Share now & every 30s requests a fresh phone fix immediately and schedules another fresh acquisition every 30 seconds while the page remains visible. Update once is available separately; Update now during automatic sharing preserves that sharing session. Acquisitions and publication do not overlap, and success requires the server to acknowledge the actual GPS timestamp and coordinates. The interval never re-stamps or re-sends an old fix to make it appear current. Automatic sharing pauses when the page is hidden and resumes with a fresh request when the same tab returns, including a back/forward-cache restoration. Sharing intent stays in memory only: a reload requires a new explicit Start, and a one-time update never becomes automatic. Resume refreshes the shared state and sends a position-only update, so another supporter's Stop cannot be undone by returning to this tab. Stop, expired or revoked access, and denied GPS permission clear intent. Pausing preserves the last confirmed position with its original report time; only explicit Stop removes it. This is foreground resumption, not background GPS while the phone is locked. The family's actual phone GPS permissions still need their own device.

An optional `PUBLIC_CREW_LOCATION_HASH` provides recovery for a phone that lost its original supporter capability. It is the SHA-256 hash of a separate random location setup code, configured as a Sites runtime secret. Connect this phone verifies that code using `POST /api/crew` with `action: "activate-location"` before storing it in the separate `meriden-public-location-v1` device key. A `#locate=` setup fragment is also supported and removed immediately. This grant can PATCH position/sharing or a standalone validated checkpoint complete/skip/undo action in the already-active public room. Checkpoint actions select from the known plan; this grant cannot arbitrarily edit a meet-up, create or revive a session, extend expiry, release celebrations or revoke the room. The original publisher remains unchanged. Keep the raw setup code out of repository files, logs and public viewing links.

### Toilet hours and arrival filtering

`toilet-hours.js` evaluates the full arrival window plus ten minutes for access against advertised Europe/London hours, including midnight spans, weekday changes and explicit date exceptions. Facility-specific hours can show **Open at ETA**; venue-only hours show **Likely open · check WC access**. Missing/conflicting schedules and missing/stale arrival data remain uncertain. This is a schedule check, not a live toilet-door status. Runner arrival uses the existing same-runner route forecast, with a labelled walking allowance from the nearby route point; that allowance is not a measured walking detour.

Supporter toilet arrival is **driving if leaving now**. The view explicitly requests one batched `/api/toilet-arrivals` calculation using a shared crew fix no older than five minutes. The adapter accepts only checked toilet IDs and calls the fixed OSRM/FOSSGIS car table service. It has bounded responses, a timeout, five-minute near-origin caching and in-flight deduplication. A separate single-row D1 `toilet_routing_cache` table shares the cache and provider lease across viewers and Worker isolates, with a 1.1-second gap after each provider attempt; it never changes crew or checkpoint state. Missing shared storage fails closed. The browser requests at most once per two minutes while the requested WC view is visible; it never starts phone GPS. A missing road route, stale position or provider failure yields no driving ETA and no crow-flight substitute. The displayed range adds up to five minutes for parking/walking in and excludes live traffic. Routing sends the requested origin and destination pins to FOSSGIS; the UI credits OSRM/FOSSGIS and OpenStreetMap and links their routing information and map corrections.

Each cutout opens a compact person sheet in either display mode. Emily's and Jeff's sheets show their own estimated route pace, report age and next-meet-up estimate; unusable data is labelled instead of borrowing another runner's report. The pace note identifies GPS progress along the planned route and the recent elapsed window, including stops. Huiyan's and Graham's sheets use the same shared crew position and offer immediate and 30-second location actions on an already-connected phone. A phone without publishing access can open the existing setup form without losing public viewing access. No saved Google Maps sharing URL is surfaced as a crew click-out. Legacy `/crew-location` links redirect to `/#live`. Existing saved Maps data is retained for compatibility but is never interpreted as GPS or used to infer a pin. Only a new acknowledged phone fix changes the position report time; refreshing the feed cannot make an old position fresh.

After static asset changes, bump `public/sw.js`'s cache version so already-saved guides update. Never cache `/api/` responses or private tokens. `dist/` is generated output, not an editing location. Follow the Sites skill for managed preview, building and publication. Existing generated D1 migrations are immutable.

`docs/phone-layout-demo.jpg` is a verified small-phone layout with clearly fictional test positions; it is not a race report.
`docs/phone-readability-demo.jpg` records the larger-text revision using sample positions at 375 × 667.
`docs/phone-next-points-demo.jpg` records the named Next / Then map view using sample positions, not live runner data.
`docs/phone-one-meetup.jpg` records the compact single-meet-up runner view at 390 × 844, awaiting real tracker and crew positions. The same behavior was checked at 375 × 667 in the alternative poster layout.
`docs/phone-public-view.jpg` records the public phone view without a crew-link barrier, awaiting actual shared race data. Managed-preview checks also verified that a local dummy supporter capability enables controls without starting GPS.

## Focused checks

Run `node --test tests/*.test.mjs` for room authorization/expiry, atomic shared releases, stale/off-route snapshots, replay protection, spoiler-free runner views and map edge cases. Phone QA uses the managed Sites preview. Verified at 390 × 844 and 375 × 667; real race-bib and device-GPS integration still requires the family’s details and explicit permissions.

OpenStreetMap tiles use the browser’s normal cache and an origin-bearing referrer policy. Street-map tiles are never bulk-downloaded or saved by the guide’s offline button. Only the public site origin is sent cross-origin; crew link fragments are not sent.

## Runtime reference

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git and `tar` (including Windows `tar.exe`) are required for publishing; portable publication does not require Bash

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

Publish archives outside the source checkout or under its ignored `outputs/` directory. Local `.env*`, `.dev.vars*`, TypeScript build state, and tool runtime directories are ignored; keep the hosting manifest, migrations, and authored scripts in source control.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For managed Linux browser QA, follow the Sites skill's managed preview reference. The daemon runs the project's Vite dev script with `--host 0.0.0.0 --port 4173 --strictPort`; use the CLI's returned URL. The ignored local profile survives the daemon's cleared environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `worker/index.ts` is the production Worker entrypoint and preserves request-scoped connector bindings
- `scripts/vite/` contains the maintained Vite integrations and the vendored Sites plugin license
- `scripts/connector-preview/` contains the local connector preview Worker and session helpers
- the remaining `scripts/` files select execution profiles and run installation, development, and builds; the plugin's helpers orchestrate the Sites lifecycle
- `dist/` contains generated deployment output; `.vinext/`, `.wrangler/`, and `.sites-runtime/` contain ignored local tool state
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

The supporter map marker keeps Huiyan and Graham’s separate transparent portraits side by side at one shared reported position, without an enclosing bubble. Emily and Jeff retain independent runner pins. All four footer portraits retain individual names.

The first family meet-up is MFG / Esso Rugby Road on Willenhall Lane, Coventry (52.398503, -1.440933), before the original numbered points. Its saved-route projection is 17.3 km; the family's roughly two-hour arrival plan is an estimate. Existing point numbers remain unchanged, and any explicit crew-selected later meeting still takes priority.

Supporter-avatar taps open the on-site person sheet with the last acknowledged GPS report and the phone's sharing controls. The guide does not use a Google Maps click-out or infer coordinates from a saved sharing URL.



The offline worker uses network-first shell updates with a bounded fallback, tolerates optional asset failures, and never caches the live APIs or `/crew-location`. Settings offers **Update / reload guide**, retaining local preferences and supporter controls. Updating never restarts location sharing; the sharing phone must explicitly select **Share now & every 30s**. Selecting the Supporting display role alone does not grant publisher controls.

## Checkpoint stamps, pace forecasts and friendly rival

`public/rival.js` independently follows verified Matt Leese, bib 210, with a small devil marker at his actual reported coordinates. Its 30-second visible-page feed never supplies Emily/Jeff distance, pace, ETA or meeting selection. Official competitor distance is labelled straight-line distance. Normal follow framing ignores a distant rival; Everyone includes his real position.

The tracker adapter returns bounded `paceReports` (120 samples, 120 minutes) from the same upstream path request as unchanged `recentReports` (20 samples, 20 minutes). `public/meeting-forecast.js` uses the same newest usable Emily/Jeff report as the main summary, along-route pace and remaining route distance. The forecast scenario allows 5% extra min/km per future hour; validated observed slowing may increase this to at most 15%/hour, with future pace capped at 1.5 times current min/km. The displayed planning range spans constant current pace to this conservative scenario. These are explicit planning assumptions, not a confidence interval or a physiological prediction. Future extra stops are not included. Estimates are anchored to the GPS report time and rounded to 5 minutes nearby or 15 minutes beyond two hours. Missing/stale/off-route/stopped reports never get a fabricated ETA.

Shared checkpoint updates use a compare-and-swap on the metadata envelope, preserving GPS and celebration updates. Repeated group completion/skip is idempotent. Undo restores the last explicit stamp only while the corresponding next meet-up is still current. The browser prevents a queued local plan choice from overwriting that advancement. Met and Skipped stamps remain distinct from the fixed Passed record for Coventry.

## Walking with Emily · map-only position

If a supporter (Jeff, Huiyan, Graham or Ben) selects **Walking with Emily**, both the runner and supporter map views show that supporter’s avatar anchored to Emily’s latest **fresh official tracker** coordinate. The avatar says “With Emily” and “Tracker”, and the location sheet explains that this is an inferred co-location from a shared plan, **not** a GPS fix reported by the supporter’s phone. The poster people strip uses the same source label. The app does not copy this coordinate into supporters’ real GPS records, start phone sharing, or change sharing permissions. If Emily’s tracker is stale/unavailable, the supporter returns to their own reported phone position if available, otherwise to “Awaiting location”. Setting “Meeting at next stop” also returns to own-phone positioning. Shared plans are not independent verification of proximity.
