---
name: authoring-skills
description: How to write and improve a pi skill. Use when creating a new skill, editing or reviewing an existing SKILL.md, splitting a skill, or judging whether some capability should be a skill at all. Covers pi's real frontmatter and discovery rules, not another harness's.
---

# Authoring skills

A skill exists to pull **predictability** out of a stochastic agent: the same
*process* every run, not the same output. Every rule below serves that. When a
choice is unclear, pick the option that makes the agent behave the same way
next time.

pi's exact frontmatter fields, discovery locations, and validation rules are
lookup material, not process — they live in
[references/pi-skill-spec.md](references/pi-skill-spec.md). Read that file when
you need a field name or a path; the rest of this skill is how to think.

## Phase 0 — should this be a skill at all?

Skip skill creation unless both hold:

- **It recurs.** One-off work is not a skill. If the agent will do this 2+
  times, or several skills need the same reference, it earns a home.
- **It carries non-obvious knowledge.** A skill's only value is what the model
  does *not* already do by default — a procedure it gets wrong, a schema it
  can't guess, a house rule it wouldn't infer. If a competent agent already
  does the thing well unprompted, the skill is a **no-op**: it spends context
  to say nothing. Don't write it.

Where it lives (full paths in the spec reference): every hand-authored global
skill — personal law and cross-harness workflow tooling alike — in
`~/.agents/skills/`, a single version-controlled repo; project-specific rules in
the repo's `.pi/skills/`.

## Phase 1 — understand it with concrete examples

Before writing a line, get 2-3 concrete invocations: the actual sentences a
user (or another skill) would say, and what good output looks like each time.
These examples are the whole design input — they decide the triggers, the
steps, and what reference the skill must carry. If you can't name a real
trigger sentence, go back to Phase 0.

## Phase 2 — choose the shape

A skill is **steps**, **reference**, or both — they mix freely.

- **Steps**: an ordered procedure the agent performs (`tdd` is all steps).
  Each step ends on a **completion criterion** — a *checkable* condition that
  says done from not-done. Vague criteria ("understanding reached") invite the
  agent to declare victory early; make them observable ("every changed file
  builds", "each rule applied").
- **Reference**: definitions, rules, schemas, examples the agent consults on
  demand. A review skill is all reference — a flat set of rules is a fine
  shape, not a smell.

**Degrees of freedom** — match specificity to how fragile the task is:

- *High* (prose guidance): many valid approaches, decisions depend on context.
- *Medium* (pseudocode, parameterised script): a preferred pattern with room.
- *Low* (an exact script the agent runs, few knobs): fragile, error-prone, or
  a sequence that must go one way. When you catch yourself rewriting the same
  code every run, freeze it into a `scripts/` file.

## Phase 3 — write it lean

- **Front-load the description with trigger words.** It is the only text always
  in context and the sole thing that decides invocation. State what the skill
  is, then list the genuinely distinct cases that should fire it — one per
  case, no synonym padding. Put *all* "when to use" cues here; a "When to use"
  section in the body is dead weight, because the body only loads *after* the
  skill fires.
- **Lead with a word the model already owns.** A **leading word** is a compact
  concept from pretraining (*predictability*, *tracer bullet*, *red*, *the
  law*) that anchors a region of behaviour in one token and recruits priors for
  free. Repeat the token, never the sentence. Reach for an existing word before
  coining one — a made-up term recruits no priors and you pay its definition in
  tokens.
- **Prompt the positive.** Steering by prohibition backfires: *don't write
  verbose comments* drags verbosity into context and makes it more available.
  State the target behaviour instead. Keep a bare prohibition only as a
  guardrail you cannot phrase positively, and pair it with what to do.
- **Progressive disclosure.** Keep `SKILL.md` legible; push lookup material —
  schemas, long rule sets, per-variant detail — into a sibling `.md` reached by
  a pointer, loaded only when needed. The pointer's *wording* decides how
  reliably the agent reaches it, so word it for the moment it's needed. Inline
  what every run needs; disclose what only some runs reach.
- **Co-locate.** Keep a concept's definition, rules, and caveats under one
  heading so reading one part brings its neighbours.

## Phase 4 — prune

Every line pays context load, so audit line by line, then sentence by sentence:

- **No-op** — does this change behaviour versus the agent's default? If not,
  cut it. A weak leading word (*be thorough* when the agent is already
  thorough-ish) is a no-op; the fix is a stronger word, not more words.
- **Duplication** — is this meaning stated elsewhere? Keep one source of truth;
  a repeated meaning also inflates its apparent importance.
- **Relevance** — could this line go stale without the skill's behaviour
  changing? Then it's already drifting; cut or rewrite as present behaviour.
- **Sprawl** — even all-live, all-unique content can be too long. Cure it with
  disclosure and splitting, not by tolerating the length.

## Phase 5 — forward-test (when it's tricky)

For any non-trivial skill, verify it works on a *fresh* agent that doesn't know
it's being tested. Dispatch a subagent with a realistic task and the skill —
`Use <skill> at <path> to do <realistic task>` — never "review this skill" or a
hint of the intended answer. Pass raw artifacts, not your diagnosis. If it only
succeeds when the subagent can see leaked context, the skill isn't carrying its
own weight yet — tighten it and retest on a clean thread.

## When to split one skill into two

Each split spends a load, so only cut when it earns it:

- **By trigger** — split off a new model-invoked skill when it has a distinct
  leading word that should fire it on its own. You pay context load for the new
  always-loaded description, so that independent reach must be worth it.
- **By sequence** — split a run of steps when the later steps, visible in
  context, tempt the agent to rush the current one (**premature completion**).
  Sharpen the completion criterion first — it's cheap and local. Only hide the
  later steps behind a separate skill or subagent when the criterion is
  irreducibly fuzzy *and* you actually see the rush; hiding only works across a
  real context boundary.

## Failure modes to diagnose against

- **No-op** — pays load to say what the agent already does.
- **Premature completion** — a step ends before it's truly done; attention
  slipped to *being done*. Cure: sharper completion criterion, then hiding.
- **Duplication** — one meaning in two places; maintenance and token cost.
- **Sediment** — stale layers that pile up because adding feels safe and
  removing feels risky. The default fate without a pruning pass.
- **Sprawl** — simply too long; cure with disclosure and splitting.
- **Negation** — steering by "don't", which makes the banned behaviour more
  available. Cure: prompt the positive target.
