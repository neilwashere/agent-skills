# IA graph schema — v0-experimental

**Status: v0-experimental. Nothing may bind to this schema — no tooling, no
CI, no other skills — until a separate v1 freeze taken through a full
irreversible-track lifecycle. Artefacts authored against v0 may need touch-ups
if the pilot forces changes.**

This schema defines the only structured layer added to SDLC markdown
artefacts: a graph of stable node IDs and typed edges. Prose remains the
normative content of every artefact; the graph exists so that traceability
(what verifies what, what implements what, what is uncovered) is precise,
lintable, and renderable, instead of being reconstructed in reviewers' heads.

## Artefact kinds

| kind | phase artefact | typical home |
|---|---|---|
| `plan` | objectives, rationale, scope, DoD, risks | `docs/plans/<date>-<feat>.md` |
| `spec` | contracts, requirements, verification scenarios | `docs/specs/<date>-<feat>.md` |
| `build` | task breakdown | `docs/plans/<date>-<feat>-build.md` |

## Front matter

YAML front matter delimited by `---` lines at the top of the file. Recognised
keys (unknown keys are ignored, reserved for future versions):

| key | required | value |
|---|---|---|
| `ia` | yes | schema version string; currently `v0-experimental` |
| `kind` | yes | `plan` \| `spec` \| `build` |
| `feature` | yes | feature slug, shared across the artefact chain |
| `upstream` | no (plan: absent) | path to the artefact one phase earlier, relative to the repo root of the artefact |
| `links` | no | list of `[from, type, to]` edge triples |

The YAML subset is deliberately tiny: string scalars and flow lists
(`[a, b, c]`) under `links`. No anchors, aliases, nesting, block scalars, or
multi-line values. Parsers must reject files where `links` entries are not
three-element flow lists.

## Nodes

Nodes are declared **inline in headings**, never in front matter, so titles
cannot drift between YAML and prose. Declaration pattern (regex, applied per
line, heading levels 2 to 4):

```
^#{2,4} (ID): (title)$
```

| node | ID pattern | declared in | meaning |
|---|---|---|---|
| Objective | `O<digits>` | plan | what the change is for |
| Contract | `C<digits>` | spec | a shape being frozen; body says who binds to it |
| Scenario | `S<digits>` or any stable token containing `.` (e.g. `M1.S1`) | spec | falsifiable verification scenario with pass/fail conditions |
| Task | `T<digits>` | build | unit of implementation; body names check commands |
| Risk | `R<digits>` | plan or spec | body carries the mitigation; optionally a `severity: low|medium|high` line |
| DoD item | `D<digits>` | plan | definition-of-done entry |

Rules:

- IDs are unique across the whole upstream chain, not just one file.
- The scenario escape hatch (`M1.S1` style tokens) exists so pre-schema
  artefacts keep their published scenario IDs. New artefacts should use
  `S<digits>`.
- A node's section runs from its heading to the next heading of the same or
  higher level; the `severity:` line for risks is read from that section.

## Edges

Edges are declared once, in the front matter `links` list of whichever
artefact naturally owns the relationship (usually the downstream one). Both
endpoints may live in other files in the upstream chain.

| edge | required? | meaning |
|---|---|---|
| `S verifies O` | every scenario must have at least one | the scenario falsifies the objective's claim |
| `S verifies C` | every contract must have at least one | a contract no scenario can falsify is a broken spec |
| `T implements S` | every build task must have at least one `implements` or `covered-by` | task delivers the scenario |
| `D covered-by S\|T` | recommended | DoD item is discharged by a scenario or task; on the fast path (no spec) `D covered-by T` substitutes for `T implements S` |
| `R mitigated-by S` | optional; high-severity risks without one are flagged | scenario verifies the mitigation |

## Validation (normative lint behaviour)

Fail (exit non-zero):

1. Any edge endpoint that resolves to no declared node across the chain.
2. A scenario with no `verifies` edge to an objective.
3. A contract with no `verifies` edge from any scenario.
4. In a `build` artefact: a task with no `implements` and no `covered-by`
   edge referencing it.
5. Malformed front matter: missing required keys, unknown `kind`, a `links`
   entry that is not a three-element flow list, or an unknown edge type.
6. Duplicate node IDs anywhere in the chain.

Flag (warn, exit zero): a risk whose section contains `severity: high` and
has no `mitigated-by` edge.

Report (always): every node found, per file, so a heading that silently
failed the declaration pattern is visible as an absence.

## Cross-document resolution

`upstream` forms a chain (build -> spec -> plan, or build -> plan on the fast
path). Tools load the whole chain before validating or rendering, so any
artefact is a valid entry point and cross-file edges are first-class. Cycles
and missing upstream files are hard errors.

## Versioning

`ia: v0-experimental` marks every artefact written against this document.
A future v1 freeze is an irreversible-track change: it will fix the node and
edge vocabularies, the heading pattern, and the front-matter keys, and define
a migration note for v0 artefacts. Until then this document may change with
ordinary review.
