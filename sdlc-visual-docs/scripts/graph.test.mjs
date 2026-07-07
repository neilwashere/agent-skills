import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { nodeKind, parseFrontMatter, parseNodes, loadChain } from "./lib/graph.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test("nodeKind classifies the vocabulary", () => {
	assert.equal(nodeKind("O1"), "objective");
	assert.equal(nodeKind("C12"), "contract");
	assert.equal(nodeKind("S3"), "scenario");
	assert.equal(nodeKind("T9"), "task");
	assert.equal(nodeKind("R2"), "risk");
	assert.equal(nodeKind("D7"), "dod");
	assert.equal(nodeKind("M1.S1"), "scenario"); // escape hatch
	assert.equal(nodeKind("Note"), null);
	assert.equal(nodeKind("e.g."), null); // lowercase / trailing dot: not a node
	assert.equal(nodeKind("O1b"), null);
});

test("parseFrontMatter reads keys and link triples", () => {
	const text = [
		"---",
		"ia: v0-experimental",
		"kind: spec",
		"feature: widget",
		"upstream: docs/plans/p.md",
		"links:",
		"  - [S1, verifies, O1]",
		"  - [R1, mitigated-by, S1]",
		"---",
		"",
		"# body",
	].join("\n");
	const { meta, body, errors } = parseFrontMatter(text);
	assert.deepEqual(errors, []);
	assert.equal(meta.ia, "v0-experimental");
	assert.equal(meta.kind, "spec");
	assert.equal(meta.feature, "widget");
	assert.equal(meta.upstream, "docs/plans/p.md");
	assert.deepEqual(meta.links, [
		["S1", "verifies", "O1"],
		["R1", "mitigated-by", "S1"],
	]);
	assert.match(body, /^# body/m);
});

test("parseFrontMatter rejects malformed link entries", () => {
	const text = ["---", "ia: v0-experimental", "kind: plan", "feature: x", "links:", "  - [only-two, items]", "---", "body"].join("\n");
	const { errors } = parseFrontMatter(text);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /three-element/);
});

test("parseNodes finds heading nodes, skips fences and level-1 headings", () => {
	const body = [
		"# S0: level-1 headings are titles, not nodes",
		"## O1: fast",
		"prose",
		"### R1: scary",
		"",
		"severity: high",
		"",
		"```text",
		"## S99: inside a fence",
		"```",
		"#### D1: done item",
		"## Not a node heading",
	].join("\n");
	const nodes = parseNodes(body);
	assert.deepEqual(
		nodes.map((n) => n.id),
		["O1", "R1", "D1"],
	);
	const r1 = nodes.find((n) => n.id === "R1");
	assert.equal(r1.kind, "risk");
	assert.equal(r1.severity, "high");
	assert.equal(nodes.find((n) => n.id === "O1").title, "fast");
});

test("loadChain follows upstream across the good fixture trio", () => {
	const entry = join(FIXTURES, "good", "docs", "plans", "2026-01-03-widget-build.md");
	const chain = loadChain(entry);
	assert.deepEqual(chain.errors, []);
	assert.equal(chain.files.length, 3);
	assert.deepEqual(
		chain.files.map((f) => f.meta.kind),
		["build", "spec", "plan"],
	);
	const allIds = chain.files.flatMap((f) => f.nodes.map((n) => n.id));
	for (const id of ["T1", "T2", "C1", "S1", "S2", "O1", "O2", "R1", "R2", "D1", "D2"]) {
		assert.ok(allIds.includes(id), `missing ${id}`);
	}
	// fenced pseudo-heading must not leak in
	assert.ok(!allIds.includes("S99"));
});

test("loadChain reports a missing upstream as an error", () => {
	const entry = join(FIXTURES, "good", "docs", "plans", "2026-01-01-widget.md");
	const chain = loadChain(entry); // plan: no upstream, fine
	assert.deepEqual(chain.errors, []);
	assert.equal(chain.files.length, 1);
});
