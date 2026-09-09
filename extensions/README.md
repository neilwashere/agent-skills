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
- **`herdr-agent-state.test.mjs`** — exercises the generated integration against
  a local socket, including restored busy state and blocked-state precedence.
- **`herdr-pi-subagents-patch.sh`** — adds support for the counted `herdr:busy`
  sibling event to the *generated* `herdr-agent-state.ts` after herdr overwrites
  it. pi-subagents owns active-run recovery across reloads; this overlay keeps
  Herdr's semantic state working while recovered async work remains active.
  Idempotent; warns rather than guessing if the generated anchors drift.
- **`subagent/config.json`** — pi-subagents config (spawn cap, scheduled runs
  enabled).

Generated, **not** authoritative:

- **`herdr-agent-state.ts`** — installed and owned by herdr
  (`HERDR_INTEGRATION_ID=pi`, `HERDR_INTEGRATION_VERSION=8`), then locally
  patched. The committed copy is a reference snapshot that will go stale as
  herdr updates. On a new machine prefer regenerating it:

  **2026-09-09 status check** (herdr 0.9.0, pi-subagents 0.66.0): both halves of
  the status indicator work once the running pi process has loaded the current
  file.
  - Pi's own working/idle/blocked state: v8 gated `session_start` on
    `ctx.mode === "tui"` (previously `ctx.hasUI`), replacing the old
    screen-scrape fallback with `full_lifecycle_hook_authority`. A pi pane that
    hasn't reloaded since the herdr 0.9.0 upgrade stays on the *old* in-memory
    extension and silently falls back to herdr's remote screen-detection
    manifest, which still looks for the literal string `Working...` — text
    current Pi no longer prints (`herdr agent explain <pane> --json` shows
    `screen_detection_skipped: false` and a `working_literal` rule that never
    matches). Fix: `/reload` every open pi pane after any herdr integration
    regeneration; `herdr agent explain <pane_id> --json` should then report
    `screen_detection_skip_reason: full_lifecycle_hook_authority`.
  - pi-subagents activity: pi-subagents 0.66.0 ships its own Herdr bridge
    (`src/integrations/herdr-status.ts`) that calls
    `herdr pane report-metadata --applies-to-source herdr:pi` directly — no
    patch to this file required for the visible label/state-labels/tokens
    (confirmed live: `herdr agent explain` showed `state_labels` and a
    `⏳ 1 subagent (scout)` summary token while an async run was active). The
    `herdr:busy` overlay patched below still adds value on top of that: it
    flips the *underlying* `state` (not just the label text) to `working`
    while async subagents run after the root turn goes idle, which is what
    drives herdr's busy/idle color, not just its text.
  - `herdr-agent-state.test.mjs` had drifted from the v8 gate change above
    (its mock `session_start` context lacked `mode: "tui"`, so every report
    silently no-opped and the test timed out). Fixed by adding `mode: "tui"`
    to the mock context.

  Regenerate from scratch:

  ```bash
  herdr integration install pi          # regenerate for the installed herdr
  ./herdr-pi-subagents-patch.sh         # reapply the local patch
  node herdr-agent-state.test.mjs       # verify busy/blocked state transitions
  ```
