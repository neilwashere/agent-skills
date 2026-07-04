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

Two ways to fan the one template out across models. Both are first-class.

### Path A — `subagent` tool + generated agent files (in-harness, what this session used)

The `subagent` tool dispatches by **agent name**, and an agent's model is fixed
by its frontmatter — so you need one small agent file per model. Generate them
from the template instead of hand-writing:

```bash
scripts/gen-adversaries.sh \
  deepseek/deepseek-v4-pro \
  zai-coding-cn/glm-5.1 \
  kimi-ai/kimi-k2.7-code \
  amazon-bedrock/eu.anthropic.claude-opus-4-8=opus \
  openai/gpt-5.5=gpt
```

- Each arg is `provider/model` or `provider/model=alias`. The alias (or the
  model's last segment, sanitized) becomes the agent name `adversary-<alias>`.
- Writes to `.pi/agents/` by default (project scope); `--user` targets
  `~/.pi/agent/agents/`. `--clean` removes previously generated `adversary-*`
  files. `--tools "read,grep,find,ls,bash"` overrides the default tool set.
- Then dispatch them in parallel with the `subagent` tool (`agentScope: both`,
  `confirmProjectAgents: false`), one task per agent, same task body.

Pros: results come back inline, no detachment gotchas. Cons: writes throwaway
agent files (regenerate any time; they are not the source of truth).

### Path B — detached CLI, zero per-model files (see the `dispatch-subagents` skill)

`dispatch-subagents` already stamps ONE prompt file across `--model` flags via
its own `REVIEWER_TAG` replacement and survives tool-call process-group reaping
with `setsid`. Use it when you want no agent files at all:

```bash
~/.agents/skills/dispatch-subagents/scripts/dispatch.sh \
  --prompt /tmp/adversary.prompt.txt --out /tmp/run1 --thinking high \
  --model deepseek/deepseek-v4-pro --model zai-coding-cn/glm-5.1 \
  --model kimi-ai/kimi-k2.7-code --model amazon-bedrock/eu.anthropic.claude-opus-4-8
```

Build `/tmp/adversary.prompt.txt` from `assets/adversary.prompt.md` plus the
concrete task block (see below). Follow that skill for model discovery
(`list-models.sh`), the 0-byte-log-is-not-failure rule, and monitoring.

## Workflow

1. **Scope.** Get the PR (`gh pr view N --json …`), the head SHA
   (`git rev-parse HEAD` — full 40 chars; you need it for inline comments), and
   the diff: `git diff origin/<base>...HEAD > /tmp/review.diff`.
2. **Verify the models exist** before dispatching — a hallucinated model id just
   produces an empty run. `~/.agents/skills/dispatch-subagents/scripts/list-models.sh`
   lists providers with creds + the catalog.
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
