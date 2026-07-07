import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { render, graphPayload } from "./render.mjs";
import { isCovered } from "./lib/components.mjs";
import { lint } from "./lint.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const BUILD = join(FIXTURES, "good", "docs", "plans", "2026-01-03-widget-build.md");
const RISKY = join(FIXTURES, "flag-high-risk", "plan.md");

function payloadFor(path) {
	return graphPayload(path, lint(path));
}

test("good chain: every node is covered", () => {
	const payload = payloadFor(BUILD);
	for (const n of payload.nodes) {
		assert.equal(isCovered(payload, n), true, `${n.id} unexpectedly uncovered`);
	}
	const html = render(BUILD);
	assert.ok(!html.includes('class="badge uncovered"'), "uncovered badge on a fully covered chain");
});

test("uncovered nodes are detected and highlighted", () => {
	const payload = payloadFor(RISKY);
	const byId = Object.fromEntries(payload.nodes.map((n) => [n.id, n]));
	// plan-only chain: objectives are not judged (no spec to verify them)
	assert.equal(isCovered(payload, byId.O1), true);
	assert.equal(isCovered(payload, byId.D1), false); // no covered-by
	assert.equal(isCovered(payload, byId.R1), false); // high, unmitigated
	const html = render(RISKY);
	assert.match(html, /class="badge uncovered"/);
	assert.match(html, /<tr class="uncovered" data-node="D1"/);
});

test("objectives are judged once a spec is in the chain", () => {
	const SPEC = join(FIXTURES, "broken-unverified-contract", "spec.md");
	const payload = payloadFor(SPEC);
	const o1 = payload.nodes.find((n) => n.id === "O1");
	assert.equal(isCovered(payload, o1), true); // S1 verifies O1
});

test("all four graph components render for the good chain", () => {
	const html = render(BUILD);
	for (const id of ["trace", "contracts", "risks", "dod"]) {
		assert.match(html, new RegExp(`<section class="component" id="${id}"`), `component ${id} missing`);
	}
	// contract panel names its verifying scenario
	assert.match(html, /verified by: <a href="#S2"/);
	// risk filter buttons exist
	assert.match(html, /data-risk-filter="high"/);
});

test("scenario task-coverage is only judged when a build file is in the chain", () => {
	const SPEC = join(FIXTURES, "good", "docs", "specs", "2026-01-02-widget.md");
	const payload = payloadFor(SPEC);
	const s1 = payload.nodes.find((n) => n.id === "S1");
	assert.equal(isCovered(payload, s1), true, "scenario wrongly uncovered without a build artefact");
});
