# Detailed new-race setup runbook

Use this as an operator worksheet, source migration checklist, and data-quality gate. Do **not** assume that the 2025 Meriden route, 2026 tracker, or 2026 support points apply to a future race.

## 0. Capture inputs and decisions

Create an event configuration record outside public code (private project notes or secure deployment configuration):

| Group | Required fields / decisions | Unknown means |
|---|---|---|
| Identity | Race name, date/year, race start ISO with time zone, finish duration/cutoff, public site title/URL, theme | Do not publish countdown |
| Competitors | Name/display label, racer ID, exact official bib, tracker provider URL/event ID/slug/date, runner vs retired/crew status | No live avatar until verified |
| Category and follows | Exact provider category fields, race metric (crow-flight vs course), target group/sex/age class, requested rivals and initial visible pins, audience/privacy | No ranked comparisons or category map layer until verified |
| Route | Source GPX/KML/GeoJSON, owner permission, official vs historic/planned, main track folder, original KML export link, route origin, coordinate system | No GPS-route ETA or trustworthy meeting pins |
| Award | Rules: route distance vs crow flight vs officially measured, centre/reference point, unit, silver/gold/other thresholds, who confirms award | Use “planning target”, not earned award |
| Planned goal | Expected route distance, possible stretch goal, backup beyond-goal support points, daylight/night and road safety constraints | Support plan limited to verified route |
| Crew | Names, short labels, role (driving/walking), individual portrait references with consent, GPS participants, car driver handoff | Display “unassigned”, not a guessed location |
| Support | Numbered meet-ups, alternatives, owners, precise Google/OSM pins, town/landmark descriptions, meeting instructions, known passed points | No fabricated meeting label |
| Facilities | Toilets, cafés, supermarkets, EV chargers, parking, connector/access/hours source, checked date, uncertainty | “Unknown hours/access” |
| Moments | Intro text, anniversary/funny story, milestone threshold IDs, portrait/style refs, poster art and preview approval | Keep unreleased/placeholder private |
| Access | Expiry date, main publisher custodian, recovery code custodian, who may see location, privacy/retention agreement | Delay public GPS feature |
| Logistics | Support vehicle(s), range/EV charging needs, driver contact, handoff points, contingency contact method | Do not imply a stop is agreed |

Ask only truly missing blockers; use optional features incrementally while preserving their absence states. Agree in advance if the guide is family-only or world-readable. Original product is publicly viewable with authorised-only writers; do not assume all new users consent to public location sharing.

## 1. New Site and source fork

1. Start from the public Pocket Crew repository linked in SKILL.md, an owner-supplied export, or a Site selected through the host’s discovery tools. Inspect the current source. For a new event, create a separate Site; preserve the historical guide. A request to build the new event supplies its scope; ask only for genuinely missing decisions or authorization.
2. Clone/remix source and tests to distinct Site/project and D1 database. Keep original data as reference only; do not publish clone with old live room or personal raw data. Remove specific previous racer portraits and secret fragments from public assets. Source tree's checked-in original illustrations are not a license to reuse real participant identities in a new event.
3. Run `node <skill>/scripts/audit_crow_source.mjs <new checkout>`; inspect all event-bound strings. A simple global replace is unsafe because event IDs appear in filenames, localStorage keys, tests and source checksums with different semantics.
4. Preserve `guide/index.html` as source; `public/index.html` is generated. No edits directly under `dist/`. Preserve the separate `/poster` alternate shell but keep one backend room and state.
5. Configure new `PUBLIC_CREW_VIEW_HASH`, `PUBLIC_CREW_PUBLISH_HASH`, optional `PUBLIC_CREW_LOCATION_HASH`, `PUBLIC_CREW_EXPIRES_AT` as deployment secrets/settings. Generate cryptographically secure **distinct random** raw capabilities, SHA-256 hash; keep raw values only in secure crew invite channels. Never paste tokens into this skill or project docs. Revoke after event.
6. Update `.openai/hosting.json` using Sites conventions for the **new** project and D1. Apply existing D1 migrations to its database, not the former one. Later schema changes use new incremental migration; never edit previously applied SQL.
7. Change event-specific storage/cache namespaces, display text, Start/End, links, participants, source IDs, all poster IDs/assets and provider config; protect from accidental cross-event local state/intro replay or stale data.

