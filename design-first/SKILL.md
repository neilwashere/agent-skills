---
name: design-first
description: Engineer-owned SDLC from skeptical ticket triage to Gherkin specs, Gate 1 HTML design, test-first slices, and production verification. Use when triaging an engineering ticket against in-flight work, writing @SC-n Gherkin behavioural scenarios, authoring or revising a Gate 1 HTML design artifact, or auditing a design before implementation.
---

# Design-First Engineering

Deliver one assigned outcome from skeptical triage to production verification, scaled to the change:
- **Small single-seam fix:** run Step 1 (triage), Step 2 (`@SC-n` Gherkin scenarios), and Step 4 (test-first delivery + scenario verification table).
- **Architectural, schema, multi-slice, or ambiguous-domain change:** also publish a standalone Gate 1 HTML design (Step 3) and obtain operator sign-off before writing production code.

---

## Step 1 — Skeptical Triage (Gate 0: Falsify the Premise)

Treat the incoming issue as a set of claims to test against reality, never an instruction to execute blindly.

1. **Check reality across three horizons:**
   - *Delivered:* read the live code, database migrations, and repository rules (`AGENTS.md`, `CLAUDE.md`, `.claude/rules/*`, `.keith/decisions/*`). Verify every file, symbol, schema constraint, and behaviour the ticket assumes.
   - *In-flight:* check open PRs (`gh_list_prs`) and sibling tasks in your track that touch the same module or table.
   - *Planned:* check related open issues (`gh_list_issues`) on the same seam for duplicates or contradictions.
2. **Apply the 3-way broken-window rule** to the modules in scope:
   - **Boy Scout (< ~30 LOC at the touched seam):** fold small local cleanups directly into the slice and note them in the PR.
   - **Slice 0 PR (decaying or god-object seam that forces a shunt):** extract a behaviour-preserving refactor PR before starting feature slices; keep large refactors out of feature diffs.
   - **High-bar follow-up:** file a follow-up issue *only* when adjacent debt outside your path carries active defect/compliance risk or blocks a scheduled track. Leave cosmetic or speculative cleanups noted in Discovery rather than creating issues that will rot.
3. **Surface domain and product ambiguity early:**
   - When a rule depends on domain authority (conveyancer, HoFA, Legal, Finance, Product) or an unsettled product trade-off, ask on Slack via `queue_outbound` (calling `rearm_slack_watch` on partial or bystander replies) or escalate to the operator. Stop rather than inventing domain policy.

**Done when:** Every premise in the ticket is confirmed or falsified with `file:symbol` evidence, in-flight collisions and blast radius are identified, broken-window handling is chosen, and domain ambiguities are either settled or isolated as explicit Gate 1 decisions.

---

## Step 2 — Behavioural Specs in Gherkin (Gate 2: Stress-Test the Outcome)

Write Gherkin specifications to stress-test the deliverable and its Definition of Done before choosing implementation internals. Follow the [Gherkin & NFR Reference](references/gherkin-and-nfrs.md) (Automation Panda standard).

1. **Use standard Gherkin structure:**
   - `Feature:` — one concise capability summary and user/business purpose.
   - `Rule:` *(optional)* — groups scenarios that share one business invariant.
   - `Background:` *(optional)* — shared starting state across scenarios in the feature/rule.
   - `Scenario:` or `Scenario Outline:` + `Examples:` — **one behaviour per scenario**, 3–7 steps.
2. **Tag every scenario for mechanical traceability:**
   Place `@SC-1`, `@SC-2`, … and the target test seam above each `Scenario` or `Scenario Outline`:
   ```gherkin
   @SC-1 @seam:service
   Scenario: Lender redemption statement stages HoFA payee approval without a phone call
     Given a live sale matter linked to mortgage lender "Halifax"
     And a current redemption statement filed on the matter
     When staff enter the lender's bank account citing that redemption statement
     Then an "Approve Payee Account" action is opened for the HoFA
     And no phone-verification action is opened
   ```
3. **Keep steps declarative and domain-pure:**
   - `Given` sets observable preconditions; `When` names **one** actor action or external event; `Then` states observable outcomes, refusals, and absent side effects (no writes, sends, or state transitions on refusal).
   - Pair every refusal or safety guard with an allowed control scenario.
   - Keep SQL table/column names, private helper functions, HTTP status plumbing, and CSS selectors out of Gherkin prose unless the API/CLI surface *is* the product.
4. **Apply the two Gate 2 litmus checks:**
   - *Cannot express `When` / `Then` in domain terms without guessing?* You are missing a domain rule — stop and ask a domain expert or the operator.
   - *Every scenario already passes on `main`?* The work is a behaviour-preserving **Slice 0 refactor**, not a feature.
5. **Pin every `@SC-n` to fast executable seams:**
   Target **85%+** of scenarios at fast service, API, or scratch-DB seams (`@seam:service`, `@seam:db`, `@seam:api`) and reserve browser E2E (`@seam:e2e`) for the **1–2** critical user journeys.

**Done when:** Every acceptance criterion, refusal invariant, and edge state has a numbered `@SC-n` Gherkin scenario in domain language with a chosen test seam.

---

## Step 3 — Standalone Gate 1 HTML Design

For architectural, schema, multi-slice, or high-risk changes, author a standalone HTML design starting from [assets/design-template.html](assets/design-template.html).

