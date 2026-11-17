# Complete behavior contract (including the nooks and crannies)

This is the acceptance specification for a future ultra adaptation. Retain function, not necessarily the literal 2026 person names or event branding. Any deliberate omission requires owner approval. Source references refer to Crow Crew v57.

## Contents

1. Role/mode and homepage
2. Maps and route
3. Tracking, pace, ETA
3a. Event category leaderboard and competitor following
4. Supporter plans and GPS
5. Meeting lifecycle
6. Facilities and travel
7. Moments, intro and posters
8. Offline, errors and access
9. Regressions to prevent

## 1. Role/mode and homepage

| Behavior | Required result |
|---|---|
| Anonymous entry | Ordinary URL opens a useful read-only guide immediately; no sign-in, capability or location request. |
| Mode | Runner/Supporting switch changes UI and available sections; it **does not confer write access**. Keep mode across reload and preserve current map. |
| First-screen summary | Large route distance to next agreed point, readable name, next-then summary, ETA/status, runner progress. Do not overfill or hide map. |
| Two layouts | Main warm cream/teal guide, optional bold red/navy poster screen. Both use identical APIs, map logic, milestones, roles, shared room and local preferences. |
| Small phones | 375×667 / 390×844, safe-area padding, 44px+ interactive targets, compact header/dock, 18px+ key texts and 28px+ progress/44–52px distance. No accidental overlap with marker labels. |
| Live clock | Event start/end local time plus countdown/elapsed; separate from tracker receipt freshness; never label prestart as current run. |
| Sharing | Public share action strips publisher/recovery fragments; never send those through clipboard, query string or referral. |
| Notes | Local crew notes/checklists and race number settings persist appropriately without overwriting server plan. |
| External navigation | Drive-to-selected-pin launches map/navigation for actual chosen stop, not generic route milestone; page remains usable on return. |

## 2. Map and route

- Route polyline from actual imported GPS track; show start, end/reference, route-km milestones, real meeting options and user-selected next point. Keep **route km separate from award crow km** in labels.
- Main map is first-class, not a miniature below cards. Leaflet + OpenStreetMap tiles with attribution. The actual route and markers render even if live data is missing; never show fictional live positions.
- Runner map automatically frames the runner and **one next** useful meetup, not 23 pins. Supporter mode can show upcoming, **All meet-ups**, full route, nearby chargers, cafés/parking and toilet filter. Distinguish upcoming primary vs optional alternatives.
- Next/Then advancement excludes already Met/Skipped, fixed confirmed-Passed and earlier route options. Keep full-route pins for reference. Automatic advancement may suggest next stop but does **not** assert that crew met or override explicit selection.
- Original mapped coords stay fixed; route proximity is displayed as a separate projection/offset. Directions go to actual pinned meeting option. The source map may be historical, not a guaranteed current running line.
- Point card labels: point number, town/locality, landmark/mapLabel, nearbyLabel, route km, practical `meetingNote`, source freshness/uncertainty. No bare “Point 18” placeholders, no invented car park opening guarantees.
- Touch marker opens detail, person cutout opens source-specific sheet. “Re-centre map” resumes auto-follow; user panning pauses it. Explicit re-centre works even if already roughly centred. Focus/toilet view offers “Back to meet-up”. Zoom does not make labels illegibly small.
- Show exact GPS dots with nearby portrait stems; compact collision handling when people share coordinate. People whose location is missing remain in the fixed strip as **Awaiting location**, never defaulted to a course start or other supporter's fix.
- Optional fun separate rival pin (e.g. Matt in 2026) only from its own official bib. Map “Everyone” may include rival; routine follow does not reframe to distant rival. Never use rival to calculate primary pace/ETA.
- Give the leaderboard one **dedicated bottom-dock tab**, in both Runner and Supporting modes and both visual shells (2026 label, including quotation marks: **“We are not competitive”**). Remove competing floating leaderboard buttons, the general competitor legend and the map-level “updated x minutes ago” chip to preserve map visibility. Keep the recenter and adjacent All-stops pills at the *bottom* of the map, source-specific report ages inside sheets. Keep **only independent followed-competitor Map switches** inside the leaderboard sheet; a previously saved broad category overlay must remain disabled. Within that sheet, offer Female solo, Male solo, Pairs, Chained and Other category options and a separate toggle for **Emily amongst everyone** (an unofficial crow-flight comparison, never a cross-category award). Render **top three of the selected view** on gold/silver/bronze podium steps with original hand-drawn cheering crows except for Emily's own animated portrait when in the top three, celebratory expressions, status badges and report ages. The **gold/first step must remain visibly taller than silver/second**, even with Emily animated on silver. The **rest of the selected category or all entrants** appears beneath with participant name, category label for overall, distances, statuses and optional valid moving pace. Do not show fake ranking before an authenticated current event feed or after event-identity mismatch. Individually followed-and-enabled bibs have crow pins: live (<5min) is normal and optionally shows verified recent moving pace; older GPS is a **ghosted last-known crow** with source age, not a claim to present position. Include a Locate button to pan to the saved last-known coordinate. Add click/tap and keyboard access. No map competitor swarm.

