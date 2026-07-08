---
name: adversarial-review
description: Run an adversarial code review of a branch/PR across N independent models from ONE reviewer template, then consolidate, dedupe, rank by severity, and post inline PR comments. Use for cross-model red-teaming of a diff, and for the follow-up verification pass after the author pushes fixes. Covers the single-source reviewer prompt, two instantiation paths (subagent tool vs detached CLI), consolidation, and posting.
---

# adversarial-review

Cross-model adversarial review built from a real session that red-teamed a PR
with 5 independent models (DeepSeek, GLM, Kimi, Claude Opus, GPT-5.5), posted 21
ranked inline comments, then ran a second verification pass after the author's
fix-wave.

The whole point: **one reviewer template, instantiated for as many models as you
choose.** Never hand-copy a prompt per model — that duplication is the smell this
skill removes.

## When to use

- "Dispatch N adversarial models against this branch / PR."
- "Are the reviewers satisfied?" — the verification pass after fixes land.
- Any time you want independent models to hunt for real defects in a diff and
  turn the union of their findings into ranked, deduplicated PR feedback.

## The single source of truth

`assets/adversary.prompt.md` is the **only** copy of the reviewer system prompt.
It hunts for real defects (not style), demands a strict per-finding output
format, and contains the literal token `REVIEWER_TAG` so each instance can
self-identify. Edit the methodology in exactly one place.

## Pick an instantiation path

Two ways to fan the one template out across models. Both are first-class; see
the `dispatch-subagents` skill for the full mechanics of either.

### Path A — `subagent` tool, one shared agent, per-task model override (in-harness, default choice)

pi-subagents accepts `model` as a **per-task** override in a single `tasks: [...]`
call, so — unlike the original version of this workflow — you no longer need
one agent file per model. One static, model-agnostic agent is enough:

```bash
scripts/ensure-adversary-agent.sh --user   # or --dir .pi/agents for project scope
```

A plain re-run is idempotent (no-op) when nothing changed, and refuses to
overwrite if `adversary.md` exists with *different* content — so a hand-edit
isn't silently clobbered. After editing `assets/adversary.prompt.md`, re-run
with `--force` to refresh it. No per-model files, nothing to `--clean`. Then
dispatch the panel in one call:

```ts
subagent({ tasks: [
  { agent: "adversary", task: "<shared task block>", model: "deepseek/deepseek-v4-pro" },
  { agent: "adversary", task: "<shared task block>", model: "zai-coding-cn/glm-5.2" },
  { agent: "adversary", task: "<shared task block>", model: "moonshotai/kimi-k2.7-code" },
  { agent: "adversary", task: "<shared task block>", model: "amazon-bedrock/global.anthropic.claude-opus-4-8" },
] })
```

Per-model attribution comes from each task's `result.model`/`result.usage` in
the tool result directly — not from prompt text — so there's no need to stamp
REVIEWER_TAG per model here (the shared `adversary.md` substitutes it once,
generically, at generation time). For a long panel (multiple `thinking: high`
models), add `async: true` and call `wait({ all: true })` instead of holding
one blocking tool call open — see `dispatch-subagents` for the foreground vs
background tradeoffs and the headless-notification caveat.

Pros: results come back inline (or via `wait`), no detachment gotchas, no
per-model files to regenerate or clean up. Cons: requires `pi-subagents`
installed and a live pi session/tool call to dispatch from.

### Path B — detached CLI, zero agent files at all (see the `dispatch-subagents` skill)

For a headless/non-pi-session context (cron, CI, a plain shell script), fall
back to `dispatch-subagents`' detached-CLI mechanics — it stamps ONE prompt
file across `--model` flags via its own `REVIEWER_TAG` replacement and
survives tool-call process-group reaping with `setsid`:

```bash
~/.agents/skills/dispatch-subagents/scripts/dispatch.sh \
  --prompt /tmp/adversary.prompt.txt --out /tmp/run1 --thinking high \
  --model deepseek/deepseek-v4-pro --model zai-coding-cn/glm-5.2 \
  --model moonshotai/kimi-k2.7-code --model amazon-bedrock/global.anthropic.claude-opus-4-8
```

Build `/tmp/adversary.prompt.txt` from `assets/adversary.prompt.md` plus the
concrete task block (see below). Follow the `dispatch-subagents` skill for
model discovery (`list-models.sh`), the 0-byte-log-is-not-failure rule (still
true for this path — unlike Path A, a bad model id here fails silently, not
loudly), and monitoring.

## Workflow

1. **Scope.** Get the PR (`gh pr view N --json …`), the head SHA
   (`git rev-parse HEAD` — full 40 chars; you need it for inline comments), and
   the diff: `git diff origin/<base>...HEAD > /tmp/review.diff`.
2. **Verify the models exist** before dispatching. On Path B (detached CLI) a
   hallucinated model id just produces an empty run; on Path A (`subagent`
   tool) a bad id now fails loudly per task, but a dead key/quota still only
   surfaces mid-run. `~/.agents/skills/dispatch-subagents/scripts/list-models.sh`
   lists providers with creds + the catalog either way.
3. **Build the task block** (appended to the template, or passed as the subagent
   task): repo path, **exact** diff path, **exact** commit SHA, which files to
   read, and "read the full files, not just the diff." For a verification pass,
   also pass the prior findings + author replies and ask for a verdict per issue
   (`RESOLVED | PARTIAL | NOT-RESOLVED | DEFERRED-OK | DEFERRED-RISKY`) plus a
   `NEW DEFECTS` section for regressions the fixes introduced.
4. **Dispatch** all models in parallel (Path A or B).
5. **Consolidate.** Merge the per-model findings: collapse duplicates into one
   issue, keep cross-model agreement as a signal ("flagged by: …"), preserve
   genuine disagreement (one model clearing what others flag is information, not
   noise). Rank `HIGH / MEDIUM / LOW`.
6. **Post inline**, ranked, via the `gh-pr-review-comments` skill's ATOMIC
   review scripts (`scripts/review-create.sh` → `review-verify.sh` →
   `review-submit.sh`): all findings go up as one PENDING review (no events,
   server-validated anchors, a 422 means nothing landed), get verified by
   content, and only the final submit emits the single review event. Bodies in
   files + a JSON manifest — never shell strings, never one-POST-per-comment.
   Key gotchas still apply: full 40-char `commit_id`; the target `line` must be
   in the diff on the RIGHT side. Model attribution per comment is optional —
   ask the operator (cross-model agreement is signal, but some prefer
   attribution-free comments).
7. **Verification pass** (when the author pushes fixes): ff-update the branch,
   regenerate the diff, fetch the threads + replies, re-dispatch the same panel
   in verify mode, reply on each thread with the consensus verdict, open new
   inline comments only for regressions, and post a top-level summary.

## Consolidation discipline

- One inline comment per **distinct** defect — the dedup across models is the
  value, not a raw dump of every model's list.
- Reviewer claims are ~80% right and tend to overreach. Verify load-bearing or
  surprising findings against the **committed** blob before posting (a working
  tree may have been auto-formatted; see `gh-pr-review-comments`).
- Don't invent line numbers. If a model is unsure, anchor to the nearest real
  in-diff line and quote the relevant code in the body.

## Choosing the panel

Use independent **vendors**, not several sizes of one family — independence is
what makes the union worth more than any single reviewer. A good default panel
is one frontier model (Opus/GPT) plus 2-3 strong open models (DeepSeek / GLM /
Kimi). Check live creds in `~/.pi/agent/auth.json`; mind per-provider quotas
(e.g. GLM's 5-hour usage cap).
