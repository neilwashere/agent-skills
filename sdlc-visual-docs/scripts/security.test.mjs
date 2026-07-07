import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

import { lint } from "./lint.mjs";
import { render } from "./render.mjs";
import { mdToHtml } from "./lib/markdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");

function tmpFile(name, content) {
	const dir = mkdtempSync(join(tmpdir(), "svd-sec-"));
	const p = join(dir, name);
	writeFileSync(p, content);
	return { dir, path: p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// F1 — path traversal via upstream
test("F1: absolute upstream is rejected and its content never rendered", () => {
	const secret = tmpFile("secret.txt", "SECRET_TOKEN_MARKER_ABC");
	const plan = tmpFile(
		"plan.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: evil", `upstream: ${secret.path}`, "---", "", "# Evil", "", "## S1: x"].join("\n"),
	);
	const res = lint(plan.path);
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /upstream/i.test(e) && /absolute/i.test(e)));
	const html = render(plan.path);
	assert.ok(!html.includes("SECRET_TOKEN_MARKER_ABC"), "secret file content leaked into render");
	secret.cleanup();
	plan.cleanup();
});

test("F1: parent-traversal upstream is rejected", () => {
	const plan = tmpFile(
		"plan.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: evil", "upstream: ../../../../../../etc/hostname", "---", "", "## S1: x"].join("\n"),
	);
	const res = lint(plan.path);
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /upstream/i.test(e) && /\.\./.test(e)));
	plan.cleanup();
});

test("F1: ancestor walk is bounded (no `..`, no absolute) so it cannot climb to a filesystem-root file", () => {
	// A tmp dir has no .git above it, so upstream resolution is confined to the
	// entry file's own directory; `etc/hostname` must NOT resolve to /etc/hostname.
	const nested = mkdtempSync(join(tmpdir(), "svd-walk-"));
	mkdirSync(join(nested, "a", "b"), { recursive: true });
	const planPath = join(nested, "a", "b", "plan.md");
	writeFileSync(
		planPath,
		["---", "ia: v0-experimental", "kind: spec", "feature: climb", "upstream: etc/hostname", "---", "", "## S1: x"].join("\n"),
	);
	const res = lint(planPath);
	assert.equal(res.ok, false);
	assert.equal(res.chain.files.length, 1, "walk escaped the entry directory");
	assert.ok(res.errors.some((e) => /upstream not found/i.test(e)));
	rmSync(nested, { recursive: true, force: true });
});

test("F1: an in-repo symlink cannot escape the repo boundary to disclose an out-of-tree file", () => {
	const base = mkdtempSync(join(tmpdir(), "svd-sym-"));
	mkdirSync(join(base, "repo", "docs", "plans"), { recursive: true });
	mkdirSync(join(base, "repo", ".git"), { recursive: true });
	mkdirSync(join(base, "outside"), { recursive: true });
	writeFileSync(join(base, "outside", "hostname"), "OUT_OF_TREE_SECRET_XYZ");
	symlinkSync(join(base, "outside"), join(base, "repo", "docs", "escape"));
	const planPath = join(base, "repo", "docs", "plans", "plan.md");
	writeFileSync(
		planPath,
		["---", "ia: v0-experimental", "kind: spec", "feature: sym", "upstream: escape/hostname", "---", "", "## S1: x"].join("\n"),
	);
	const res = lint(planPath);
	assert.equal(res.chain.files.length, 1, "symlink escaped the repo boundary");
	const html = render(planPath);
	assert.ok(!html.includes("OUT_OF_TREE_SECRET_XYZ"), "symlinked out-of-tree content leaked");
	rmSync(base, { recursive: true, force: true });
});

// F2 — JSON island </script> injection
test("F2: </script> in a node title cannot break out of the JSON island", () => {
	const plan = tmpFile(
		"plan.md",
		["---", "ia: v0-experimental", "kind: plan", "feature: xss", "---", "", "## O1: x </script><script>alert(1)</script>"].join("\n"),
	);
	const html = render(plan.path);
	assert.ok(!/<script>alert\(1\)<\/script>/.test(html), "injected script element present in output");
	assert.match(html, /\\u003c\/script\\u003e/, "JSON island did not escape < as \\u003c");
	plan.cleanup();
});

