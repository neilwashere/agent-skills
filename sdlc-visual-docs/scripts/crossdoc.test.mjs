import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { render } from "./render.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const BUILD = join(FIXTURES, "good", "docs", "plans", "2026-01-03-widget-build.md");
const PLAN = join(FIXTURES, "good", "docs", "plans", "2026-01-01-widget.md");

test("cross-document render: one page carries the whole chain in reading order", () => {
	const html = render(BUILD);
	// all three artefact bodies present, each with a provenance line
	const provenances = [...html.matchAll(/<div class="provenance">([^<]+)<\/div>/g)].map((m) => m[1]);
	assert.equal(provenances.length, 3);
	// reading order: plan first, build last
	assert.match(provenances[0], /2026-01-01-widget\.md \(plan\)/);
	assert.match(provenances[1], /2026-01-02-widget\.md \(spec\)/);
	assert.match(provenances[2], /2026-01-03-widget-build\.md \(build\)/);
	// nodes from every file render as anchored headings on the one page
	for (const [id, kind] of [
		["O1", "objective"],
		["S2", "scenario"],
		["C1", "contract"],
		["T1", "task"],
	]) {
		assert.match(html, new RegExp(`<h\\d id="${id}" class="node node-${kind}"`), `${id} heading missing`);
	}
	// cross-file edge present in the island
	assert.match(html, /\{"from":"T1","type":"implements","to":"S1"\}/);
});

test("cross-document render: a plan-only chain is a single article", () => {
	const html = render(PLAN);
	const provenances = [...html.matchAll(/<div class="provenance">([^<]+)<\/div>/g)].map((m) => m[1]);
	assert.equal(provenances.length, 1);
	assert.match(provenances[0], /2026-01-01-widget\.md \(plan\)/);
});
