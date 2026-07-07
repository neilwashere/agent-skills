import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./scripts/lint.mjs";
import { mdToHtml } from "./scripts/lib/markdown.mjs";
import { parseNodes } from "./scripts/lib/graph.mjs";

function tmp(name, content){
  const d = mkdtempSync(join(tmpdir(), "r3-"));
  const p = join(d, name);
  writeFileSync(p, content);
  return { p, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

// F6b: bare fence close
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: f","---","","## O1: a","","```","code line","```","","## O2: b"].join("\n"));
  const res = lint(t.p);
  console.log("F6b ids:", res.chain.files[0].nodes.map(n=>n.id).join(","));
  t.cleanup();
}

// F6d: nested fence - tilde vs backtick mismatch (markdown allows closing with longer)
{
  // Open with 3 backticks, close with 4 backticks (CommonMark allows longer)
  const body = "## O1: a\n\n```\ncode\n````\n\n## O2: b";
  const nodes = parseNodes(body);
  console.log("F6d close-with-longer:", nodes.map(n=>n.id).join(","));
}

// F6e: opening fence with info string still works in markdown render
{
  const html = mdToHtml("```python\nprint(1)\n```");
  console.log("F6e python fence:", /<pre><code class="lang-python">/.test(html) ? "OK" : "MISSING");
}

// F6f: tildes
{
  const html = mdToHtml("~~~\ncode\n~~~");
  console.log("F6f tilde fence:", /<pre><code>/.test(html) ? "OK" : "MISSING");
}

// F1d: confirm legit repo-relative upstream that does NOT need .., and check existing fixtures
// Look at how the skill's own dogfood fixtures reference upstream
