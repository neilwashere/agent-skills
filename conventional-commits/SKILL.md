---
name: conventional-commits
description: "Use whenever writing a git commit message, in any repository. Mandates the Conventional Commits format (type(scope): description) for every commit. This is a hard rule, not a style preference — tooling (semantic-release and similar) parses commit type to compute version bumps and changelogs automatically, so getting the type right is functional, not just tidy."
---

# conventional-commits

Every commit message, in every repository, follows this shape:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s), e.g. BREAKING CHANGE: <description>]
```

- `type` — required, one of the fixed vocabulary below. Nothing else.
- `(scope)` — optional, parenthesised, lowercase. Names the component,
  feature, or area touched (e.g. `(hooks)`, `(cli)`, `(auth)`). Omit it for a
  whole-repo change with no natural single scope.
- `description` — required, imperative mood ("add", not "added"/"adds"),
  concise, no trailing period. This is the line semantic-release's changelog
  generator surfaces verbatim, so make it read well on its own.
- A breaking change is signalled with a `BREAKING CHANGE: <description>`
  footer in the commit body — this is what triggers a major version bump.
  Never add it casually; it is a real, deliberate signal.
- **Do not use the `!` shorthand** (`feat!:` / `feat(api)!:`). Under
  semantic-release's default angular preset the `!` is not parsed as a
  breaking-change signal, so a `feat!:` squash produces *no release* instead
  of the major bump you intended. Always use the footer, never the `!`.

## The type vocabulary (fixed — don't invent new ones)

| type | when |
|---|---|
| `feat` | a new capability, user-visible or API-visible |
| `fix` | a bug fix |
| `docs` | documentation only (including plan/spec/design docs, READMEs) |
| `style` | formatting only, no logic change (rare to need this — a linter/formatter usually owns this) |
| `refactor` | code change that neither fixes a bug nor adds a feature |
| `perf` | a performance improvement |
| `test` | adding or correcting tests only |
| `build` | the build system or external dependencies (package.json, lockfiles, CI build config — NOT a project's own "build" *process phase*; see the collision note below) |
| `ci` | CI configuration/scripts |
| `chore` | anything else that doesn't touch source or tests (tooling, repo housekeeping) |
| `revert` | reverts a previous commit |

## Why this matters functionally, not just stylistically

`feat` → minor version bump. `fix` → patch bump. A `BREAKING CHANGE:` footer
→ major bump, regardless of type. `docs`/`style`/`chore`/
`test`/`refactor`/`build`/`ci` types with no breaking-change signal produce
no release at all under semantic-release's default rules. Get the type
wrong and you either ship a phantom release or silently skip a real one.

## Naming collision to watch for

Conventional Commits' `build:` **type** (changes to the build system or
dependencies) is unrelated to any project's own "Build" **process phase**
(e.g. a task-breakdown document in an SDLC-style workflow). A commit that
adds a build-plan *document* is a `docs` commit, not a `build` commit — the
type describes what the commit changes, never the name of whatever internal
process phase produced it.

## Working inside a phased process (e.g. plan → spec → build → implement)

If a project's own workflow labels commits by phase (a plan commit, a spec
commit, an implementation task commit), map the *phase's actual content* to
the correct type and put the phase or feature name in the scope, rather than
inventing a new type or dropping the convention for "process" commits:

- A plan or spec document → `docs(plan): ...` / `docs(spec): ...`
- A task-breakdown document → `docs(build): ...` (see the collision note —
  this is `docs`, describing a document, not `build`)
- Real feature code from an implementation task → `feat(<component>): ...`
  or `fix(<component>): ...` as appropriate
- Test-only additions → `test(<component>): ...`

The process label and the commit type answer different questions (*why is
this commit happening* vs. *what kind of change is it*) — keep both when
useful; never let one replace the other.
