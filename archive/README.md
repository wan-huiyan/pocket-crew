# Emily's Escape from Meriden 2026 — preserved race record

- `emily-tracker-raw-2026.json`: 712 recorded GPS fixes downloaded from the official Trail Live participant path on 15 November 2026 (race 14 November 2026; bib 247). This is the unmodified downloaded JSON, retained outside the public web directory.
- `emily-crew-history-2026.json`: 11 saved “met” check-ins, recorded milestone crossings, poster releases and supporter role choices captured from the public Crow Crew room after the finish. **It deliberately excludes supporters' GPS coordinates**, which aren't needed for the replay.
- `../public/data/emily-replay-2026.json`: derived publication file. Rebuild with `node scripts/build-emily-replay.mjs`.

The GPS route is sampled roughly every two minutes, so the 118.23 km segment sum is an estimate, not a running-watch distance. The final official straight-line distance was 106.498 km. Meeting check-in times are human button-press times, not automatic arrival timestamps. The displayed stopped durations are approximate continuous near-stationary GPS clusters within 140 m of the closest recorded fix (and omitted when unreliable). Family interactions are narrative recollections; their assigned playback moments do not imply exact companion GPS timestamps. Susan cheered from home.
