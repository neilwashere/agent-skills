---
name: sdlc-visual-docs
description: Render SDLC plans, specs, and build plans (markdown with IA graph front matter) into self-contained, interactive HTML pages showing traceability, contracts, risks, and DoD coverage. Use at design gates when a human wants a visual, information-rich view of a proposed change, or to lint the objective/scenario/task graph of an artefact. Deterministic renderer, zero dependencies, no LLM in the render path.
---

# sdlc-visual-docs

Turns SDLC artefacts (plan, spec, build plan) into one self-contained HTML
page per artefact: traceability matrix, contract surface panel, architecture
diagrams (Mermaid), risk map, and DoD coverage, all computed from a small
"IA graph" declared in the artefacts themselves. Prose stays normative and
stays markdown; the HTML is a projection, never a source.

Announce at start: "Using sdlc-visual-docs to lint/render the artefact."

## When to use

- A human is about to review a plan/spec/build gate and wants the shape of
  the change, not just the prose.
- You authored or changed an SDLC artefact and want to validate its
  traceability graph (dangling IDs, unverified contracts, uncovered DoD).
- "Render the spec", "show me the trace", "lint the plan graph".

## Commands

```bash
node scripts/lint.mjs <artefact.md>            # validate the IA graph (follows upstream)
node scripts/render.mjs <artefact.md> -o out.html   # render one self-contained page
node --test scripts/*.test.mjs                  # run the skill's own tests
```

Paths are relative to this skill directory; artefact paths are wherever the
repo keeps them (e.g. `docs/plans/...`). Rendered output is ephemeral: do not
commit it to the target repo unless the repo explicitly wants a gate-evidence
snapshot. Never add a CI check that diffs rendered output.

## Authoring rules (the IA graph)

The schema is defined normatively in `docs/schema.md` (v0-experimental:
nothing may bind to it until a v1 freeze). Summary:

1. **Nodes are declared inline in headings**, pattern:

   ```
   ## O1: one-line title          (heading level 2 to 4)
   ### S3: resume survives SIGKILL
   #### R2: schema churn during the experimental window
   ```

   ID vocabulary: `O` objectives (plan), `C` contracts (spec), `S` scenarios
   (spec; any stable string containing no spaces is accepted, e.g. `M1.S1`),
   `T` tasks (build), `R` risks (plan or spec), `D` DoD items (plan).
   The pattern is strict: `#`s, space, ID, colon, space, title. A heading
   that almost matches is silently prose, so run lint and read its node
   report after authoring (it lists every node it found per file).

2. **Edges are declared once, in YAML front matter**, as `links` triples:

   ```yaml
   ---
   ia: v0-experimental
   kind: spec            # plan | spec | build
   feature: my-feature
   upstream: docs/plans/2026-07-06-my-feature.md
   links:
     - [S1, verifies, O1]
     - [S1, verifies, C1]
     - [R2, mitigated-by, S1]
   ---
   ```

   Edge vocabulary: `S verifies O` (required for every scenario), `S verifies
   C` (required for every contract), `T implements S` (build plans; on the
   fast path, where no spec exists, `D covered-by T` is the substitute),
   `R mitigated-by S`, `D covered-by S|T`. `upstream` points at the artefact
   one phase earlier (spec to plan, build to spec or plan); lint and render
   follow the chain, so cross-document edges are fine.

3. **Diagrams** are fenced ```mermaid blocks in the body; the renderer
   inlines them and the vendored Mermaid renders them client-side, offline.

4. Front matter is a deliberately tiny YAML subset: string scalars and flow
   lists (`[a, b, c]`). No anchors, no nesting beyond `links`. Keep titles
   and all prose out of front matter; that is the point of the design.

## Lint rules

Fail (exit 1): dangling edge endpoint anywhere in the upstream chain; a
scenario verifying no objective; a contract with no verifying scenario; a
build-plan task with no `implements`/`covered-by` edge. Flag (exit 0, warn):
a high-severity risk with no `mitigated-by` edge (severity is read from a
`severity: high` line in the risk's section, when present). Always: a
per-file report of every node found.

## Gotchas

- **Determinism promise**: same input, same bytes. The renderer embeds no
  timestamps and fetches nothing. Diagram *pixels* are only repeatable
  because Mermaid is vendored and pinned (see `assets/VENDOR.md` for the
  exact version and source URL); bumping Mermaid changes rendering and is a
  deliberate act, not an update chore.
- **The renderer is dumb on purpose.** No LLM anywhere in lint or render.
  If a diagram or trace looks wrong, fix the artefact, not the output.
- **Edge-gaming**: lint only checks shape. A nonsense edge (written to
  silence lint) renders exactly where reviewers look, so it gets caught at
  the gate, not by tooling. Do not add edges you cannot defend in review.
- The markdown renderer is a small hand-rolled subset (headings, paragraphs,
  lists, tables, fenced code, links, bold/italic/inline code, blockquotes).
  Exotic markdown may render as plain paragraphs; keep artefacts simple.

## Layout

```
SKILL.md            this file
docs/schema.md      IA graph schema v0 (normative)
scripts/render.mjs  artefact -> one self-contained HTML page
scripts/lint.mjs    graph validation
scripts/lib/        shared parser (front matter, headings, graph, markdown)
scripts/*.test.mjs  node --test suites
assets/style.css    inlined into output
assets/app.js       inlined into output (vanilla JS interactivity)
assets/mermaid.min.js  vendored, pinned (assets/VENDOR.md records version)
fixtures/           well-formed and broken artefact fixtures for tests
```