## 2. Route conversion and geometry

### Coordinate rules

- GeoJSON `LineString.coordinates` is `[longitude,latitude]`. Client Leaflet point APIs often want `[latitude,longitude]`; explicitly convert. Reject lat/lng swapped, NaN, antimeridian/zero jumps and route self-overlap issues.
- Preserve original full-resolution source, checksum, date and track name in private or build provenance. Render a planned route file and retain a full onward route if stretch-goal extension may be needed.
- Compute cumulative WGS84/haversine route km on the **actual polyline**, not straight distance from origin. Preserve calibrated original route length if source program uses another distance method; document factor.
- Project candidate GPS points to nearby route segments; store best along-route km and off-route metres. In self-crossing routes, avoid arbitrary nearest-segment branch flips; use temporal continuity and bounded jumps.
- For end-of-route milestones, leave **visible route geometry beyond final threshold** where source data allows, so two GPS fixes can corroborate crossing. 2026 used ~123.6 km geometry for a 123 km target, deliberately not a car meetup.

### Preserve provenance for points

For each historic candidate record: original KML placemark name/text, original coordinates, source folder, original Google Maps link, original advertised route km, projected km and offset, source type, location label, town, nearby landmark, meeting note and sources/checked date. **Do not move historical pin coordinates** to the route line. An interpolated route-km dot is not a vehicle meet-up. A parking claim needs operator/council evidence, not a glance at satellite view.

### Meeting group example (illustrative, no real person coordinates)

```json
{
  "id": "point-group-8",
  "number": 8,
  "label": "Point 8",
  "routeKm": 72.4,
  "optionIds": ["point-8", "ev-meetup-alternative-8"],
  "town": "Exampleton",
  "options": [{
    "id": "point-8", "label": "Point 8",
    "lat": 52.0, "lng": -1.0, "routeKm": 72.4,
    "kind": "historic-support-option", "isOfficialCheckpoint": false,
    "landmark": {
      "name": "Exampleton town square",
      "mapLabel": "By the square",
      "nearbyLabel": "High Street",
      "meetingNote": "Meet by the original pin; confirm legal parking on arrival.",
      "sources": ["https://example.org/verified-source"],
      "checkedOn": "YYYY-MM-DD"
    }
  }]
}
```

This is a **shape illustration**, not a ready replacement. Match the current `support-points.json` schema and all required checks. Do not use the fake example URL for actual deployment.

### Source audit for extensions

When importing a Google My Maps source, determine which KML layer is *actual main track*; its markers may contain numerous unrelated distance dots/directions. The original file used `Meriden3.11H` plus points 1–23 within 123km, optional EV stops, historical 2025 line and a shared known-passed point. Before extending, **review route distance and checkpoint sequence** and avoid re-running a one-off script against modified geometry without its checksum/length preconditions.

Update `route.geojson`, `milestone-route.json` source checksum, `guide-data.json` route/milestone provenance, `support-points.json` groups/planningEnd, map labels and distance test fixtures together. Do not silently overwrite previous good endpoints, gold reference or source notes.

## 3. Configure official tracker

In `app/api/tracker/route.ts`:

