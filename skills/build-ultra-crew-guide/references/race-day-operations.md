# Race-day operator runbook and diagnostics

This is an operating procedure for an actual 24-hour crew run. Keep a **manual independent contact plan** in case the website or phones fail. Never use the guide as a safety-critical dispatch system or treat its ETA as a guarantee. Times should be displayed in the event's named zone.

## Contents

1. T-minus and live-start checklist
2. Daily use and handoff
3. Diagnostics by symptom
4. Recovery while preserving state
5. Security, safety and close-down

## 1. T-minus checklist

### Several days before

- Confirm route KML/GPX source and correct direction; 2025/other-year route is *only a planning reference* unless current run actually uses it. Verify numbered pins, nearby town/place names, access restrictions, EV charger and WC hours with dated sources.
- Confirm official tracking event ID/year/url and each **exact bib**. Check prestart roster behavior. Show privacy notice to entire support crew: shared positions visible to permitted audience; no background phone GPS while locked.
- Set selected route goal and stretch endpoint, enough researched *actual meeting points* after nominal finish. Remember gold ring, if relevant, may be crow-flight distance, not route km.
- All milestone artwork unique and preview-approved; manifest assets present, original seen posters preserved, unopened future art hidden.
- Configure fresh room/hash codes/expiry; privately deliver separate public guide, publisher invitation, and limited supporter recovery code. Do not send secret publisher link in large group chat or public share CTA.
- Run all automated tests and dry-run with **synthetic tracker** in isolated preview, never shared production room. Verify rollbacks are available. Cache version bumped after asset changes.

### At crew briefing / start

1. Each phone opens *ordinary* guide URL and saves offline guide/notes while online; check map and route load.
2. Publisher connects by secret invitation, confirms role and correct event; does not automatically share phone position.
3. Each named supporter connects own phone via permitted publisher/recovery setup, selects their own identity and tests **Update once** deliberately. Explicitly agree if automatic 30-second visible-page sharing is desirable, emphasizing screen-on requirement.
4. Agree next and Then meetup with landmark and road/pedestrian instructions, not just pin number. Confirm legal/safe vehicle location in person. Keep direct call/text fallback.
5. Confirm tracker statuses; no position yet prestart is normal. Do not assume a wrong bib from a cached 2025 roster.
6. Open at least one WC / charger result and inspect access hours. Do not rely on a generic “open” badge for live facility status.
7. Rehearse Met/Skip/Undo only in isolated demo room. For production, first actual shared action occurs after genuine meetup/skip.

## 2. The normal 24-hour operating cycle

### On foot with runner

- Set the appropriate person's plan **Walking with runner**. Map labels their position “With Emily · tracker” (or new runner name) when the official feed is fresh, not as their separate GPS. If phone GPS sharing already active, their real own fix remains independent in D1; on-screen co-location is a planning inference.
- Check last official tracker report time, actual report age, route progress, and ETA range to selected meet-up. If runner rests or is off-route, ETA may become unavailable; avoid rushing the vehicle based on fake extrapolation.
- If another walker takes over, switch each plan explicitly; do not assume all supporters walking or meeting in the same place.
- After a long rest, don't infer walking pace by averaging the waiting time with the first few resumed steps. The guide starts a new moving window once it can corroborate genuine forward GPS progress. If it still says pending, keep direct contact with the walking team rather than assuming the stale late ETA is the new arrival time.

### Category podii, informal overall comparison and family-only competitor map

- Open the dedicated **“We are not competitive”** bottom tab (also reachable through Tools); the map itself has no leaderboard controls, general category legend or tracker-age chip. Female Solo is the default; use the category select for Male Solo, Pairs, Chained or Other. Toggle **Emily amongst everyone** to see her *informal* position among all race entrants on the same crow-flight scale, including mixed team/solo classes; it is not an organiser-approved award or proof of who is ahead on the road. The first three in the selected view appear on a playful podium; **gold/first is taller than silver/second**. If Emily is among the top three, her animated illustrated avatar replaces the crow on her own step. All podium entrants remain colourful, even if their report is old, and report ages must be respected.
- The map draws **only competitors the family has individually followed AND set to Map ON**, with official GPS fixes younger than five minutes. There is no “show all female solo” overlay, even on phones with a previously saved setting. Matt #210 starts followed and visible; his Map checkbox can hide his marker without removing his statistics. Search a name/race number to follow up to eight individuals. Choices persist **on this phone only**, not automatically on Jeff's or Graham's.
- The podium and followed cards distinguish **Dropped out** (organiser `retired` flag), **Finished** (`finished` flag), **Still in race** (fresh live position without those flags) and **Still entered** (not confirmed withdrawn, recent GPS unverified). Non-retired people silent for **more than one hour** may show **Likely out** as a *provisional* supporter interpretation—not an official dropout. Keep podium entrants colourful even if old or retired; grey suspected-out/retired people in the lower list only. Tap an individual followed competitor marker to open their card. Do not infer a chase route or pace from crow-flight standings.

