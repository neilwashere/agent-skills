# Global pi extensions

Machine-global extensions for pi. They are **not** skills — pi discovers
extensions from `~/.pi/agent/extensions/`, not from this repo, so these files
have to be placed on the new machine rather than merely cloned.

This directory contains no `SKILL.md`, so pi's skill discovery walks past it.

## Installing on a new machine

```bash
cp -a ~/.agents/skills/extensions/. ~/.pi/agent/extensions/
```

pi auto-discovers `*.ts` in that directory; only `zsh-footer.ts` additionally
needs the `extensions` entry already present in `settings.json`. Existing pi
sessions need `/reload` to pick up changes.

## Provenance

Hand-authored, this repo is the source of truth:

- **`zsh-footer.ts`** — replaces pi's default footer with a Robbyrussell
  oh-my-zsh style prompt line plus session metrics.
- **`herdr-awaiting-input.ts`** (+ `herdr-awaiting-input.test.mjs`) — reports
  "waiting for the user to answer a question" to Herdr for *every* model.
  Herdr's own pi integration claims full lifecycle authority, which switches off
  herdr's screen-detection heuristics, leaving the red "blocked" state otherwise
  unreachable for every pi pane. Deliberately a separate file so
  `herdr integration install pi` cannot clobber it. Opt out with
  `HERDR_AWAITING_INPUT=0`. Run the test with
  `node herdr-awaiting-input.test.mjs` (pi's discovery globs `*.ts`, so the
  `.mjs` test is not auto-loaded).
- **`herdr-pi-subagents-patch.sh`** — reapplies the pi-subagents
  async-visibility patch to the *generated* `herdr-agent-state.ts` after herdr
  overwrites it. Idempotent; warns rather than guessing if the anchor text has
  drifted.
- **`subagent/config.json`** — pi-subagents config (spawn cap, scheduled runs
  enabled).

Generated, **not** authoritative:

- **`herdr-agent-state.ts`** — installed and owned by herdr
  (`HERDR_INTEGRATION_ID=pi`, `HERDR_INTEGRATION_VERSION=6`), then locally
  patched. The committed copy is a reference snapshot that will go stale as
  herdr updates. On a new machine prefer regenerating it:

  ```bash
  herdr integration install pi          # regenerate for the installed herdr
  ./herdr-pi-subagents-patch.sh         # reapply the local patch
  ```