// F3 — href scheme allow-list
test("F3: dangerous URL schemes are dropped; safe ones kept", () => {
	const js = mdToHtml("[x](javascript:alert(1))");
	assert.ok(!/href="javascript:/i.test(js), "javascript: href survived");
	const data = mdToHtml("[y](data:text/html,<script>alert(2)</script>)");
	assert.ok(!/href="data:/i.test(data), "data: href survived");
	assert.match(mdToHtml("[ok](https://example.com/x)"), /<a href="https:\/\/example.com\/x">ok<\/a>/);
	assert.match(mdToHtml("[rel](docs/x.md)"), /<a href="docs\/x.md">rel<\/a>/);
	assert.match(mdToHtml("[anchor](#O1)"), /<a href="#O1">anchor<\/a>/);
});

// F4 — render must not proceed past lint errors without --force
test("F4: CLI render refuses a lint-failing artefact unless --force", () => {
	const cli = join(HERE, "render.mjs");
	const bad = join(FIXTURES, "broken-dangling", "plan.md");
	const out = join(mkdtempSync(join(tmpdir(), "svd-f4-")), "o.html");
	const refused = spawnSync(process.execPath, [cli, bad, "-o", out], { encoding: "utf8" });
	assert.notEqual(refused.status, 0, "render did not refuse a broken artefact");
	assert.match(refused.stderr, /lint|error/i);
	const forced = spawnSync(process.execPath, [cli, bad, "--force", "-o", out], { encoding: "utf8" });
	assert.equal(forced.status, 0, forced.stderr);
	rmSync(dirname(out), { recursive: true, force: true });
});

// F5 — typed edge endpoints
test("F5: an edge with the wrong endpoint kinds fails lint", () => {
	const spec = tmpFile(
		"spec.md",
		[
			"---",
			"ia: v0-experimental",
			"kind: spec",
			"feature: badedge",
			"links:",
			"  - [S1, verifies, O1]",
			"  - [R1, mitigated-by, O1]",
			"---",
			"",
			"## O1: obj",
			"## S1: scen",
			"## R1: risk",
			"",
			"severity: high",
		].join("\n"),
	);
	const res = lint(spec.path);
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /mitigated-by/.test(e) && /R1/.test(e) && /(kind|scenario|endpoint)/i.test(e)));
	spec.cleanup();
});

// F6 — fence close must be a bare marker line
test("F6: an info-string line inside a fence does not close it early", () => {
	const plan = tmpFile(
		"plan.md",
		["---", "ia: v0-experimental", "kind: plan", "feature: fence", "---", "", "## O1: before", "", "```text", "console.log(1)", "```js", "more code", "```", "", "## O2: after"].join(
			"\n",
		),
	);
	const res = lint(plan.path);
	const ids = res.report.flatMap((f) => f.nodes);
	assert.ok(ids.includes("O1") && ids.includes("O2"), `fence swallowed a node: ${ids.join(",")}`);
	plan.cleanup();
});

// F7 — inline links form
test("F7: inline links [[...]] parse; a bare [a,b,c] errors instead of vanishing", () => {
	const good = tmpFile(
		"spec.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: inline", "links: [[S1, verifies, O1]]", "---", "", "## O1: o", "## S1: s"].join("\n"),
	);
	const gres = lint(good.path);
	assert.equal(gres.ok, true, gres.errors.join("; "));
	good.cleanup();

	const bad = tmpFile(
		"spec.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: inline", "links: [S1, verifies, O1]", "---", "", "## O1: o", "## S1: s"].join("\n"),
	);
	const bres = lint(bad.path);
	assert.equal(bres.ok, false);
	assert.ok(bres.errors.some((e) => /links/i.test(e) && /three-element/i.test(e)));
	bad.cleanup();

	// trailing garbage after a valid triple must error, not be silently dropped
	const garbage = tmpFile(
		"spec.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: inline", "links: [[S1, verifies, O1], junk]", "---", "", "## O1: o", "## S1: s"].join("\n"),
	);
	const gres2 = lint(garbage.path);
	assert.equal(gres2.ok, false, "trailing garbage in inline links was silently accepted");
	assert.ok(gres2.errors.some((e) => /links/i.test(e)));
	garbage.cleanup();

	// an empty field must not be filtered away into a valid-looking triple
	const empty = tmpFile(
		"spec.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: inline", "links: [[S1,, verifies, O1]]", "---", "", "## O1: o", "## S1: s"].join("\n"),
	);
	const eres = lint(empty.path);
	assert.equal(eres.ok, false, "empty-field triple was accepted");
	empty.cleanup();
});

// F9 — task coverage rule scoped to build artefacts
test("F9: a task node declared in a spec is not coverage-checked", () => {
	const spec = tmpFile(
		"spec.md",
		["---", "ia: v0-experimental", "kind: spec", "feature: taskscope", "links:", "  - [S1, verifies, O1]", "---", "", "## O1: o", "## S1: s", "## T1: stray task"].join(
			"\n",
		),
	);
	const res = lint(spec.path);
	assert.ok(!res.errors.some((e) => /T1/.test(e) && /implements|covered-by/.test(e)), `task rule fired outside build: ${res.errors.join("; ")}`);
	spec.cleanup();
});

// F10 — -o without a path is a usage error
test("F10: render -o with no path is a usage error, not a stdout dump", () => {
	const cli = join(HERE, "render.mjs");
	const plan = join(FIXTURES, "good", "docs", "plans", "2026-01-01-widget.md");
	const res = spawnSync(process.execPath, [cli, plan, "-o"], { encoding: "utf8" });
	assert.notEqual(res.status, 0);
	assert.ok(res.stdout.length < 1000, "dumped a large payload to stdout instead of erroring");
	assert.match(res.stderr, /usage|-o/i);
});