## 3. Official tracker and ETA

| Situation | Display and logic |
|---|---|
| Before runner appears on event roster | “Waiting for first report”/registered state, not a placeholder coordinate. |
| Multiple participants | Exact event + year and exact bib/name match; each has independent GPS/time/status/pace; summaries name their chosen runner. |
| Tracker updated but no route pace | Show last real fix and route progress if valid; ETA says waiting for enough **recent moving route fixes**. Distinguish HTTP refresh from original GPS record time. |
| Latest fix no suitable pace, other runner valid | Main ETA may explicitly use the other runner's self-consistent actual fix and route pace. Individual cards never mix them. |
| Newer delayed data | Do not let an older GPS timestamp regress a more recent fix. No false refresh age when server polls stale upstream report. |
| 5+ minutes old | Mark tracker stale, suppress ETA; history and last seen may remain labeled. |
| 500m+ off route | Suppress projected route ETA; show off-route warning rather than straight-line shortcut. |
| Waiting/stopped/retired/finished/implausible jump | Clear explicit status; never invent speed/arrival or perpetually count down an expired estimate. |
| No coherent history | No arbitrary default pace, no official crow-speed substitution. |
| Valid moving route pace | Forward planned-route distance / real moving GPS elapsed time. A corroborated stationary plateau (>=2min within ~20m of route progress) ends the old window; restarting requires >=2 genuine forward intervals after the plateau. A >5min reporting gap resets the pace window too; never divide movement by unknown dropout time. Validate GPS sequence, require sufficient samples and plausible speed. |
| Just resumed from a stop | The old stop-inclusive slow pace must not delay every later ETA. Wait for two forward intervals over >=2min and >=~80m since stop; until then label pending, never invent resumed pace. |
| Sparse reports without proven stop | A runner's **own** previously verified GPS-derived route pace can be held provisionally for a short bounded window with a fresh on-route position; never borrow another person's pace or an organiser crow-speed. Verified stop, stale fix, invalid segment or prolonged gap invalidates carry-forward. |
| ETA clock | Anchor to fix's `recordedAt`, use remaining route km, Europe/London/local event timezone, five-minute rounding nearby; range for fast unchanged pace to slower forecast. Earliest time is planning anchor; no redundant “Be ready by” line. |
| Forecast limitations | Explain trend/slowdown assumption, no future extra stops, potential faster arrivals; not a statistical confidence interval. |
| Meet-up changed | Recalculate distance/ETA against new selection without changing tracker or causing celebration. |
| Gold/award | Use organiser's specified radial distance from origin and official verification, not nominal `100 km` route milestone. |

The common original “waiting for tracker pace despite a tracker update three minutes ago” is *not automatically a bug*: one current position cannot establish recent progress, the path API may lag, route offset may fail, runner may be stopped, or report time may differ from HTTP time. Provide a visible diagnostic (latest fix, path samples, elapsed progression, projection offset, selected runner, estimate reason) so operator can distinguish legitimate insufficient history from a failed path adapter. See operations troubleshooting.

### 3a. Official event category leaderboard and competitors

