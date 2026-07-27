// Not auto-loaded by pi (discovery globs *.ts only).
// Run: node ~/.pi/agent/extensions/herdr-awaiting-input.test.mjs
import assert from "node:assert/strict";
import { questionAwaitingInput } from "./herdr-awaiting-input.ts";

const asks = [
  // Verbatim tail of gemini session 019f98d8 — question line, then an italic aside.
  "HTML dashboards are an excellent choice. They offer high information density.\n\n**Question 3:** How should this JSON/YAML Spec graph define the verification criteria (the Definition of Done) for the Build phase?\n\n*(For example: Should the graph contain explicit nodes for \"Acceptance Tests\" that point to stubbed, failing test files? Or should the graph itself be compiled into a test harness that the Build phase must satisfy?)*",
  "Which track should this ship on?",
  "Do you want the strict posture as the default?\n\n- strict: fail fast\n- relaxed: warn only",
  "Should I proceed with the rebase,\nor stop and let you review first?",
  "Two options here.\n\n| option | cost |\n| --- | --- |\n\nWhich do you prefer?\n\n> (either is reversible)",
];

const doesNotAsk = [
  "Done. 418 tests pass and biome is clean.",
  "Should I proceed? I checked the diff and it is safe, so I went ahead and merged it.",
  "Fixed the parser.\n\n```js\nif (x) { return y ? 1 : 2; } // is this right?\n```\n\nAll green.",
  "PR #164 is open and CI is green.",
  "",
];

for (const text of asks) {
  const match = questionAwaitingInput(text);
  assert.ok(match, `expected a pending question in: ${text.slice(0, 60)}`);
  assert.ok(match.label.length > 0 && match.label.length <= 120, "label must be a short excerpt");
}

for (const text of doesNotAsk) {
  assert.equal(
    questionAwaitingInput(text),
    undefined,
    `expected no pending question in: ${text.slice(0, 60)}`,
  );
}

console.log(`ok — ${asks.length} asking cases, ${doesNotAsk.length} non-asking cases`);
