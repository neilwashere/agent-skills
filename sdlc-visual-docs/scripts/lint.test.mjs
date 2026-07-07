import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { lint } from "./lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");
const fx = (...p) => join(FIXTURES, ...p);

test("good chain lints clean from any entry point", () => {
	const res = lint(fx("good", "docs", "plans", "2026-01-03-widget-build.md"));
	assert.deepEqual(res.errors, []);
	assert.deepEqual(res.warnings, []);
	assert.equal(res.ok, true);
	// report lists every node per file
	const reportText = JSON.stringify(res.report);
	for (const id of ["O1", "S2", "T1", "D2"]) assert.match(reportText, new RegExp(`"${id}"`));
});

test("dangling edge endpoint fails", () => {
	const res = lint(fx("broken-dangling", "plan.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /dangling|unresolved/i.test(e) && e.includes("S9")));
});

test("scenario verifying no objective fails", () => {
	const res = lint(fx("broken-unverified-scenario", "spec.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /S1/.test(e) && /objective/i.test(e)));
});

test("contract with no verifying scenario fails", () => {
	const res = lint(fx("broken-unverified-contract", "spec.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /C1/.test(e) && /scenario/i.test(e)));
});

test("build task with no implements or covered-by fails", () => {
	const res = lint(fx("broken-uncovered-task", "build.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /T1/.test(e)));
});

test("malformed front matter fails: missing kind, unknown edge type, bad triple", () => {
	const res = lint(fx("broken-frontmatter", "bad.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /kind/i.test(e)));
	assert.ok(res.errors.some((e) => /frobs/.test(e)));
	assert.ok(res.errors.some((e) => /three-element/.test(e)));
});

test("duplicate node IDs fail", () => {
	const res = lint(fx("broken-duplicate", "plan.md"));
	assert.equal(res.ok, false);
	assert.ok(res.errors.some((e) => /O1/.test(e) && /duplicate/i.test(e)));
});

test("unmitigated high risk flags but does not fail", () => {
	const res = lint(fx("flag-high-risk", "plan.md"));
	assert.equal(res.ok, true);
	assert.deepEqual(res.errors, []);
	assert.equal(res.warnings.length, 1);
	assert.match(res.warnings[0], /R1/);
});

test("CLI exit codes: 0 on good, 1 on broken", () => {
	const cli = join(HERE, "lint.mjs");
	const good = spawnSync(process.execPath, [cli, fx("good", "docs", "specs", "2026-01-02-widget.md")], { encoding: "utf8" });
	assert.equal(good.status, 0, good.stderr);
	const bad = spawnSync(process.execPath, [cli, fx("broken-dangling", "plan.md")], { encoding: "utf8" });
	assert.equal(bad.status, 1);
	// node report is always printed
	assert.match(good.stdout, /O1/);
});
