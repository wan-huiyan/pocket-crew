---
name: build-ultra-crew-guide
description: Build, adapt, operate, or archive a phone-first ultramarathon crew guide with route maps, meet-ups, runner tracking, supporter location sharing, milestone artwork and finished-race replays. Use for Pocket Crew-style event guides and their race-day diagnostics, rather than general training plans or unrelated websites.
metadata:
  version: "1.0.0"
---

# Build an ultra-run crew guide

Create a useful phone-first companion for a runner and their support crew, or make a scoped change to an existing guide. Preserve the user's chosen artwork, copy, layout and controls unless the requested change requires otherwise.

## Start with the source and requested mode

- **New event:** use the public [Pocket Crew source](https://github.com/wan-huiyan/pocket-crew) or an owner-supplied checkout. Create a separate deployment and database; replace event-specific identities and data before publication.
- **Existing guide:** inspect its current owning source and deployed state. Apply the requested change without treating a new-event checklist as permission for a redesign or replacement deployment.
- **Race-day diagnosis:** start with the relevant operating reference and current code/report timestamps. Prefer a narrow, reversible fix while preserving recorded events.
- **Finished race:** distinguish immutable archived results and replay data from live tracking. Preserve original evidence and the approved historical entry page.

This installed folder contains instructions and a read-only audit helper, not the website, artwork, application dependencies, tests or credentials. The linked repository supplies the example application separately. If unavailable, request a source export when faithful adaptation is required; a new implementation from these notes needs independent validation.

The references preserve the supplied Meriden 2026 development notes. Names, bibs, dates, layouts, thresholds, test counts and results are historical examples. They are not defaults for a new event or proof of current behavior. Verify applicable details against the current source and event evidence. Existing user authorization and the actual hosting workflow govern publication; do not add a second approval request when the user has already authorized the same action.

## Essential contracts

1. Keep public viewing separate from permission to publish locations, edit plans or release celebrations. GPS sharing requires an explicit phone action; changing display role never grants access. Use distinct new capabilities, runtime secrets and fixed expiry for a new event. Do not copy old production rooms, personal coordinates or raw photos into it.
2. Attribute every location and pace to its actual source and report time. Never refresh a GPS timestamp on delivery, borrow another person's coordinates, invent pace, or infer phone GPS from a Maps sharing URL. Label a walking-with-runner plan as inferred co-location.
3. Distinguish planned route kilometres, crow-flight scoring and sampled GPS/watch/official results. Derive ETA from coherent route movement for the selected runner; show uncertainty or unavailable states for stops, gaps, stale reports and unverified facilities.
4. Keep approved originals and milestone history. Future artwork remains unreleased until validated crossing evidence is durably stored; creator previews never release it. Respect reduced motion and keep the map usable when an intro or live feed fails.
5. Preserve privacy and provenance in archives. Crew check-in times do not prove exact arrival or attendance; sampled GPS pauses are approximate. Do not carry supporter GPS or capabilities into public replay data.

## Work through only the relevant references

| Task | Reference |
| --- | --- |
| Find the implementation, API/data contracts and state flows | [Architecture](references/architecture.md) |
| Check visible behavior and regression risks | [Feature contract](references/feature-contract.md) |
| Collect event inputs, validate routes/pins, configure feeds and new access | [Event setup](references/event-setup.md) |
| Create or adapt portraits, posters, intro and celebration moments | [Artwork and moments](references/artwork-and-moments.md) |
| Operate the guide, hand off support or diagnose race-day problems | [Race-day operations](references/race-day-operations.md) |
| Preserve GPS and build an accessible finished-route replay | [Finished-route replay](references/finished-route-replay.md) |
| Freeze standings and switch the presentation after tracker shutdown | [Post-race archive](references/post-race-archive.md) |
| Select applicable tests, phone QA, release checks and rollback evidence | [Validation](references/validation.md) |

For a complete new event, read architecture, feature contract and event setup before implementation, then the applicable artwork and validation guidance. For a small change, read the relevant reference and owning code/tests first; do not load every reference by default.

## Audit and deliver

With Node.js available, run the bundled helper against an explicitly selected source checkout:

```sh
node /path/to/build-ultra-crew-guide/scripts/audit_crow_source.mjs /path/to/site-checkout
```

It reads expected application files and emits JSON with structural findings and counts of event-specific strings. It performs no network requests, edits, deployments or database access. Exit 1 means structural review is needed. `structure-present` is an inventory result, not a security, migration or launch certification; always review legacy markers separately. It expects the Pocket Crew file layout and does not validate arbitrary apps.

Use the current hosting skill when deploying through that host, and an available image-generation tool when the requested artwork needs it. Keep core planning and diagnosis usable without those integrations. Run appropriate application checks on the permitted test host, build from the final source, and verify the target deployment and audience. Report exact source/release provenance and distinguish source inspection, automated checks, browser previews and real-phone evidence. Stop task-owned processes and remove disposable outputs while retaining source, required delivery/rollback material and concise proof.
