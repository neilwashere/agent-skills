# pi skill spec — exact fields, paths, validation

Lookup reference for [authoring-skills](../SKILL.md). Grounded in pi's own
`docs/skills.md`; when in doubt, re-read that file in the installed pi package,
since docs can drift from a newer pin.

## Frontmatter fields

A `SKILL.md` opens with YAML frontmatter. Only `name` and `description` are
required; the rest are optional and unknown fields are ignored.

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 1-64 chars, lowercase `a-z`, `0-9`, hyphens. No leading/trailing hyphen, no consecutive hyphens. pi does **not** force it to match the directory name. |
| `description` | yes | Max 1024 chars. What the skill does **and** when to use it — this is the trigger. A missing description means the skill does not load at all. |
| `license` | no | License name or reference to a bundled file. |
| `compatibility` | no | Max 500 chars. Environment requirements. |
| `metadata` | no | Arbitrary key-value map. |
| `allowed-tools` | no | Space-delimited pre-approved tool list (experimental). |
| `disable-model-invocation` | no | `true` hides the skill from the system prompt; only `/skill:name` (user-invoked) can reach it. The `description` then reads as human-facing. |

Do **not** invent fields like `version`, `triggers`, `tools`, or `mutating` —
those come from other harnesses (Codex/Claude GBrain) and pi ignores them. Put
trigger phrasing *inside* `description`.

## Discovery locations

pi loads skills from, in order:

- **Global**: `~/.pi/agent/skills/` and `~/.agents/skills/`
- **Project** (only after the project is trusted): `.pi/skills/`, and
  `.agents/skills/` in cwd and ancestor dirs up to the git root
- **Packages**: `skills/` dirs or `pi.skills` entries in `package.json`
- **Settings**: a `skills` array of files/dirs in settings.json
- **CLI**: `--skill <path>` (repeatable, additive even with `--no-skills`)

Discovery rules:

- In `~/.pi/agent/skills/` and `.pi/skills/`, a bare root `.md` file is
  discovered as an individual skill.
- In every location, a directory containing `SKILL.md` is discovered
  recursively.
- In `~/.agents/skills/` and project `.agents/skills/`, bare root `.md` files
  are **ignored** — those need the directory + `SKILL.md` form.
- Name collisions across locations warn and keep the first found.

Convention in this setup: `~/.agents/skills/` holds every hand-authored global
skill — both machine-global personal law (coding conventions, house style) and
cross-harness workflow tooling — as one version-controlled repo, so a single
clone provisions a new machine. A repo's `.pi/skills/` holds rules specific to
that project. `~/.pi/agent/skills/` is left empty by choice; it stays a valid
discovery location, just an unused one.

## Directory shape

```
skill-name/
├── SKILL.md          required: frontmatter + instructions
├── references/       optional: lookup docs loaded on demand
├── scripts/          optional: executable helpers the agent runs
└── assets/           optional: templates/files used in output, not read into context
```

Reference sibling files with relative paths from the skill directory, e.g.
`[the spec](references/pi-skill-spec.md)`. Keep disclosed references one level
deep so every pointer links directly from `SKILL.md`.

Do not add `README.md`, `CHANGELOG.md`, or setup/process docs inside a skill —
a skill carries only what an agent needs to do the job.

## Commands and invocation

- Every discovered skill registers a `/skill:name` command; args after it are
  appended as `User: <args>`.
- Model-invoked (default): the description sits in the system prompt every turn,
  so the agent can fire it autonomously and other skills can reach it. Pays
  permanent context load.
- User-invoked (`disable-model-invocation: true`): zero context load, but only
  a human typing `/skill:name` can reach it — no other skill can.
- `--no-skills` disables discovery; explicit `--skill <path>` still loads.

## Validation behaviour

pi validates against the Agent Skills standard but is lenient — most problems
warn and still load:

- name too long / bad chars / leading-trailing / consecutive hyphens → warn
- description over 1024 chars → warn
- unknown frontmatter fields → ignored
- **missing description → not loaded** (the one hard failure)
