# Post-race archive: standings, visual cleanup, and Meriden lessons

Use this when the organiser turns off live timing or the event is finished. Treat it as a **separate presentation mode**, not a permanent stale state of the live tracker. For future events, parameterize every historical date, category, score, ID and participant.

## 1. Preserve the evidence before provider shutdown

1. Export the entire accepted participant/score roster while available, including original category fields, race number, crow-flight score, score availability, official flags and capture provenance. Also preserve the runner's timestamped path and any agreed crew check-ins separately, under their own privacy rules. A complete **last saved snapshot** is different from a comprehensive history of every earlier poll.
2. Retain an unchanged private source archive if authorised, and create a small public results file with only fields needed by the leaderboard. Record event identity, date, timezone, metric, participant count and categories. Never fill missing scores with zero or infer finishing order from an old GPS timestamp.
3. Validate schema, exact event identity, duplicates, category sizes, score ordering, key participant, and expected total before switching the UI. If the archive is missing or invalid, show an honest archive-unavailable state; do not silently fall back to an unrelated or dead event feed.
4. Bundle the results JSON with the site and service-worker offline cache, and bump the cache version when code/data changes. Keep ordinary HTTP live APIs uncached; a frozen public archive is different.

## 2. Post-race leaderboard design

Keep the playful three-step crow podium, Emily's recognisable portrait, gold step higher than silver, selectable categories, full ranked remainder and informal all-category comparison. Keep a compact provenance block **once**, near the title/summary: e.g. `Escape from Meriden 2026 · Archived results`, archive date, and an explanation that the metric is **distance from the origin as the crow flies**, not running kilometres. A saved tracker snapshot is **not organiser-certified final results** unless independently verified.

Do **not** repeat these on every competitor card, row or favourite:

- `✓ Distance recorded` when a score already appears numerically.
- `Saved 14 November 2026`, `2026 archive`, “last seen”, “still running”, “fresh GPS” or any generic per-entry archival/live status.
- A capture-time chip implying entries were observed/verified at different times when the archive was taken as one batch.

Do show per entrant: **rank, name, bib, score, score unit**, category when mixing classes, and an optional crow-flight difference from the highlighted runner. Preserve **exceptional truthful notes only**: `No recorded distance` for null scores, a source-supported retirement, or another materially different known outcome. Omit the generic status element entirely for ordinary scored entries; do not render an empty badge or whitespace placeholder. Retain search/favourite controls if useful as a historical shortlist, but do not imply they enable live GPS tracking. Show no competitor pins from the standings archive when it lacks coordinates. No background polling is needed for an immutable result set.

**Two modes, two tests:** race-day mode retains GPS report ages, provisional state, follow-map controls and true current/last-known status; finished archive mode has a single batch-level date/provenance, immutable category tables and no per-row tracker-age language. Test both modes for future-event templates. A previous live-mode assertion must not be used to force old labels back into the archived version.

## 3. Historical Meriden 2026 reference

The existing Crow Crew Site is the owner-selected historical Site at `https://emily-jeff-meriden-crew.whylaura413.chatgpt.site`. Edit that exact Site only when the owner explicitly asks to change this historical guide; remix it to a new Site when starting a **different** race.

- Static public standings: `public/data/meriden-final-standings-2026.json`, 14 November 2026 snapshot, **282 unique entrants**: 36 female solo, 152 male solo, 67 pairs, 22 chained, 5 other/uncategorised.
- Emily Simmons #247: **106.498 km** organiser-tracker crow-flight reading, **2nd of 36 female solo**. In a deliberately informal comparison across mixed classes, **24th of 282**; never call that an official overall placing. The stored score is not the 118.23 km cumulative sampled GPS path, nor proof of her watch's exact distance. The family separately confirmed second female, but this JSON is still a tracker archive rather than an organiser-certified final sheet.
- Source of the main embedded standings: `public/competitors.js`; markup in `guide/index.html` (generated public shells are overwritten by build); CSS in `public/competitors.css`; offline cache `public/sw.js`. The separate `leaderboard.html` is also archive-backed. The main source does **not** call `/api/leaderboard` once the event has closed.
- Retain a snapshot file separate from the private raw runner path and the replay asset `public/data/emily-replay-2026.json`. Emily's replay has **712 GPS fixes** and **11 recorded crew meetings**; 35 other competitors' approved historical paths were screened from 70 for a replay concept. Historical routes are not permission to show current competitor whereabouts.

## 4. Learned presentation and storytelling preferences

- **Homepage:** After briefly featuring the large finish poster and leaderboard, the owner asked to **restore the familiar phone-first tracking guide/map as the homepage**. Keep the leaderboard in its separate “We are not competitive” sheet, Moments & milestones in its own tab, and replay accessible by a clear CTA. Do not replace the original guide homepage again without asking.
- **Final celebration:** Use the approved `EMILY, YOU ABSOLUTE LEGEND!` poster for the final milestones celebration. It includes her second-female-solo finish, gold distance, 106.5 km straight-line, about 118.2 km GPS sampled, 23h49m tracked time, and Jeff, Graham, Ben, Huiyan and Susan cheering in their verified roles. Preserve the owner's approved faces, wording and winter story rather than regenerating a generic victory poster.
- **Tone:** Warm cream/teal sketchbook UI, cheerful hand-drawn crows, playful escaped-prisoner humour, gentle hearts and subtle “Powered by tofu”. Avoid sterile technical labels, dense duplicated metadata or exaggerated claims. The podium is a celebration, not an audit log.
- **Post-race experience:** The owner wants a much richer, artwork-led **storybook playback**, not merely a moving dot on a route: runner and supporter avatars, day/night/weather changes, real recorded meet-ups, GPS-derived approximate pauses, town scenes, unique illustrations, milestones, meaningful stats, and selected competitor crows along authentic archived trajectories. Use the 712 fixes, 11 meetings and saved competitor tracks as available; label interpolations and unknown durations, never invent attendance or synchronise different competitors by guessed times. Include accessible seek, pause, speeds and reduced-motion mode.
- **Phone readability:** The user's actual feedback came from an iPhone screenshot. Keep small-entry metadata concise at 375/390px, use generous touch areas, verify podium legibility and that silver Emily's portrait is aligned under a visibly taller gold step.

## 5. Regression and release checks

1. Verify category and overall rankings from the static archive with the upstream tracker unavailable. Female-solo podium should display Clare Farrell, Emily Simmons and Elly Roberts in the saved order.
2. Inspect podium, row four onward, search and personal favourites at iPhone size. Assert there is **no** `Distance recorded`, per-entry `Saved [date]`, repeated `2026 archive`, `Still running` or generic placeholder status on ordinary scored entrants. Confirm the **one** header provenance/date remains legible.
3. Check missing-score entries remain unranked/labelled, and official retirement flags are not silently conflated with unconfirmed finishes.
4. Switch Female Solo/Male Solo/Pairs/Chained/Other and informal all-entrants view. Verify Emily remains 2nd female solo, informal 24th of 282, with no positions or live pace invented.
5. Test offline cache version on a previously installed phone, run targeted archival tests and full applicable suite, rebuild from `guide/index.html`, and verify deployed production URL. Do not change approved replay or historical posters as part of a narrow leaderboard cleanup.