### Route and crow-flight distances

- The main map presents the runner's **planned on-foot route progress** alongside official **crow-flight progress** (or clearly marked approximate/current GPS or last-reported score). Neither is automatically the watch's actual distance travelled; avoid comparing them as if they were the same measure.
- Every actual mapped meet-up has two **cumulative totals from Meriden**: planned route km to that point, and approximate radial crow-flight km to that pin. The latter is a meeting-planning calculation, not official tracker scoring. The separate “km ahead” on a point sheet means remaining route kilometres, not either total. Use “unavailable” for an unmapped choice; don't invent a zero.

### Vehicle crew

- Select the next agreed point (number + town + landmark). “Drive to pin” uses the chosen verified coordinates. Reassess public parking, vehicle range, approach from running route, crossing risk and WC/EV alternatives; map source is a planning aid.
- Use **earliest** end of arrival forecast as a proactive planning reference (and expect possible earlier arrivals). The later end represents a conservative slowdown scenario, not a time by which runner will certainly reach you.
- At physical reunion select **Met here → Next stop** once. If intentionally bypassed, **Skip**, then Next. Use **Undo** immediately if a mistaken tap and next selection hasn't advanced further; avoid conflicting simultaneous edits by two crew phones.
- All participants see same checkpoint stamp and next/then plan after D1 sync. Do not manually force a point passed because tracker briefly projects just beyond its route km.
- When handoff from one driver to another (2026: Huiyan/Jeff to Ben around point 12), connect their phone, select personal supporter role, explicitly start sharing if agreed, and stop old driver's session; no stale identity reuse.

### Milestones and morale

- Tracker-derived crossing saves to central achievement ledger. New valid release triggers animated poster only once and makes history replayable. The user may show the already-released poster in person; do not use editor preview as an alternate release.
- If the whole crew was offline and several thresholds accumulated, show the latest celebration without spamming; earlier reached images stay in “Moments & milestones”. Historical 50/60/70 art remains original.
- Any official award/gold claim should be reconciled with organizer result if its policy requires confirmation; a computed crow-flight ring is a planning indication until confirmed.

## 3. Troubleshooting decision trees

### A. “Waiting for tracker” though official tracker updated minutes ago

1. **Check exact GPS `recordedAt`** in `/api/tracker?bib=...`, not page reload time, server response time or upstream “last activity” `sendTime`.
2. Confirm `GET` returns `live` and the exact correct race event/date/bib; if `wrong-event`, `event-not-current`, `not-found` or `ambiguous`, fix upstream event mapping/registration only after verifying official source.
3. If recent current fix but **no route pace**, inspect `recentReports` and `paceReports`: need multiple plausible time-ordered fixes showing **net forward route movement** on planned route, recent enough and not off-route by >=500m. Standing still, tracker path lag or repeated identical fixes honestly yields no ETA.
4. If source path API contains valid fixes but the adapter does not, test server upstream path fetch, timeouts, recent 20min/2h bounds, timestamps and GPS shape. Don't convert `sendTime` into `recordedAt` or quietly substitute leaderboard speed.
5. Inspect selected runner identity and last valid fix; one runner with newer fix and no usable pace may cause a fallback to another *only if* latter has complete valid own data. Individual runner sheet stays independent.
6. Inspect route projection and current selected meet-up `routeKm`; ensure goal extension and `milestone-route.json` geometry match current `route.geojson`. Wrong route = apparent off-route or no movement.
7. Confirm client got latest `/api/tracker` and `/api/crew` responses while **visible**; if offline/stale, use Update/reload guide or reconnect, but never re-stamp historic fixes.
8. After diagnosis present precise reason: stale (>5m), path missing, no forward movement, off-route, finished/retired, future timestamp, event mismatch, or upstream unavailable. Do not label an impossible ETA “fixed”.

