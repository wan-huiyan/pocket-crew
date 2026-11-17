# Adapt the guide for another crew

## Set up a local copy

Use the install and dev commands in the root README. `npm run build` creates the Worker output; `npm start` previews that built Worker on loopback. These are inherited project commands, not a claim that a fresh build was run for this repository publication.

The public copy’s `.openai/hosting.json` retains the D1 binding declaration but deliberately omits the original hosted Site identity. Register your own Site when deploying a fork. This repository is not connected to automatic deployment of the original family guide.

For local D1, build first and apply each unapplied migration in `drizzle/` in filename order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flimsy_betty_ross.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_shiny_ravenous.sql
```

Do not replay an already-applied migration. See `docs/guide-development.md` for the complete inherited runtime notes. References there to the original Site identity describe the historical development environment; forks must use their own identity.

## Replace event-specific material

1. Review `guide/`, `public/crew.js` and the tracker API adapter for names, bibs, event ID and dates.
2. Replace and verify `public/data/` route geometry, meet-up coordinates, facility research and milestone definitions together. Source links and advertised hours are historical evidence, not current opening guarantees.
3. Obtain permission for portraits and artwork, or replace them with your own. Keep names and individual GPS sources aligned.
4. Remove the example race replay and archives from any newly branded event, or clearly label them as historical examples.
5. Preserve the separation between public viewing and permission to publish locations or plans. Never put supporter links, raw capabilities or runtime secrets into source or public assets.
6. Review the offline cache list and version after changing assets. Do not cache live APIs, private capabilities or future unreleased surprises.

## Shared crew configuration

The backend reads `PUBLIC_CREW_VIEW_HASH`, `PUBLIC_CREW_PUBLISH_HASH`, an optional `PUBLIC_CREW_LOCATION_HASH`, and `PUBLIC_CREW_EXPIRES_AT` from runtime bindings. The hash values must be SHA-256 digests of distinct strong random capabilities. The expiry is a fixed absolute ISO timestamp. Configure these through your own host’s secret settings; the repo does not contain the live values or supporter setup codes.

Review `lib/public-crew-config.ts`, `lib/crew-room.ts` and their existing tests before provisioning a new session. Set location permissions on each actual phone and check that expiry, revocation, unknown locations and stale reports work as intended.

## Verification boundaries

The repository includes the original tests and recorded screenshots. No application logic was changed for this publication. No new dependency install, application build, browser QA, native run or portable test suite was performed on the Mac. Run the appropriate checks on your approved test host before deploying changes.
