import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "./scripts/render.mjs";

function tmp(name, content){
  const d = mkdtempSync(join(tmpdir(), "r4-"));
  const p = join(d, name);
  writeFileSync(p, content);
  return { p, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

// F2 round-trip through real app.js parsing path: simulate JSON.parse(textContent)
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: xss","---","","## O1: a </script><script>alert(1)</script>","## S1: b","severity: high","\u2028 weird char"].join("\n"));
  const html = render(t.p);
  const m = html.match(/<script type="application\/json" id="ia-graph">([\s\S]*?)<\/script>/);
  const island = m[1];
  // Browser would do JSON.parse(island). Simulate:
  try {
    const obj = JSON.parse(island);
    console.log("F2 round-trip JSON.parse OK; O1 title =", JSON.stringify(obj.nodes[0].title));
    console.log("  title contains alert script?", /<script>alert\(1\)/.test(obj.nodes[0].title));
  } catch (e) { console.log("F2 JSON.parse FAILED:", e.message); }
  t.cleanup();
}

// F5: confirm verifies S->C still allowed, and T->S, D->S|T
{
  // Build a full valid chain to confirm no false positives from EDGE_SHAPES
  const t = tmp("spec.md", ["---","ia: v0-experimental","kind: spec","feature: ok","links:","  - [S1, verifies, O1]","  - [S2, verifies, C1]","---","","## O1: o","## C1: c","## S1: s","## S2: s2"].join("\n"));
  const { lint } = await import("./scripts/lint.mjs");
  const r = lint(t.p);
  console.log("F5 legit verifies S->O and S->C:", r.ok ? "OK" : "FALSE-POSITIVE", r.errors.join("; "));
  t.cleanup();
}

// F7 edge: inline links with trailing junk / unclosed outer bracket
{
  const { parseInlineLinks } = await import("./scripts/lib/graph.mjs");
  console.log("F7 unclosed [[a,b,c]:", JSON.stringify(parseInlineLinks("[[a,b,c]")));
  console.log("F7 empty []:", JSON.stringify(parseInlineLinks("[]")));
  console.log("F7 [[a,b],[c,d,e]] (one bad):", JSON.stringify(parseInlineLinks("[[a,b],[c,d,e]]")));
}

// F3: a benign absolute-path-looking href (no scheme) - should pass as relative
{
  const { mdToHtml } = await import("./scripts/lib/markdown.mjs");
  console.log("F3 /abs/path:", mdToHtml("[x](/abs/path)"));
}
