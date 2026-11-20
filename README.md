# Pocket Crew 🐦‍⬛

**A phone-first guide for ultrarunners and the people bringing the spare socks.**

At 2am, a runner’s latest GPS fix, a route pin and the crew’s latest plan can be spread across three screens. Pocket Crew brings the **next agreed meet-up**, **when the runner might get there**, and **what’s nearby** onto one map.

**[Open Emily’s Great Escape](https://pocketcrew.run/)** · **[Watch the 65-second phone walkthrough](demo/renders/Pocket-Crew-Playful-Phone-Demo.mp4)**

<a href="demo/renders/Pocket-Crew-Playful-Phone-Demo.mp4"><img src="demo/preview.jpg" alt="A phone walkthrough of Pocket Crew showing a nearby charging stop" width="240"></a>

The walkthrough uses sample race-day scenarios. The live link opens on **After**. Tap **During** to see the race-day view.

## Who it helps

- **Support crews** can work from the same plan when they’re spread out along the route. The person waiting with the kettle can see the same agreed stop as the runner.
- **Runners** get a pared-back view with the meeting place and distance to go in large type.
- **Event organisers** have a concrete example to share with entrants planning their own crew support. Pocket Crew started with Emily and Jeff’s 2026 Escape from Meriden, where participants choose their own routes and crews arrange their own meet-ups. [Event rules](https://www.escapefrommeriden.co.uk/)

## A race in three stages

| Stage | What you’ll find in the Meriden example |
| --- | --- |
| [**Before**](https://pocketcrew.run/before) | The planned route, crew meet-up options, and the kit and essentials checklist. |
| [**During**](https://pocketcrew.run/crew) | See when the tracker last reported and look up nearby loos, cafés, parking and charging. Crew members with access can mark a stop met or skipped so the plan moves on. Phone location sharing starts when someone turns it on. |
| [**After**](https://pocketcrew.run/) | Emily’s saved route plays out on an illustrated map, with crew photos and celebration posters alongside it. The archived podium and category rankings are below the replay. |

## For the event organiser

**Share [the Meriden example](https://pocketcrew.run/) in your pre-race notes for entrants bringing a crew.** It shows how one family used the event tracker alongside a plan for their own stops.

To adapt it for another race, start with that crew’s planned route, suitable meeting places and an event-approved tracker source. Recheck access and opening hours for facilities, give the crew its own sharing setup, and replace the family artwork with media you have permission to use. [Adapt the guide for another crew](docs/reusing-the-guide.md)

Arrival windows are estimates. The replay uses saved GPS and crew check-ins, and the podium uses an archived tracker snapshot. Meriden’s rankings measure crow-flight distance from the start. The replay also shows distance along the sampled GPS path.

## Build or adapt a guide

- **[Install the Codex skill](skills/README.md)**. `build-ultra-crew-guide` v1.0.0 covers event setup, race-day support and archiving.
- **[Try the interactive demo](demo/README.md)**. Download or clone the repository and open `demo/index.html` in a browser to try the sample states.
- **[Read the development notes](docs/guide-development.md)** for the application, offline saving and the alternative poster layout.

<details>
<summary>Run locally and find the source</summary>

Requires Node.js 22.13 or later.

```sh
git clone https://github.com/wan-huiyan/pocket-crew.git
cd pocket-crew
npm run install:ci
npm run dev
```

Open the local URL printed by the dev server. Shared crew features require a local D1 database and crew configuration. The public repository provides the starter source and demo. The hosted Meriden example shows the finished family guide. [Setup and reuse notes](docs/reusing-the-guide.md)

| Folder | What’s inside |
| --- | --- |
| `guide/`, `public/` | Guide templates, browser code, route data and artwork |
| `app/api/`, `lib/`, `db/`, `drizzle/` | Tracker adapters, crew sharing, estimates and database schema |
| `demo/`, `skills/` | Editable walkthrough and installable guide-building skill |
| `scripts/`, `tests/`, `archive/` | Build tools, verification sources and historical race inputs |

</details>

## Credits and permissions

Made for Emily, Jeff and their Meriden crew. The source repository is public and has no blanket reuse licence. Family artwork, portraits and third-party event or map data retain their respective rights. The guide shows map and routing attribution, and bundled vendor notices remain with their files. Please check permissions before republishing the example materials.
