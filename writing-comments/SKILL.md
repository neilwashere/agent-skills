---
name: writing-comments
description: The law for code comments and docstrings. Use whenever writing or reviewing code. LLM-generated comments habitually narrate plans, reviews, and roadmaps instead of explaining code — this skill exists to stop that.
---

# Writing comments

A comment serves exactly one audience: **the reader of this code, now,
who has nothing but the code**. Not the plan's author, not a reviewer, not
the session transcript. LLMs fail this constantly, because their context is
full of plans and adjudications, and it leaks into the code as comments only
a project historian could love.

## The law

1. **Serve the reader of this code, now.** If a sentence serves the
   reviewer, the planning document, or the conversation that produced the
   code, delete it.
2. **Never cite process artifacts.** No plan sections, decision numbers,
   DoD/scenario ids, issue numbers, PR/panel findings, slice or phase names.
   Git blame and the PR carry provenance; comments do not.
3. **Never document absence or futures.** No "X was removed because…", no
   "Y arrives in a later slice", no tombstones for deleted code.
   *Exception:* behavior a caller must plan around is documented as
   **present behavior** — "the map is never pruned; callers must dispose
   threads" — not as an apology or a roadmap.
4. **Say what, and the non-obvious why.** Contracts, invariants, concurrency
   semantics, surprising parameter choices. If the code says it plainly,
   write nothing.
5. **The staleness test.** If a comment could become false without this file
   changing, it is already wrong. (References to other slices, future work,
   review events, and current call-site lists all fail this test.)
6. **The law covers every string that ships, not just comments.** A
   `description`, an `error_message`, an assertion message, a log line, a test
   name and a resource `name` are all read by someone who has no plan and no PR.
   Infrastructure makes this sharper: a resource name is often immutable, so a
   plan id written there outlives the plan that produced it, and changing it
   later means replacing the resource.
7. **Name the role, not the person.** "The security owner holds root", not "Sam
   holds root". People change roles and leave; the constraint does not. Personnel
   belong in a register with an owner column, updated in one place.

## Worked examples (from real review history)

### Rubbish: provenance and roadmap narration

```ts
/**
 * Real pi-backed sessions, isolated from the host machine:
 *
 * - `SessionManager.inMemory()` — sessions are in-memory ONLY (Plan §3
 *   decision 2). A process restart drops live threads; cross-restart
 *   continuity is deliberately Honcho's job in a later slice, not pi
 *   persistence. Known, accepted gap.
 * - `noTools: "all"` — the spine runs no tools; the tool slice adds them.
 */
```

"Plan §3 decision 2" is a citation to a document the reader doesn't have.
"Honcho's job in a later slice" narrates code that doesn't exist. "Known,
accepted gap" is an apology to a reviewer. After stripping, what remains is
what the reader needed all along:

```ts
/**
 * Creates real pi sessions: in-memory only (nothing is persisted; sessions
 * die with the process), no tools enabled, and cwd/agentDir pointed at an
 * empty temp dir so no ambient pi extensions, skills, or user settings
 * leak in.
 */
```

### Rubbish: the tombstone

```ts
// NOTE: no hand-authored config type lives here yet. The PR panel flagged
// the original SpineConfig as speculative generality (zero consumers — the
// real config seam is @case/agent's PiSessionFactoryConfig...). Per the
// Plan's YAGNI discipline, a core config type appears when a consumer
// forces it.
```

A comment documenting **code that does not exist**, justified by **a review
event**. The reader learns nothing about the file they are in. The correct
comment is no comment.

### Good: observable semantics a caller must know

```ts
/**
 * Concurrency model: ALL session access for a thread — creation, prompting,
 * and disposal — runs on one per-thread promise chain, in arrival order. A
 * `dispose` issued between two prompts therefore runs between them, never
 * concurrently with either.
 *
 * The session and queue maps are UNBOUNDED — no idle timer, LRU, or TTL;
 * callers must dispose threads explicitly via `dispose()`. Sessions are
 * IN-MEMORY only: nothing is persisted, and a restart drops live threads.
 */
```

Every sentence describes behavior you could test. The deferral sentences
earn their place because they **change caller obligations**, and they say
what the code does now — no eviction policy that doesn't exist, no plan
citations, no "later slice".

### Rubbish: the plan id in a shipped string

```hcl
variable "region_pin_exempt_actions" {
  description = "Actions SCP-01 permits outside eu-west-2. Spec C2's closed list; extensions are reviewed pull requests."
}

# ec2:Describe* is deliberately absent — an owner decision recorded in the build
# plan (A-B14), not an oversight.
```

"Spec C2", "A-B14" and "reviewed pull requests" are all invisible to the person
reading this in the console at 3am. "Deliberately", "not an oversight" and
"owner decision" are an argument with a reviewer. Strip all of it and the
operational fact survives intact:

```hcl
variable "region_pin_exempt_actions" {
  description = "Actions permitted outside eu-west-2. Widening this widens the only preventive region control in the estate."
}

# ec2:Describe* is absent, so any call that enumerates resources in another
# region is denied — including read-only verification, which reports the other
# sixteen regions as uninspected rather than clean.
```

**One carve-out, for verification output only.** A check script may print the
scenario or control id it evidences — `S13-EXCEPTIONS: pass` — because mapping a
run to the thing it proves is that line's whole job. It does not extend to the
comments in the same file.

## Checklist before you commit

- [ ] Would this comment make sense to someone who has never seen the plan,
      the PR, or this conversation?
- [ ] Is it a `description`, `error_message`, log line, test name or resource
      name? → the same rules apply, and an immutable name applies them hardest.
- [ ] Does it name a person for something a role owns? → name the role.
- [ ] Does it reference any issue number, plan section, DoD id, review
      finding, or phase/slice name? → delete the reference.
- [ ] Does it describe something absent, removed, or future? → delete, or
      rephrase as present caller-facing behavior.
- [ ] Does it restate what the code says plainly? → delete the comment.
- [ ] Could it go stale without this file changing? → it's wrong now.
