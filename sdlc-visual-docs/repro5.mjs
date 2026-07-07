import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./scripts/lint.mjs";

function tmp(name, content){
  const d = mkdtempSync(join(tmpdir(), "r5-"));
  const p = join(d, name);
  writeFileSync(p, content);
  return { p, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

// Does a severity:high line INSIDE a fenced code block get wrongly attached to a risk?
// parseNodes severity scanner uses bare-marker-toggle, not char+length.
{
  const t = tmp("plan.md", [
    "---","ia: v0-experimental","kind: plan","feature: x","---","",
    "## R1: a risk","",
    "```text",
    "severity: high",
    "```",
    "",
    "## O1: o",
  ].join("\n"));
  const res = lint(t.p);
  const r1 = res.graph.nodes.get("R1");
  console.log("R1.severity (want null, it's inside code):", r1?.severity);
  t.cleanup();
}

// Cross-char fence: open ``` close ~~~ inside a risk section
{
  const t = tmp("plan.md", [
    "---","ia: v0-experimental","kind: plan","feature: x","---","",
    "## R1: a risk","",
    "```text",
    "severity: high",
    "~~~",
    "```",
    "",
    "## O1: o",
  ].join("\n"));
  const res = lint(t.p);
  const r1 = res.graph.nodes.get("R1");
  console.log("R1.severity cross-char (want null):", r1?.severity);
  t.cleanup();
}