### Clean Current-Truth Rules
1. **One complete, self-contained document per revision:** Every version (`v1`, `v2`, `v3`…) stands on its own as the single current specification. Rewrite superseded sections cleanly in place rather than prepending override notes or writing `"retained from v1"`.
2. **Zero process noise in the document:** Keep reviewer dispositions (`DR1..DRn`), revision changelogs (`"What changed in v2"`), and task-custody disclaimers (`"Design only: no commits made"`) out of the HTML body and headings. `record_finding_dispositions`, the Inbox review summary, and Desk's `[Δ Diff vs vN-1]` view already record review provenance.
3. **Stay under 48 KiB with zero bundled scripts or base64 blobs:** `read_artifact` caps text at 64 KiB and withholds base64 data URIs. Publish screenshots as separate artifacts and write diagrams as plain `<pre class="mermaid">` blocks (Desk renders `<pre class="mermaid">` natively at zero byte cost).

### Required Section Architecture (Normative vs Informative)

Partition the document into **Normative Contract** (binding on implementation and audited by `claims`) and **Informative Discovery** (non-binding context forwarded to save implementer rediscovery):

1. **Executive Summary *(Normative)*:** 3–5 sentences stating the problem, the delivered outcome, explicit non-goals, issue/Linear links, and baseline commit.
2. **Triage, Contradictions & Gate 1 Decisions *(Normative)*:** Ticket claims checked against code and in-flight PRs/tracks, risks/blockers, and numbered decisions (`D1`, `D2`…) requiring operator or domain sign-off.
3. **Domain & System Shape *(Normative)*:**
   - **Diagrams (`<pre class="mermaid">`):** Include diagrams whenever relationships, state transitions, or ordering carry weight (see [diagram recipes](references/gherkin-and-nfrs.md)):
     - `erDiagram` for **conceptual entity ownership, cardinality (`1:1` vs `1:N`), and mutability** (mutable pointer vs immutable receipt/snapshot) whenever data models change. Leave physical index predicates and trigger bodies to implementation unless mixed-version rollout depends on them.
     - `stateDiagram-v2` for action/matter/task lifecycles, holds, and fail-closed refusals.
     - `sequenceDiagram` or `flowchart` for multi-actor, async, webhook, or external-provider flows.
   - **Deep-Module Interface (`codebase-design`):** Public signature/inputs/outputs, invariants, ordering rules, and error modes. Stop at the interface — leave private helper names and internal control flow to the implementer.
   - **Vertical Slice Plan:** Slice 0 (if warranted) + independently shippable vertical slices.
4. **Behavioural Specifications *(Normative)*:** All `@SC-1..@SC-n` Gherkin `Feature` / `Rule` / `Scenario` blocks with target test seams.
5. **NFRs, Compliance & Production Observability *(Normative)*:** Concrete answers for every applicable area from [references/gherkin-and-nfrs.md](references/gherkin-and-nfrs.md) — error/timeout/unknown-outcome semantics, idempotency & concurrency, security/authority/compliance (CLC money, sale/purchase separation, fail-closed AML, precedent fidelity, UK GDPR/EU residency, RLS + `REVOKE`, PII & PostHog replay masking), rollout/rollback safety, and exact production observability signals.
6. **Discovery Notes & Blast Radius *(Informative — Non-Binding)*:** Verified `file:symbol` anchors, caller/module blast radius, shared-seam reservations with active PRs, suggested test files/fixtures, and the 3-way broken-window disposition.

### Gate 1 Review Sequence
1. Publish with `publish_artifact({ key, title, content, kind: "design", format: "html" })`.
2. Run `spawn_artifact_review({ artifactKey })` and answer findings via `record_finding_dispositions`.
3. If revised, publish a clean self-contained `v2` under the same `key`.
4. Call `ask_operator({ artifactKey, subject, body, options })` and wait for sign-off before editing production code.

**Done when:** The HTML design (< 48 KiB) passes cross-family review with zero process/changelog noise, cleanly separates Normative contract from Informative discovery, and receives operator Gate 1 sign-off.

---

## Step 4 — Test-First Delivery & Scenario Verification

1. **Execute test-first by slice:** Land Slice 0 (if any) in its own PR first, then implement each vertical slice test-first against `@SC-1..@SC-n` so every scenario has at least one discriminating test that fails without the production change.
2. **Publish the Scenario Verification Table into review and the PR:**
   When calling `spawn_review_panel({ mode: "discovery", claims })` and writing the PR body's `Verification` section, include an explicit `@SC-n` coverage table:
   ```markdown
   | Scenario | Status | Seam | Proving Test / Deferral |
   | --- | --- | --- | --- |
   | @SC-1 Lender statement stages HoFA approval | delivered | service | `backend/tests/test_lender_payee.py::test_redemption_stages_hofa` |
   | @SC-2 Calls and Confirmly refused on lenders | delivered | api | `backend/tests/test_lender_payee.py::test_lender_refuses_phone_call` |
   | @SC-5 Slip settlement binding | deferred | — | Slice 2 (`#6193`) |
   ```
   The harness mounts your settled Gate 1 design into `.fleet-review/` for the `claims` and `tests` reviewers so they can verify every `@SC-n` row directly against your executable tests.
3. **Close with production verification:** Call `complete_task` with a `productionVerification` contract naming the exact observability signal and post-merge check window.

**Done when:** Every delivered `@SC-n` is proved by a passing test that fails on revert, deferred scenarios name their owning slice/issue, the code review ratchet is settled, and `productionVerification` is recorded.