- Set fixed provider origin, exact upstream event ID/accepted slug(s), race date and allowed participant bibs. Check provider's API payload *for the actual event*, not only public HTML metadata. Use server-side fetch with sane content length/redirect/timeout limits, sanitized output and no-store cache semantics.
- Confirm event start/time zone against user's event record. Reject wrong event/year even if a bib matches. Normalize bib carefully, allow exact numeric formatting variants only where source semantics permit. Never match a person just by similar name.
- Map participant state: prestart, live, finished, retired, not found, ambiguous, provider error, event-not-current. Latest recorded GPS, timestamp and accuracy/source.
- Get individual location **and** history path for each selected participant. Recent 20-minute path for baseline pace; up to two-hour history for trend. Do not derive pace from leaderboard crow-flight speed or `sendTime`.
- Server response must be timely even if optional trend path fails. Path-derived `recentReports` and `paceReports` share one upstream fetch when possible.
- Adapt `lib/race-milestones.ts`'s participant whitelist, event ID and timestamp validation. Keep credible GPS speed, route projection, corroboration and persisted ledger gates.
- Update `public/crew.js` default runner roster/bibs, `public/live.js` snapshots, `public/race-moments.js` active runner labels, any optional `public/rival.js` event/bib independently.

**Category standings and following setup** (reference v57):

1. Inspect the event's *actual JSON*, identify exact category keys/values. For 2026 the public roster had `group:"Solo"`, `ageCategory:"F"` for Emily #247, and the distance in `routes[0].dist` represented crow-flight km. Different events may score differently; confirm before sorting or labelling.
2. Reuse the validated event + cached public participant roster in `GET_LEADERBOARD` of `app/api/tracker/route.ts` and its thin route re-export `app/api/leaderboard/route.ts`. Sanitize fields, return status and original GPS time; never send tracker device IDs or path history in standings. Return the exact runner category table plus sanitized `allCompetitors` sorted by the organiser's crow-flight metric; the latter omits every unrelated lat/lng and is explicitly **unofficial** as an overall rank across category classes. Validate category query values and only look up recent moving pace for a bounded selection. Mark rankings provisional and show report age; no static gender/name inference.
3. Configure `public/competitors.js` defaults (selected target runner, optional original rival bib, maximum follows, event-specific localStorage key), **only individually followed-and-enabled map markers**, 5min maximum fresh map age, visible-page polling ~45s, error/offline carry with original timestamps. Ignore any legacy category-wide map toggle preference. Search roster by exact bib/name; distinguish organiser-confirmed retired/finished, fresh active, and stale unconfirmed still-entered states. Do not tie the follower state to shared D1 or publisher capabilities.
4. `guide/index.html` exposes the dedicated bottom **“We are not competitive”** tab, a **category selector** (Female Solo, Male Solo, Pairs, Chained, Other), separate **Emily amongst everyone** toggle/card, the selected top-three podium, full remaining category/all-field list, and individual Follow/Map/Unfollow. Make **first/gold step visibly taller than second/silver** regardless of Emily's avatar animation. The general-category **map overlay**, map toggle and legend must not appear; a competitor may go on the map only when family-followed. `public/competitors.css` styles the touch-friendly cards and withdrawal/finish states. `public/map-first.js` draws only individually followed/Map-ON markers, including ghosted older last-known GPS; hiding a rival must not erase his stats. Regenerate both shells, bump `public/sw.js` if relevant and precache new JS/CSS (never `/api` responses).
5. Copy the category sorting, wrong-event, stale, follow-toggle and map pin isolation tests (`tests/leaderboard.test.mjs`, `tests/competitors.test.mjs`, `tests/map-first.test.mjs`); adapt data fixtures to new provider. Never use leaderboard crow speed for runner ETA or rank as proof of who is physically on the same road.

For a tracker with no GPS path endpoint, **do not fake route pace**: show position and an honestly unavailable ETA until the user approves a separately supported pace method. Supply a one-time test feed fixture with synthetic positions for QA, never public live data.

## 4. Determine milestones and award rule

1. Enter event origin and award metric explicitly. In original Meriden example, silver=30 **straight-line** miles (48.28032 km) and gold=60 straight-line miles (96.56064 km), which can occur **beyond 100 km of running**; its 2025 planning reference crosses gold near route km 105.25. Future race may use wholly different rules.
2. Define route milestones independently: marathon `42.195 km`, 50/60/70/etc as requested, stretch goals. Decide exact participant scope and IDs across backend + frontend + poster manifest.
   Display **both** route km along the imported planned track and crow-flight km from the event's official origin for each milestone point; one is neither the other nor the runner's watch distance.
