import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lint } from "./scripts/lint.mjs";

function tmp(name, content){
  const d = mkdtempSync(join(tmpdir(), "repro2-"));
  const p = join(d, name);
  writeFileSync(p, content);
  return { p, cleanup: () => rmSync(d, { recursive: true, force: true }) };
}

// Look at lint report shape
{
  const t = tmp("plan.md", ["---","ia: v0-experimental","kind: plan","feature: f","---","","## O1: before","","```text","console.log(1)","```js","more code","```","","## O2: after"].join("\n"));
  const res = lint(t.p);
  console.log("report keys:", Object.keys(res));
  console.log("report[0] keys:", res.report?.[0] ? Object.keys(res.report[0]) : "(none)");
  console.log("report[0].nodes:", JSON.stringify(res.report?.[0]?.nodes));
  // Try chain
  console.log("chain files:", res.chain?.files?.length);
  console.log("chain files[0].nodes:", JSON.stringify(res.chain?.files?.[0]?.nodes?.map(n => n.id)));
  t.cleanup();
}
