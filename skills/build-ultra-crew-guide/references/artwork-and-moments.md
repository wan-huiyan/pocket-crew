# Artwork, intro and celebrations: reproduction guide

The original Crow Crew was as much a **warm, personal celebration** as a logistics tool. Preserve the emotional character while making each new event its own story. All portraits require owner-provided reference images and permission; the skill intentionally contains no people's likenesses or raw photo files.

## 1. Visual language and screen hierarchy

- Primary guide: warm pale cream background, deep teal/ink text and buttons, soft pink/coral underline, rounded paper-like cards, gentle shadows, a little playful hand-crafted character; generous whitespace and clear map. The small crow mascot anchors brand recognition. Avoid sterile dashboard styling or glossy 3D.
- Optional `/poster/` display: bolder orange/red/navy/yellow sign-painting/tabloid escape-poster language. Same live scripts/state, only presentation changes. Maintain accessibility/contrast at night.
- Mobile portrait first (375×667 and 390×844); provide 44px minimum interactive targets and readable names/ETA. Tiny poster thumbnails should remain legible enough to recognize art but open full portrait on tap.
- Runner mode hides planning clutter and future surprises. Supporter mode retains enough controls for real roadside use, but no long textual wall above map.
- Never render a photograph as a portrait beside hand-drawn Emily or Graham. Cutouts all share line weight, color range, face proportion, softness and smiling recognizability. Keep hair/age and glasses consistent. Export transparent portraits for map icons; preserve true GPS stem/source label.

## 2. Poster composition contract

For each milestone create a **different illustration**, not a repeated layout with changed number or town. Provide the creator a structured brief:

| Element | What to vary | What to keep |
|---|---|---|
| Headline | Specific playful escaped-prisoner / crow-flight pun | Large readable distance number and person's achievement |
| Cast | Person actually running/walking at that stage and current car support | Recognizable consistent youthful likeness, correct clothing/roles |
| Crow | Unique action: maps, wings spread, holding sign, flying overhead, celebrating, steering imaginary getaway | Cute dark/navy bird, expressive eyes and consistent mascot identity |
| Setting | Recognizable *verified* town, canal, park, landscape, local icon from route/marked map | No false claim of having arrived at a precise unknown location |
| Funny line | A distinct line that references terrain, sibling effort, support handoff, ridiculous distance, tofu or escape theme | Warm cheeky not demeaning or misleading |
| Map annotation | Route-km marker, town/area label and simple source-inspired inset/route line | Correct distinction: marked location vs approximated milestone, no invented street or safe parking |
| Colors | Coordinate but vary scene lighting, accents and crow pose | Original hand-illustrated bold/warm look, high text contrast |
| Source | Person reference photos, route town, current distance, supported role | No person's identifying photo exported without approval |

Original poster print brief was 1800×1200 for 75×50 cm horizontal physical prints, while later in-site milestone portraits are ~1024×1536 (PNG original + smaller WebP preview). Pick layout per destination. Never stretch horizontal physical art into a portrait without re-layout.

## 3. Meriden reference storyline (do NOT blindly reuse)