### B. Page suddenly shows Point 1 / everyone disappeared

1. Confirm signal and loading state, wait for async shared-room/tracker fetch. A slow internet screenshot may show pre-hydration placeholders even though real plan exists centrally.
2. Open a second phone on ordinary guide URL. If second is correct, likely local connectivity/cache; don't recreate room or overwrite central next stop.
3. Check `/api/crew?public=1` `status` waiting/active/ended, selected checkpoint/receipt and person position timestamps. Ended/expired/revoked cannot be fixed by reusing old code.
4. If active backend is correct, inspect client local storage keys/event namespace, service worker stale files, current build version, and failed fetch. Update/reload guide (preserve preferences) or change network. **Avoid clearing storage while sole publisher** without retaining private setup capability.
5. Check `confirmedPassedPointIds` and already Met/Skipped logic. An unhandled pending fetch must not default chosen point to the first map marker and publish that fallback.
6. If backend truly reverted, stop all writers, compare D1 row/update timestamps and recent deployments; restore last verified state through tested UI actions or a carefully verified admin repair, not speculative replacements.

### C. “Milestone poster missing / celebration lag”

1. Check official tracker has corroborating plausible recordedAt GPS fixes beyond **correct threshold**; one point past line is not enough for future poster.
2. Check `lib/race-milestones.ts` event whitelist, route vs crow metric, threshold and participant eligibility; award may use radial 60mi, not 100 route km.
3. Check ledger `persisted` and D1 public room active/unexpired; a transient `persisted:false` must not be called released. Check `releases` for exact ID and recorded `releasedAt`.
4. Check `public/data/poster-manifest.json` has a unique ID and real `preview` + `download`; verify file status and service worker cache version. Do not manually trigger poster release to compensate for network delay.
5. Check old poster visibility under “Moments & milestones”, intro overlay and dialog blocking queue, acknowledgement/seen local key and offline mode. A history poster may be available even if popup was already dismissed or missed.
6. Preserve original 50/60/70 references; if the wrong newer art shows, fix manifest mapping and preview cache, don't rewrite historical crossing.

### D. Supporter avatar shows “Awaiting location” / co-location wrong

1. Check person selected correct identity on own phone, publisher/location grant active, sharing permission granted, and actual **fresh GPS acquisition acknowledged** by server. Viewing as Supporting is not permission.
2. `Update once` tests explicit phone geolocation; auto every 30s only while foreground/visible. Screen locked ≠ background updates. Check browser permission and expiry.
3. Check shared `supporterPlan`: `walking` shows inferred placement at fresh named runner tracker with “With runner · Tracker” note; `meeting` returns to own phone GPS. If runner tracker stale, use own GPS if present, otherwise Awaiting.
4. Stop/Pause semantics: Pause keeps original last fix and timestamps; Stop removes and clears auto intent; browser reload never auto starts again. Another supporter's Stop must not be undone by your old tab resuming.
5. Never use old Google Maps share URL as GPS or assign Graham's position to Ben. If setup code lost, connect using **limited** recovery grant through owner, not by copying publisher token publicly.

### E. ETA is absurd, stale or dangerously optimistic

- Verify fixed event date/time zone, report timestamp not delivery, precise route geometry, selected runner, correct next stop routeKm, route distance remaining, pace history from same runner.
- Check off-route threshold, trend slowdown cap, future stops **not included**, clock rounding. “Earliest–latest” is conditional planning, not a guarantee. A tracker can miss a fast runner; be at location early and coordinate separately.
- Never calculate by dividing crow-flight leaderboard total by elapsed hours or assume fixed 7:00/km because route pace unavailable. Suppress ETA and explain.
- If ETA suddenly moves hours later while Emily rests: check the original GPS path. A >=2min plateau of <~20m route advance should end the old moving pace window; after resuming, wait for two credible forward intervals over >=2min and ~80m before deriving new moving pace. A report gap >5min also starts a new window. Time stopped or without GPS must not be divided into walking speed. An old pace is only a **clearly provisional** fallback if no stop is proven and current GPS is fresh and on-route; do not hold it through an actual rest.

