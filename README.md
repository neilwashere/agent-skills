# Global agent skills

Hand-authored, machine-global skills, auto-discovered by pi from `~/.agents/skills/`.
One clone provisions every hand-authored skill on a new machine.

## Provisioning a new machine

```bash
git clone git@github.com:neilwashere/agent-skills.git ~/.agents/skills
```

That is the whole skill install. Discovery is by convention — pi scans
`~/.agents/skills/` recursively for directories containing `SKILL.md`, so no
entry in `settings.json` is required. (Root-level `.md` files are *ignored* in
this location; a skill must be a directory with a `SKILL.md`.)

Not covered by this repo, and needed separately:

- **Package-provided skills** — declared in `~/.pi/agent/settings.json` under
  `packages[]` (brave-search, browser-tools, gccli/gdcli/gmcli, transcribe,
  vscode, youtube-transcript, plus pi-sdlc / pi-worktree / pi-repo-html /
  pi-lens / pi-subagents). Run `gh auth login` **first** — several are private
  `threadsafe-systems` repos that will fail to fetch while unauthenticated.
- **Credentials** — `~/.pi/agent/auth.json` is machine-local. Re-authenticate on
  the new machine; do not copy it.
- **Global extensions** — `~/.pi/agent/extensions/`.

## Layout convention

Everything hand-authored lives here, whether it is personal law (coding
conventions, house style) or cross-harness workflow tooling. `~/.pi/agent/skills/`
remains a valid discovery location but is deliberately left empty, so there is a
single version-controlled home. Project-specific rules belong in that repo's
`.pi/skills/`.

## Skills

### Workflow tooling

- **dispatch-subagents** — launch concurrent sub-agents across models for
  parallel review, red-teaming, or cross-model verification. Primary mechanism is
  the in-harness `subagent` tool; the detached-CLI path (and its `setsid` reap
  gotcha) survives only as a headless fallback.
- **adversarial-review** — red-team a branch/PR across N independent models from
  ONE reviewer template, then consolidate, dedupe, rank by severity, and post
  inline PR comments. Includes the verification pass after fixes land. Builds on
  dispatch-subagents + gh-pr-review-comments.
- **gh-pr-review-comments** — read/reply/post inline GitHub PR review comments at
  scale; covers the `-f` vs `-F @file` trap, secondary-rate-limit spacing,
  pagination caps, and commit-vs-working-tree verification.
- **sdlc-visual-docs** — render SDLC plans/specs/build plans into self-contained
  interactive HTML (traceability, contracts, risks, DoD coverage). Deterministic
  renderer, no LLM in the render path.
- **find-skills** — discover and install agent skills on request.

### Authoring and design law

- **authoring-skills** — how to write and review a pi skill; pi's real frontmatter
  and discovery rules, not another harness's.
- **codebase-design** — shared vocabulary for designing deep modules; seams,
  interfaces, testability.
- **writing-comments** — the law for code comments and docstrings. Exists to stop
  LLM-generated comments narrating plans and roadmaps instead of explaining code.
- **conventional-commits** — mandates `type(scope): description` in every repo.
  Functional, not stylistic: semantic-release parses the type to compute version
  bumps.
- **tdd** — test-first development; red-green-refactor and integration tests.

### Utilities

- **md-to-pdf** — render Markdown to a styled A4 PDF fully offline. Layout only;
  never rewrites prose.
- **teach** — stateful, multi-session teaching of a topic. Slash-command only
  (`disable-model-invocation: true`), so it will not appear in the model-visible
  skill list.

## Deliberate exclusions

- **herdr** — the herdr skill is the upstream Rust source tree with a `SKILL.md`
  at its root (~43M). It is gitignored rather than committed; re-clone it into
  `~/.agents/skills/herdr` at version parity with the installed binary when the
  reference source is wanted.

Origin: extracted from the Loom M0 workflow (threadsafe/loom) on 2026-06-28;
consolidated into a single skills repo on 2026-07-27.