- Early stage: Jeff and Emily were siblings running together, with the humor “SOME SIBLINGS JUST GO FOR COFFEE.” and playful prisoner orange jumpsuits; “Powered by tofu” is a subtle vegan nod. Coffee poster and marathon moment show them together.
- After marathon, Jeff retired; Emily continued and **Graham walked** with her. **Ben** (Emily's partner) took driving-support duties from roughly meeting point 12 onward; do not portray him as walking/running if he is driving.
- Existing **50/60/70 km originals must remain**. In this real run the user said 60/70 already shown to Emily with Jeff; they should not be retroactively swapped. Historical moments are a record, not rebranding opportunities.
- New **80/90/100/gold/110/120/123** moments were commissioned with Emily, Graham, Ben, different crows and town-specific witty lines. The 100km route milestone and organiser gold are separate IDs; the gold award uses 60 miles **crow-flight**, not “100km gold” as a factual equivalence.
- The user explicitly requested a display review **before publishing** unique new illustrations and pointed out that initial variants were all the same. Build an annotated contact sheet/preview and obtain approval for all stage scenes first.
- Jeff disliked Milton Keynes; past stages used “(almost) Milton Keynes” and then “out of Milton Keynes”. Remove outdated location references if actual track differs. “Just a parkrun to go” was specifically disliked; avoid it.

### Examples of new copy directions

Use this table as tone reference only, not literal current map facts:

| Stage | Example idea | Scene concept |
|---|---|---|
| 80km | “ESCAPE STATUS: STILL ON FOOT.” | Emily & Graham on a long-lit path, crow checking a wanted poster, Ben by car |
| 90km | “THE WARDEN HAS GIVEN UP COUNTING.” | Night/dawn roadside, crow running a distance abacus |
| Route 100km | “THE GETAWAY HAS GOTTEN OUT OF HAND.” | Triumphant feet, Ben's car/refreshments and Graham's matching steps |
| Official gold | “WANTED: SIXTY MILES FROM MERIDEN.” | Gold radial-ring motif with crow flying in a straight line; explain official basis |
| 110km | “THE CROW REQUESTS A REST DAY.” | Crow on folding chair while Emily keeps marching |
| 120km | “THE MAP IS ASKING QUESTIONS.” | Wild map unfurling toward the next researched town |
| Stretch end | “FLIGHT RISK: OFF THE CHARTS.” | Full group celebration with a distinctive finish landscape |

These are illustrative copy ideas; verify chosen geography and milestone title with the owner and map before rendering.

## 4. Artwork generation and review loop

1. Obtain clear frontal/three-quarter photos and approved illustrated avatar reference for every person. Match color, line style and proportion. Write a one-page cast sheet: names, roles at different kilometre stages, hair, glasses, age appearance, outfit (orange jumpsuit if desired), correct driver vs walker.
2. Lock milestone table with ID, threshold, award metric, route area/town, funny line, cast and crow pose. Show table for feedback before rendering.
3. Generate **each poster separately** using image generation, feeding the accepted style and appropriate person refs, not a previous poster as a rigid template. Ensure original numbers/words are accurately lettered, or place type with code-native overlay if generator misses text.
4. Build a review contact sheet with at least 80,90,100,gold,110,120,123 plus earlier preserved 50,60,70 previews; verify the cast and *different* location/crow/line at glance. Get owner's explicit approval.
5. Export full PNG and optimized WebP preview with tested aspect ratio. Use stable, unique filenames per ID (never point all manifest keys at one asset). Consider opaque hashed filenames for unreleased art to reduce accidental discovery, but do not rely on obscurity as security.
6. Wire manifest `preview`, `download`, `width`, `height`. Validate that all files exist, MIME is correct, aspect ratios match, mobile full-screen viewer works, preview tap and Save/Download work, and art is **not preloaded to runner** before release.
7. Keep old moment assets unchanged once they were shown. A later correction should be a versioned replacement only with owner approval; test that the correct manifest ID shows the correct historical poster.

## 5. Unlock/replay system

- Definitions live in `lib/race-milestones.ts`; poster IDs in `lib/crew-room.ts`, `public/data/poster-manifest.json`, `public/race-moments.js` and `public/celebrations.js` must match.
- Exact auto-release is server-side after GPS crossing corroboration and D1 persistence. A manual future preview in editor must not set release or mark achieved.
- Moment history lists completed achievements first and upcoming targets below. User sees “Crossed” time/evidence; uncertainty shown. “Enjoy this moment again ♡” opens the memory/celebration; avoid a second redundant “Open posters” CTA.
- Current live milestone triggers one finite animation/toast, reduced-motion respects accessibility, and acknowledgement prevents duplicate replay on polling/reload. When multiple old milestones arrived during a connectivity gap, earlier posters remain available even if only latest modal opens.
- 50/60/70 originals remain in source manifest; false missing original asset must be caught before publication. Non-poster targets (start, award markers) may have a toast without a poster if decided explicitly.

## 6. Intro animation: exact behavioral expectations

Original “Great Escape” silent ~8.8s phone intro, 3 compressed images (~728KB): establishes characters, prisoner escape theme, “Flight risk: very high”, then reveals real map. It is **an overlay, not a fake/demo map**. Map/tracker/room mount first. Immediate Skip and reduced-motion “Open map”; Pause/Resume; replay from Tools; local seen flag per event. Missing assets or network failures fail open to map. Intro does not reset role, agreed meeting, GPS sharing, map follow or release milestones. Valid celebration waits until intro closes. For a new race, the opening copy/theme can change, but these controls and safety details remain.

## 7. User review checklist

- Are all names/look-alikes recognizably correct and the right age? No older-looking wrinkles inadvertently added.
- Does every stage have **different** crow posture, background, destination and original punchline?
- Is the person riding in the car actually drawn with the vehicle, while the walker accompanies runner?
- Are the landmark/town claims verified? Is an interpolated route dot labelled as a planning reference rather than an actual meet-up?
- Are route km and radial gold *clearly distinct*?
- Are earlier delivered/seen originals untouched?
- Do thumbnails and full-resolution art match the same ID? Does every planned milestone have an image?
- Does runner mode hide future art even in HTML source, service worker list, prefetch and offline saved assets?
- Has the owner seen the **full set here** and approved before the site publication step?