- The read-only event adapter uses the same **verified event ID, slug and 2026 start date**, then filters roster records by exact organiser fields (`group === "Solo"` and `ageCategory === "F"` for Emily). Never guess gender/category from names or infer from paired entries. Preserve a separate searchable roster for user-chosen follows across categories (Matt #210 is a male-solo example).
- Sort the female-solo table by official `routes[0].dist` **as-the-crow-flies km**, not route kilometres travelled, average speed, or predicted finish. Label **provisional rank**, category size, next competitor and numeric crow-flight gap, with each person's original report time and state (finished/retired/stale). Reports may differ by hours; standings are neither a verified awards list nor proof of which person is physically ahead on the same road.
- Server `GET /api/leaderboard?follow=<comma-separated exact numeric bibs>&category=<female-solo|male-solo|pair|chained|other|all>` returns the original `femaleSolo`, searchable `roster`, separately `followed` people, and an `allCompetitors` array sorted by the same organiser crow-flight km regardless of category. The new all-entrant array returns sanitized names, bibs, category fields, scores, status, age and **`hasValidLocation` only**, never bulk location coordinates; only `femaleSolo` and explicitly followed participant objects may expose validated lat/lng. **An all-entrant rank is an unofficial comparison, not an overall official award.** Optional recent moving-GPS pace (`paceMinPerKm`, `paceAsOf`) requires a bounded fresh path lookup, at most eight fresh followed/Emily/viewed-category athletes; no average `routes[0].speed`, path history, private tracker/device fields or source secrets. Follow list limited to eight; reject invalid categories, malformed bibs and duplicate bib ambiguity. If event inactive, changed or upstream unavailable, preserve honest waiting/error state and never substitute old race GPS.
- Client `public/competitors.js` persists its follow/map choices **per device** under an event-specific local key; defaults Matt #210 followed and visible. A legacy category-overlay preference must be ignored and reset OFF. Poll on visible pages, retaining last known data with **unchanged original report times** during transient outages; provide name/bib search and an independent Map checkbox plus Unfollow for individual selections. Do not join an external tracking team, change user GPS permission, write race room/D1 or reveal private location capabilities.
- The **only** other-competitor map markers are explicitly family/spectator-followed bibs whose individual Map checkbox is on and whose official GPS coordinate has an authentic original timestamp. Do not hide a chosen followed person for GPS age alone: render last-reported position as a **faded crow with the visible words Last seen [age]** and accessible uncertainty, do not make it look live or change map auto-follow/ETAs. No map-wide female-solo/category toggle, category marker swarm or category legend; remove obsolete map controls from both guide shells. Avoid double-drawing Emily or Matt in the competitor layer; the distinct optional rival presentation is independent. Show a followed-person **Locate last known spot** control to find out-of-viewport birds.
- Use hand-drawn crow pins with bib labels, readable accessible labels, family follow styling and optional ~m:ss/km **recent moving GPS** bubble for active people only; a stale competitor must not retain a previously measured pace bubble. In the **“We are not competitive”** bottom tab, default to Female Solo standings and allow exact Male Solo, Pairs, Chained and Other categories; the separate **Emily amongst everyone** toggle displays her own provisional overall crow-score position and a full mixed-category list clearly marked **unofficial**. Do not mix everyone's markers into the map. Render three-place podium of the currently chosen standings with **first step taller than second**, Emily's illustrated portrait `assets/avatars-v5/emily.webp` in whichever podium position her bib occupies and a gentle bounce/sparkle respecting `prefers-reduced-motion`; cheering crow art on others. Show category-specific or mixed-category list rank four onward plus separate family-followed list/search.
- Render explicit status badges using organiser `retired` and `finished` flags: **Dropped out** and **Finished** distinct from **Still in race** for fresh unretired entrants. For a silent non-retired tracker **over one hour**, label **Likely out** with explicit caveat that GPS silence is not an official withdrawal; exactly one hour or less with no fresh GPS remains **Still entered**, unconfirmed. Exclude presumed-out from the informal next-rival shortlist, not from the provisional official ordering. **Keep the three podium steps/crows colourful** even when old or retired, but grey/soften those racers in the lower standings list. Report timestamps and uncertainty context remain visible.
- Progress on the main map displays a **planned on-foot route progress** stat and a distinct **crow-flight progress** stat. Prefer verified official event score for the latter; if absent, derive approximate radial distance from a fresh Emily fix and label it explicitly; stale official scores must say last reported. Do not overwrite one stat with the other or treat the planned-route estimate as GPS watch distance.
- Future events may have different category fields/award rules; inspect source API, request owner-selected category and rival defaults, and document provider score semantics before coding. Do not reuse hardcoded 2026 bibs and event ID.

## 4. Named supporters, handoffs and phone GPS

- All named supporters may switch independently between **Walking with [runner]** and **Meeting at next stop**. Changes are shared across the family. A supporter can change roles mid-run without redesigning the site; in 2026 Graham was on foot, then Huiyan could replace him, then Ben took the support car.
- With “Walking with Emily”, the supporter's avatar appears at **Emily's fresh official tracker point** with **“With Emily · Tracker”** attribution and explicit note: inferred co-location by declared plan; **not** independent phone GPS. This applies to runner and support map and people strip. If Emily's fix stale/missing, fall back to own explicitly shared phone position or Awaiting; if supporter switches to Meeting, revert to own phone location.
- Separate supporter records for each person. A phone's missing fix does not borrow another supporter's fix, even if they share a vehicle. Fresh person GPS reports have source, accuracy and original recorded timestamp; status reflects Sharing/Paused/Last seen/Awaiting.
- View/toggle/person tap/activation **never starts location sharing**. Only explicit person action **Update once** or **Share now & every 30s** requests browser permission and fresh geolocation. Denied permission is shown, not silently bypassed.
- Start auto sharing does an immediate fresh fix, then approximately 30s while the page is **visible and unlocked**. It pauses hidden, fresh-acquires after visibility return or bfcache restoration. There is **no guaranteed background GPS on a locked iPhone**.
- Never overlap acquisitions/publications or re-send old fix with new timestamp. Only server acknowledgement of the **actual fix** updates status. A manual Update now within auto sharing preserves its session; manual one-shot alone never enables auto.
- **Stop** clears intent and sharing; **Pause** preserves last genuinely recorded position and its age. A reload requires fresh explicit Start. Remote Stop by another phone must not be undone by local visibility resumption.
- Supporter has accessible **Connect this phone** recovery flow using limited `#locate=` or code without replacing main publisher; remove capability fragment immediately. Recovery grants cannot alter arbitrary meet-ups or release surprises.
- Legacy Google Maps share URLs may be stored for compatibility but are never interpreted as API GPS, nor linked as a fake position. Legacy `/crew-location` routes into on-site controls.

## 5. Meetings and team coordination

1. Primary and Then point are selected by actual route order, with a clearly identified agreed meet-up. Group alternatives share one number; avoid moving one group's two options into separate sequential tasks.
2. View/automatic progress does not change shared confirmed status. Supporters may choose a listed point and optionally add researched EV alternatives. Unverified arbitrary car pins cannot be created through limited recovery grant.
3. **Met here → Next stop** atomically stamps Met and advances to next distinct group. **Skip** stamps Skipped and advances. Completing one alternative marks its unused sibling Skipped. No accidental repeat advancement on double tap/retry.
4. **Undo** restores the last explicit action only while the corresponding next point is still current. Keep latest receipt visible; prior hidden undo history is not leaked to public. Use CAS to preserve concurrent poster and GPS writes.
5. Manual planning can switch crew between waiting, walking, car support, charging and restroom stops; changing the supporter plan does not publish their device GPS.
6. Manually confirmed Passed (e.g. the original Coventry first stop) is distinct from live `Met`/`Skipped`. It skips planning but never manipulates runner distance or crossing ledger.
7. Driver's next and then places include original map pin, town, recognizable nearby landmark, exact location description, access caveats and route km. Include source hyperlink and verification date. Point pin is not proof of safe parking, opening hours or pedestrian access.
- Every actual mapped meeting-point card (runner next point, supporter next point, all meeting options, pin detail, map point sheet) displays **both total planned on-foot route km from the start** and **approximate crow-flight km from the race origin**. Prefer the route's known planned cumulative km and a WGS84 haversine from the verified origin to the actual meeting pin. Show missing/unmapped origin or coordinates as unavailable, never 0.0 km. Distinguish these total distances from the remaining distance/ETA to that point.

## 6. Facilities, charging, driving and walking

- Search curated facilities by actual location and route order; WC action opens **ahead on next ~20 route kilometres**, even if current crew meet-up is elsewhere. Show named toilets, distance to route, access notes and hours source; alternatives if likely closed.
- `toilet-hours.js`: evaluate **entire ETA window plus ten minutes** against advertised weekdays, midnight spans and date exceptions. “Open at ETA” if toilet-specific verified hours; “Likely open · check WC access” if only venue hours; unknown/conflict remains uncertain. No assertion of live door availability.
- Runner facility ETA uses selected runner's same route pace plus labeled approximation for walking from route. Supporter facility ETA uses **drive if leaving now** from shared crew position <=5 min; one batched OSRM/FOSSGIS road-time matrix, with 0–5min arrival/parking allowance. No route or provider failure means **no drive ETA**, not guessed crow flight.
- Curated EV points include operator, connectors if known, current advertised hours, uncertain access, exact/approximate coordinates, proximity to running route, source URLs and **optional** meeting status. Selecting EV alternative must be explicit; listing nearby charger does not change meet-up.
- Nearby café/food/parking/open hours must be marked by source and checked date. No promise of public WC simply because a petrol station is open; don't route a tired runner into an unsafe crossing based on a screenshot.
- Driving navigation may hand off to Apple/Google Maps but should not replace on-site real person sheet or GPS controls.

## 7. Celebrations, poster history and intro

- “Moments & milestones” merges route targets, achievements and memory posters. Completion comes from event tracker evidence, not manual tapping or a poster URL.
- Every milestone card shows **On foot · planned route (approx. route km)** and **as the crow flies from official race origin (approx. radial km)** separately. Do not label a route-km goal as a crow-flight award or vice versa.
- Person row displays tracker-derived crossing moment, approximate time (`~`), GPS evidence (before/after bracket, estimated interpolation/backfill), or explicit pending pace. If only first reported point is beyond boundary, mark exact crossing time unknown.
- **Two plausible fixes beyond a future poster milestone** before unlock. Persist to shared D1 ledger and release list; avoid false one-fix jitter. Gold may be an organiser-specific crow threshold; show award separately from route-km milestone even when spatially adjacent.
- Future artwork is invisible in runner mode, not in initial cache. A crew-only preview must not invoke release. Released images in manifest have preview and original download; show “Enjoy this moment again ♡” without duplicate “Open posters” control.
- **Late catch-up**: don't spam multiple full-screen modals. Show newest queued celebration; earlier legitimately released posters remain replayable in history. Previously seen crossings do not replay on reload/poll; opening intro defers, not discards, valid pending moment.
- Finite crow/crown/toast/heart animation, close/skip and `prefers-reduced-motion` implementation. Posters should have unique location and humorous copy; see artwork reference.
- Intro: silent compressed phone-oriented sequence, Skip immediately, Pause/Resume, reduced-motion static Open map, one-time local seen flag and replay in tools. Real map is mounted first; intro fail-open on missing/slow assets. Intro must not clobber selected role/map/room/tracker or unlock any milestone.

## 8. Offline, performance and access

| Case | Expected behavior |
|---|---|
| Poor signal / prior screenshot of reset to point 1 | Show saved guide/route/current *last known labelled* state; never overwrite current state with a default point because API hasn't arrived. Wait/retry, display honest waiting or offline. |
| Offline save | Core HTML/CSS/JS, route, notes, already permitted poster thumbnails/downloads available as designed; **not** live API feeds, street-tile bulk downloads, tokens or future surprises. |
| Service worker update | Bump cache name on asset changes; network-first shell, bounded fallback; Settings “Update / reload guide”; preserve local settings but require explicit new GPS Start. |
| Request delays | Bounded provider timeouts and race refresh, visible offline/stale reasons; UI remains tappable. |
| Revocation/expiry | Live room switches to ended, removes location/meet-ups/poster credentials per policy, cannot silently activate old room. Public guide still loads. |
| Security | Capability fragments removed, no secret in public links or logs, server origin/key validation, no API caching, private no-store response, no future poster link in public HTML. |
| Accessibility | Real buttons, ARIA labels, opening sheet states, keyboard focus, WC/runner labels, readable contrast, reduced motion, mobile safe areas. |
| Source truth | Latest valid official report; last known values may remain visible only with original timestamp and clear freshness labels. |

## 9. Regression list

Keep a test for every one of these previously observed failures:

- 60/70/50 posters replaced by generic newer drawings; original era-specific originals must survive.
- All 80–123 posters accidentally display identical artwork, location, town, crow or tagline.
- “Open posters” duplicates “Enjoy this moment again.”
- Support points 18–23 have only number/distance with no actual town/landmark/meeting note.
- The map briefly resets to the first stop while slow network loads, or supporter avatars disappear and never recover.
- Tracker updated a few minutes ago yet pace absent: inspect coherent path/projection and correctly surface reason rather than pretend a pace.
- Celebrations lag behind crossing: online provider/durable ledger/release/acknowledgement paths each observable and independently retryable.
- Changing roles or returning from map causes GPS to auto-start, restart or adopt stale time.
- Walking-with-runner supporter appears to have independently tracked GPS instead of clearly attributed inference.
- Estimated ETA uses a slower/later time as the single deadline, or hides its faster bound.
- Crow-flight leaderboard average used as walking pace; 100 km route shown as official 60-mile gold.
- Female-solo leaderboard includes Pair/Male entries, uses a stale update to manufacture a current rank, or auto-shows 36 people over the small crew map. Individual follow/map preferences overwrite one another or trigger phone GPS.
- A freshly resumed walker displays a stop-inclusive pace and ETA hours too late; one new post-stop GPS fix invents a new moving pace; a >5min report gap is miscounted as zero speed.
- An installed home-screen icon reverts to a black background or uses divergent SVG/PNG/manifest assets after an update.
- Toilets advertised as currently open merely because a parent venue is 24h.
- External map pin/disambiguation wrong, or alternative within same checkpoint group counted as next sequential point.
- Future art visible via offline precache, unauthorized link or accidental preview-triggered release.
