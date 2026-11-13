# Gherkin, Diagrams & NFR Reference

Lookup companion for [design-first](../SKILL.md).

---

## 1. Gherkin Standard (Automation Panda)

Gherkin scenarios serve two roles: **Gate 2 stress-testing** of the deliverable before coding, and **primary verification gates** audited by the `claims` and `tests` reviewers before merge.

### Keywords & Cardinality
- **`Feature:`** One per capability area, followed by a 1–2 line purpose statement.
- **`Rule:`** *(Gherkin 6+, optional)* Groups scenarios enforcing one business rule or invariant.
- **`Background:`** *(optional)* Shared `Given` preconditions that apply to every scenario in the `Feature` or `Rule`. Keep short (1–3 lines) and free of `When`/`Then`.
- **`Scenario:`** One concrete example of **one behaviour** (3–7 steps). Split multi-step scripts (`When ... Then ... When ... Then ...`) into separate scenarios.
- **`Scenario Outline:` + `Examples:`** Use when the exact same behaviour varies across a small table of domain inputs and expected outcomes (boundary cases, role matrix, status matrix).
- **`And` / `But`:** Continue the preceding `Given`, `When`, or `Then` without repeating the keyword.

### Tagging Contract
Every `Scenario` or `Scenario Outline` carries a unique `@SC-<n>` ID and its primary test seam:
- `@seam:service` — domain/service module interface (preferred fast default)
- `@seam:db` — real scratch database / migration / constraint / lock check
- `@seam:api` — HTTP/RPC route handler + auth/validation boundary
- `@seam:e2e` — browser or full-stack critical-path journey (reserve for 1–2 per feature)

### Declarative Domain Language vs Imperative Implementation Coupling

**Bad (implementation-coupled prose smuggled into Gherkin):**
```gherkin
Scenario: Test _candidate_firm and firms.trading_name
  Given firms row has name="Stanley Tee LLP" and trading_name="Tees Law"
  When _candidate_firm(identity) runs before search_firms_fuzzy(0.8)
  Then _end_link_contradicted_by_name returns False and HTTP 200 JSON has trading_name
```
*Why this fails:* Prescribes private Python helpers and SQL columns; breaks if the implementer names the helper better; hides the domain rule from a conveyancer or operator.

**Good (declarative, falsifiable domain behaviour):**
```gherkin
Feature: Matching a firm by its trading name
  Conveyancers and counterparties often write a firm's trading name rather than its registered legal name.

  Rule: An exact trading-name match identifies the firm without creating a duplicate

    @SC-1 @seam:service
    Scenario: Inbound correspondence using a firm's trading name matches the registered firm
      Given directory firm "Stanley Tee LLP" trades as "Tees Law"
      And no other active firm uses the name "Tees Law"
      When an inbound seller-solicitor email names the firm "Tees Law"
      Then the matter suggests linking "Stanley Tee LLP"
      And "Add Tees Law to the directory" is not offered

    @SC-2 @seam:db
    Scenario: Two active firms cannot claim the same trading name
      Given active directory firm "Stanley Tee LLP" trades as "Tees Law"
      When staff set the trading name of another firm to "tees law"
      Then the update is refused as a duplicate trading name
      And the second firm's trading name remains unchanged
```

---

## 2. Diagram Selection (`<pre class="mermaid">`)

Desk renders `<pre class="mermaid">` blocks natively inside HTML design artifacts — never inline a Mermaid JS bundle or base64 diagram image. Include a diagram when visualising structure eliminates prose ambiguity:

| Situation | Diagram Type | What to Show (and What to Leave Out) |
| --- | --- | --- |
| Touching database tables, ownership, or references | `erDiagram` | **Conceptual entities, cardinality (`\|\|--o{`), ownership, and mutable pointer vs immutable receipt/snapshot.** Omit index SQL, trigger bodies, and column types unless coexistence safety depends on them. |
| Entity, action, check, or task moves through states / holds / refusals | `stateDiagram-v2` | Valid states, triggering events, guard conditions, terminal states, and fail-closed hold states (e.g. `unknown_send_outcome --> held_for_admin`). |
| Ordering across actors, queues, webhooks, or external APIs matters | `sequenceDiagram` | Actors/systems, request/response/event order, transaction boundaries, and retry/timeout branches. |
| Branching decision rule or reconciliation gate | `flowchart TD` | Inputs, deterministic decision predicates, and resulting outcomes/actions. |

Escape `<` and `&` inside `<pre class="mermaid">` only where HTML requires it (prefer `-->` and quoted labels `"1:N"`).

---

## 3. High-Signal NFR, Risk & Compliance Checklist

Issues rarely state non-functional requirements. Address every row below that your change touches; omit rows that genuinely do not apply rather than writing filler.

### A. Error Handling, Concurrency & Unknown Outcomes
- **External call failure & unknown outcomes:** If an outbound email, payment, webhook, merge, or third-party API call times out *after* dispatch, is the outcome recorded as `unknown` / held for explicit reconciliation rather than retried blindly or marked failed?
- **Idempotency & replay:** Can a duplicate webhook, repeated button click, or durable turn replay double-post, double-send, or corrupt state?
- **Concurrency & lock order:** Can two concurrent requests pass the same precondition check before writing (TOCTOU / read-modify-write race)? Name the uniqueness constraint, compare-and-set, or lock order that prevents it.

### B. Security, Authority & Regulatory Compliance
- **Authority & isolation:** Which actor/role/template can reach the surface? Are cross-matter, cross-party, or cross-task-subtree accesses refused?
- **CLC Client Money (when touching accounts, invoices, beneficiaries, slips, payments):**
  - Balanced atomic double-entry; strict client vs office money segregation (zero client ledger overdraft).
  - Integer pence / exact `Decimal` arithmetic; immutability of issued invoices; verified payee details + HoFA approval gates.
- **CLC Conveyancing & AML (when touching matters, parties, documents, comms, voice):**
  - Sale vs purchase side separation; verbatim approved precedent templates; backed statements of fact with zero automatic undertakings.
  - Keith never contacts the other side's client directly (always their conveyancer/solicitor).
  - Fail-closed AML / sanctions / PEP / SoF / ID checks in lawful procedural order.
- **UK GDPR, EU Residency & Replay Privacy:**
  - EU-only processors and endpoints.
  - Every new public Postgres table has `ENABLE ROW LEVEL SECURITY`, explicit policies, and `REVOKE` from `anon`/`authenticated` where client API access is unwanted, plus PII column classification where tested.
  - Session replay & telemetry hygiene: `data-ph-mask` on credentials/bank details/PINs, `data-ph-block` on documents/QRs/UK GDPR Art. 9 special-category fields, and zero PII or wire secrets in logs, error payloads, or analytics events.

### C. Rollout, Migration Coexistence & Observability
- **Additive rollout:** Expand → backfill → switch readers → contract so the prior release and mixed-version deploys keep working; state what happens to existing rows that violate new constraints and whether rollback is reversible or destructive.
- **Production observability:** Name the exact PostHog event, metric, or structured log attribute that proves production usage and health post-merge, plus the verification window for `complete_task({ productionVerification })`.
