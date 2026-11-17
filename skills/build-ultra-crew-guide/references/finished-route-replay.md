# Completed-run GPS archive and animated route replay

This workflow follows the actual Meriden 2026 finish. For other events, discover official tracker endpoints and supported export formats rather than copying its participant ID.

## Source and privacy contract

1. Confirm the runner has **finished** and that the owner wants the route publicly replayable. A stopped or stale tracker alone is not official retirement/finish confirmation.
2. Export the **complete timestamped official tracker path** before provider retention expires. Retain the original unchanged outside the site's public directory. Record provider, event, exact participant, export date, first/last fix, time zone, count and any tracking gaps.
3. Snapshot crew check-in history and official milestone events. Save only needed event times/IDs and role changes; **strip supporter GPS coordinates**, last-known home locations, access capabilities, bearer tokens and personal notes before archival. Retain original confidential records only when authorised.
4. Derive a small public replay JSON from the private archive: `[secondsSinceStart,lat,lng,cumulativeSampledGpsKm]`, recorded crew check-ins, estimated milestone crossing events and general crew-story cards. Never conflate three metrics: cumulative sampled GPS kilometres, official crow-flight award reading, and watch/official route distance. Show full precision when provided; label sampled distance an estimate.
5. Use owner-approved portraits, cast labels and final poster. Avoid presenting a family-made poster as an official organiser document.

## Meeting duration calculation

- A `met` button time is a **crew check-in**, not proof the runner arrived exactly then, nor proof of the person present.
- Associate each check-in with the recorded GPS path within a bounded time window (Meriden example: ±45 min) and a validated point coordinate. Flag missing or far-away matches.
- Locate a continuous cluster of near-stationary fixes (Meriden reference used 140 m and no >8-minute gap) around the nearest fix; compute *approximate nearby GPS pause*, not exact rest time. If samples are too sparse, say **Duration unknown**. Check that GPS jitter or slow walking does not become a false long stop.
- Preserve check-in location/town names from user-agreed point records; separate actual tracker coordinates from planned pins. List every confirmed `met` check-in, but do not fabricate attended meetings for absent records.
- Do not automatically assign supporters to each check-in from their last known locations. Crew-story scenes may be timed illustratively when the precise changeover is not recorded—label that distinction.

## Playback experience

- Offer a clearly labelled **Replay finished route** entry in *Moments & milestones*, preserving all previously released posters.
- Map actual fixes chronologically, a lightweight illustrated moving runner/crow, an accumulated route trace, optional check-in markers and finish marker. Animate based on elapsed event time (so pauses are visible), not evenly spaced point indices; interpolate between adjacent fixes and allow manual seeking.
- Transition sky/colour according to event-local time: midnight, dawn, daylight, dusk, frosty evening. Add accessible play/pause, restart, speed and scrub controls; respect reduced motion and stop animation when the page is hidden.
- Trigger concise story cards at recorded check-ins, milestones and family moments. All supporter names have approved roles: physical walker, driver, remote cheerer. Do not portray remote cheering as physical attendance.
- End with a joyful finish state and owner-approved downloadable poster. Distinguish official gold crow-flight boundary from a route kilometre milestone and indicate verified vs estimated crossing timestamps.
- Keep the replay **static and offline-capable** after the event. Do not depend on expired live-room locations or tracker polling. Cache the small replay JSON and page, while avoiding unintended preload of unreleased posters.

## Meriden v58 working reference

- Site the owner-selected historical Site, route `replay.html` and source `public/replay.js`, `public/replay.css`.
- Source archive `archive/emily-tracker-raw-2026.json` and sanitised `archive/emily-crew-history-2026.json`; builder `scripts/build-emily-replay.mjs`, sanitizer `scripts/archive-emily-crew.mjs`.
- 712 fixes, 11 check-ins, 10 tracker crossing records, 6 family-story cards. 118.23 km sum of GPS fixes, 106.498 km official crow-flight final. The 11 marked meetings had 9 measurable nearby GPS pauses, 2 unknown; all are approximate.
- The supplied historical notes report `node --test tests/*.test.mjs` (481 passing) and `npm run build`; these results were not reproduced for this skill release. Keep a final source-based build before deployment. Tests cover replay completeness, chronology, uncertainty, privacy and navigation.
