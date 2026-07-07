import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./scripts/lint.mjs";
import { render } from "./scripts/render.mjs";
import { mdToHtml } from "./scripts/lib/markdown.mjs";
import { parseInlineLinks, parseFrontMatter, parseNodes, upstreamError, buildGraph, loadChain } from "./scripts/lib/graph.mjs";

function tmp(name, content){
  const d = mkdtempSync(join(tmpdir(), "repro-"));
  const p = join(d, name);
  writeFileSync(p, content);
  return { p, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

// F1a: absolute upstream
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: spec","feature: x","upstream: /etc/passwd","---","","## S1: x"].join("\n"));
  const r = lint(t.p);
  console.log("F1a abs upstream:", r.ok === false ? "REJECT" : "ACCEPT(BUG)", "|", r.errors.join("; "));
  t.cleanup();
}

// F1b: ../ traversal upstream
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: spec","feature: x","upstream: ../../../../../etc/hostname","---","","## S1: x"].join("\n"));
  const r = lint(t.p);
  console.log("F1b ../ upstream:", r.ok === false ? "REJECT" : "ACCEPT(BUG)", "|", r.errors.join("; "));
  t.cleanup();
}

// F1c: Windows-style backslash escape  (hostile value uses backslash that splits to ".." anyway)
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: spec","feature: x","upstream: ..\\..\\..\\etc\\hosts","---","","## S1: x"].join("\n"));
  const r = lint(t.p);
  console.log("F1c win-.. upstream:", r.ok === false ? "REJECT" : "ACCEPT(BUG)", "|", r.errors.join("; "));
  t.cleanup();
}

// F1d: does .. ban break LEGITIMATE repo-relative upstream? make a nested dir
{
  const d = mkdtempSync(join(tmpdir(), "legit-"));
  mkdirSync(join(d, "docs", "plans"), { recursive: true });
  mkdirSync(join(d, "docs", "specs"));
  const plan = join(d, "docs", "plans", "p.md");
  const spec = join(d, "docs", "specs", "s.md");
  writeFileSync(spec, ["---","ia: v0-experimental","kind: spec","feature: legit","---","","## O1: o","## S1: s"].join("\n"));
  // legitimate repo-relative: specs/s.md  (no ..)
  writeFileSync(plan, ["---","ia: v0-experimental","kind: plan","feature: legit","upstream: docs/specs/s.md","---","","## O1: o"].join("\n"));
  const r = lint(plan);
  console.log("F1d legit repo-rel 'docs/specs/s.md':", r.ok === true ? "ACCEPT(OK)" : "REJECT", "|", r.errors.join("; "));
  // Legitimate cross-dir relative WITH .. (common case): from plans/p.md to specs/s.md as ../specs/s.md
  writeFileSync(plan, ["---","ia: v0-experimental","kind: plan","feature: legit","upstream: ../specs/s.md","---","","## O1: o"].join("\n"));
  const r2 = lint(plan);
  console.log("F1d relative '../specs/s.md':", r2.ok === true ? "ACCEPT(OK)" : "REJECT-BREAKAGE", "|", r2.errors.join("; "));
  rmSync(d, { recursive: true, force: true });
}

// F2: </script> in title
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: xss","---","","## O1: hi </script><script>alert(1)</script>"].join("\n"));
  const html = render(t.p);
  console.log("F2 raw <script>alert present:", /<script>alert\(1\)<\/script>/.test(html) ? "LEAK(BUG)" : "SAFE");
  console.log("F2 escaped \\u003c present:", /\\u003c\/script/.test(html) ? "YES" : "NO");
  // Can app.js JSON.parse the island?
  const m = html.match(/<script type="application\/json" id="ia-graph">([\s\S]*?)<\/script>/);
  try {
    const obj = JSON.parse(m[1]);
    console.log("F2 JSON.parse island ok, nodes:", obj.nodes.length);
  } catch (e) { console.log("F2 JSON.parse FAILED:", e.message); }
  t.cleanup();
}

// F3: javascript:/data:
console.log("F3 javascript:", mdToHtml("[x](javascript:alert(1))"));
console.log("F3 data:", mdToHtml("[y](data:text/html,<b>z</b>)"));
console.log("F3 vbscript:", mdToHtml("[v](vbscript:msgbox)"));
console.log("F3 file:", mdToHtml("[f](file:///etc/passwd))"));
console.log("F3 https:", mdToHtml("[h](https://example.com/x)"));
console.log("F3 relative:", mdToHtml("[r](docs/x.md)"));
console.log("F3 #frag:", mdToHtml("[a](#O1)"));
console.log("F3 mailto:", mdToHtml("[m](mailto:a@b.c)"));
console.log("F3 JS-tab-obfuscation: JaVaScRiPt:", mdToHtml("[o](JaVaScRiPt:alert(1))"));
console.log("F3 leading-space ' javascript:':", mdToHtml("[s]( javascript:alert(1))"));
console.log("F3 newline-in-href:", mdToHtml("[n](java\nscript:alert(1))"));

// F4: render past lint
{
  // Use a broken-dangling fixture path
  const cli = join(process.cwd(), "scripts", "render.mjs");
}

// F5: wrong edge kinds
{
  const t = tmp("spec.md", ["---","ia: v0-experimental","kind: spec","feature: x","links:","  - [S1, verifies, O1]","  - [R1, mitigated-by, O1]","---","","## O1: o","## S1: s","## R1: r","","severity: high"].join("\n"));
  const r = lint(t.p);
  console.log("F5 R1 mitigated-by O1:", r.ok === false ? "REJECT" : "ACCEPT(BUG)", "|", r.errors.join("; "));
  t.cleanup();
}

// F6: fence with info-string line inside
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: f","---","","## O1: before","","```text","console.log(1)","```js","more code","```","","## O2: after"].join("\n"));
  const res = lint(t.p);
  const ids = res.report.flatMap(f => f.nodes.map(n => n.id));
  console.log("F6 ids (want O1 and O2):", ids.join(","));
  t.cleanup();
}

// F6b: does it still close a normal fence?
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: f","---","","## O1: a","","```","code line","```","","## O2: b"].join("\n"));
  const res = lint(t.p);
  const ids = res.report.flatMap(f => f.nodes.map(n => n.id));
  console.log("F6b bare fence ids (want O1,O2):", ids.join(","));
  t.cleanup();
}

// F6c: does it still render a mermaid fence in markdown?
{
  const html = mdToHtml("```mermaid\ngraph TD; A-->B\n```");
  console.log("F6c mermaid fence renders:", /<div class="mermaid">/.test(html) ? "YES" : "NO");
}

// F7: inline links
{
  const good = parseInlineLinks("[[S1, verifies, O1]]");
  console.log("F7 good inline:", JSON.stringify(good));
  const bare = parseInlineLinks("[S1, verifies, O1]");
  console.log("F7 bare [a,b,c]:", JSON.stringify(bare));
  const two = parseInlineLinks("[[S1, verifies, O1], [R1, mitigated-by, S1]]");
  console.log("F7 two triples:", JSON.stringify(two));
}

// F9: task in spec not coverage-checked
{
  const t = tmp("spec.md", ["---","ia: v0-experimental","kind: spec","feature: x","links:","  - [S1, verifies, O1]","---","","## O1: o","## S1: s","## T1: stray task"].join("\n"));
  const r = lint(t.p);
  const tErr = r.errors.find(e => /T1/.test(e) && /implements|covered-by/.test(e));
  console.log("F9 task-in-spec fired:", tErr ? "BUG" : "OK (not checked)");
  t.cleanup();
}