### E2. Female-solo ranks or map people seem wrong

1. Check `/api/leaderboard?follow=210` returns `status:live`, `metric:crow-flight-km`, expected date and `event.active`; the server validates numeric event 35950 and its 2026 identity in the original site. If the event changed/inactive, do not reuse previous locations.
2. Confirm source `group:"Solo"` and `ageCategory:"F"` for Emily #247; a `Pair` or `M` must never enter the female-solo list. Sort by `routes[0].dist`, not on-foot km or route speed. The rank/gap is *provisional* because sample ages differ.
3. Compare individual `updatedAt` against actual clock: only <=5min valid GPS is current; individually followed stale fixes may remain explicitly last-known. A new HTTP response or stalled signal must not restamp an old GPS fix. Retired and finished statuses are labels, not evidence of recent movement.
4. On each phone, check its Following list and per-person **Map** tick; do not restore the retired category-wide map switch. Matt's visibility may be independently off. The app stores settings locally, never in D1. If needed, use the guide's update/reload; do not clear the sole publisher's storage/capability.
5. If the rank seems physically wrong, verify the event's scoring rules and report times at the official tracker; a straight-line ranking is not permission to assume someone is reachable at a particular road junction.

### F. Toilet/EV driving times or open statuses wrong

- Verify actual facility identity, source and WC-specific hours; weekday, midnight crossing, arrival window +10 min. 24h fuel does **not** imply 24h toilet.
- Confirm active shared car position fix younger than 5m, supported curated WC ID, OSRM/FOSSGIS status and D1 routing cache/lease. Provider unavailable → driving time unavailable, not crow distance.
- Source can be out of date (construction, charger faults, toilet closure); show caveats, use vehicle navigation/local signage before taking action. Avoid repeated public routing requests: browser view rate and provider gap are intentional.

### G. Offline/reload confusion

- Guide saved offline ≠ downloaded live maps and GPS. Saved route, selected notes and previously allowed art may load, but OSM tiles and `/api` cannot update without internet.
- Check app service-worker version after asset deployments. Settings “Update / reload guide” refreshes shell; do not run destructive cache purge of private capability/local notes casually. New version does **not** restart phone sharing.
- If front/back navigation from maps/app switch loses updates, re-open and trigger visible refresh; ensure no duplicate timer shares an older GPS fix.

## 4. Recovery protocol for live changes

During the race, prefer **narrow reversible fixes**:

1. Read live state, current source version and deployment version; record what is known, which devices affected, next physical meet-up, tracker last actual timestamp and room expiry.
2. Do not edit route data, event IDs, D1 schema or poster release logic just to hide a missing-data condition. Start with diagnosis and source evidence.
3. If changing code/data is truly needed, make a working copy, patch minimal source, run relevant plus full automated tests, build and phone preview. Avoid touching logged events/person locations.
4. Confirm deployment is within the owner’s current authorization and avoid interrupting a physical runner meet-up. Deploy one version, note version/time. Verify anonymous viewer + publisher views from actual phone and official feed.
5. If regression, return to **last verified site release** via supported rollback, not destructive database reset. Check D1 state before/after; code rollbacks do not necessarily roll back database schemas.
6. Communicate backup route/checkpoint directly to the crew if page is unreliable. Never give unsafe confidence just because UI looks healthy.

## 5. End of race

- Confirm last official result separately and update status without retroactively changing earned art/history. Gold and radial achievements may need organiser verification.
- Save approved celebratory history/poster downloads/photos if user wants them, with participant permission. Export only non-sensitive event summary by default; never export private GPS history (none should be retained).
- Stop all phone sharing. Revoke room or let fixed event expiry scrub current locations, bib, meet-up and release contents as designed; verify stale capability cannot reactivate tombstoned room. Keep art/history only with consent and privacy plan.
- Make a concise incident log: route/pin errors, provider path gaps, room or cache behavior, art mapping mistakes, feature requests, and concrete tests to add before next ultra.
- Preserve the original site as a memento if the user chooses, while making new event a separate deployment with new identities, local keys, tokens and data.
