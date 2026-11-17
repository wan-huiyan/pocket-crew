# Pocket Crew skill

**`build-ultra-crew-guide` · version 1.0.0**

Plan, build, adapt, operate or archive a phone-first ultramarathon crew guide. The skill retains the original export’s architecture, behavior, setup, artwork, race-day, replay, archive and validation references. Its entry point supports both new events and scoped edits to an existing guide.

## Install in Codex

Ask Codex:

```text
Use $skill-installer to install https://github.com/wan-huiyan/pocket-crew/tree/skill-v1.0.0/skills/build-ultra-crew-guide
```

The bundled Codex installer also supports a terminal command:

```sh
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo wan-huiyan/pocket-crew \
  --ref skill-v1.0.0 \
  --path skills/build-ultra-crew-guide \
  --method git
```

Git mode retrieves the skill with a sparse checkout instead of downloading all the application artwork. The installer refuses to overwrite an existing skill. The skill is available on the next turn after installation.

## Install from the ZIP

Download **[build-ultra-crew-guide-v1.0.0.zip](https://github.com/wan-huiyan/pocket-crew/releases/download/skill-v1.0.0/build-ultra-crew-guide-v1.0.0.zip)** from the [versioned release](https://github.com/wan-huiyan/pocket-crew/releases/tag/skill-v1.0.0). Extract the `build-ultra-crew-guide/` folder into your agent’s supported skills directory. Codex defaults to `~/.codex/skills/`, or `$CODEX_HOME/skills` when configured. Keep all subfolders together; avoid an extra nested `build-ultra-crew-guide/build-ultra-crew-guide/` level.

```text
skills/
└── build-ultra-crew-guide/
    ├── SKILL.md
    ├── agents/openai.yaml
    ├── assets/icon.svg
    ├── scripts/audit_crow_source.mjs
    └── references/  (eight guides)
```

## Use it

```text
Use $build-ultra-crew-guide to adapt Pocket Crew for our next 24-hour ultra.
Start with the event, route, official tracker and crew details; preserve the
existing artwork until we choose replacements.
```

You can also request a narrow diagnosis or a finished-race archive. The skill should not select itself for a general training plan, nutrition question or unrelated website.

The installed skill does not bundle the app, application dependencies, tests, race artwork, GPS records, database or credentials. Use a separate [Pocket Crew checkout](https://github.com/wan-huiyan/pocket-crew) or authorized source export for implementation. Source-audit use requires Node.js; the example app requires Node.js 22.13 or later. Sites and image-generation integrations are needed only for tasks that actually use them.

To inventory an application checkout:

```sh
node /path/to/build-ultra-crew-guide/scripts/audit_crow_source.mjs /path/to/pocket-crew
```

The helper reads source files only. It never fetches live data, changes code, reads the database or deploys. Exit 1 requires structural review. A `structure-present` result still needs human review of event markers, permissions and applicable application checks.

## Publication notes

Prepared from the owner-supplied original skill export on 17 November 2026. The original export is retained separately. This distribution has a shorter entry point, Pocket Crew discovery metadata, the public example source link and installation instructions. Private hosting identifiers and desktop metadata are excluded. The source auditor flags any hosted project ID for deliberate migration review; no old production project ID is embedded.

The references retain historical Meriden examples. Their old test counts and implementation descriptions are supplied historical notes, not new qualification results. This release validates skill structure, resource links and a read-only inventory of the example source; it does not claim new application build, portable test-suite, browser or phone qualification.

No blanket license has been assigned to the skill export or application. Original artwork, personal likenesses and third-party event/provider data retain their respective rights. Public availability alone is not a reuse license.