3. Require durable evidence before celebration; ideally at least two plausible fixes past future poster threshold. Track interpolation evidence `beforeAt`/`afterAt`; label backfill or first point already past threshold rather than claiming exact crossing time.
4. Include future goal buffer and support stops as *conditional possibilities* beyond nominal finish. No fake official checkpoint or parking at interpolated 110/120/123 dots.
5. Record award title as “gold” only if organizer rule and user approval permit it; UI can label provisional radial crossing separately from official result if organiser confirmation is pending.

## 5. Facilities and driving

For each researched amenity, capture ID, coordinate precision, source link, checked date, opening hours and whether WC-specific vs venue-only, access restrictions, safe crossing, parking/EV charger connector and availability caveats. Inspect every proposed meeting stop's land access and legal parking without promising real-time availability. Keep a source-of-truth `facilities.json` with curated IDs; never call open-web routing for arbitrary user-supplied latitude/longitude.

If the OSRM/FOSSGIS public matrix provider is used, keep its 5-min bounded cache and D1 lease, source attribution, privacy disclosure (approximate shared crew origin sent to third-party routing service) and failure states. If routing service terms or endpoints change, verify official documentation before shipping and consider permission/sustainable use.

## 6. Security and privacy setup

- Public mode read-only; invite writer only through separately delivered fragment or recovery code. Browser must remove fragment from address bar after consumption; sharing the guide never includes it.
- Avoid reusing any 2026 capability hash. Configure a finite public expiry after the event, agreed with user, with tombstone after revocation. Check `GET` after expiry cannot reveal stale coordinates.
- Store only latest supporter fix; explicit Stop withdraws. No background location promises, no automatic permission prompts; one-shot vs 30s foreground session distinctly labelled. Manual plan “walking with” is not GPS consent.
- Never expose original personal photos, phone numbers or raw location feed in static JSON. Public map necessarily exposes **selected** shared positions; get crew's informed agreement and decide if public site should instead be private for sensitive events.
- Keep all `/api` uncached and response no-store; no sensitive URL/referrer leakage; no unreleased poster precache.

## 7. UI adaptation and content map

Update these together: `guide/index.html` title/header/role names/start clock and intro; `public/app.js` storage keys and event date; `public/live.js` person roster, tracking source labels; `public/map-first.js` person/map display; `public/competitors.js` category/follow IDs/local key; `public/support.js` meeting metadata; `public/crew.js` default runner bibs/notes and facilities; `public/race-moments.js`, `public/race-milestones.js` point IDs and event-specific history key; `public/data/poster-manifest.json`; `public/sw.js` cache version/core assets including competitor JS/CSS; alternative `/poster` generated via prebuild. Review `<link rel="apple-touch-icon">`, all web manifests and 180/192/512 home-icon files for consistent chosen background colour. Recreate portraits and poster images only from supplied references/consent; keep stylistic consistency.

## 8. Preflight walkthrough with crew

1. Open ordinary public URL on an unauthenticated phone: guide works, no capability or GPS prompt.
2. Open supporter publisher invite on owner phone: access enables controls but no geolocation permission; invite fragment disappears.
3. Open limited location setup on another phone: connects **only the named supporter**, Update once sends exact fresh reported timestamp, Start/Stop work, role toggle does not alter permission.
4. Select two different check points / an EV alternative, confirm both devices display one agreed stop and proper next/then. Mark Met/Skip/Undo in an isolated rehearsal room, never production race records.
5. Simulate fresh/stale/off-route and runner-finished GPS, check route km and ETA logic; verify oldest report cannot regress.
6. Test future art still hidden; simulate durable crossing then confirm no repeat celebration on reload and all earned art replayable.
7. Save offline guide, put phone offline, verify route/milestones/notes without inventing live positions; return online and recover.
8. Confirm vehicle rendezvous over voice/text outside the website. The site is a planning aid, not an emergency communications channel.
