import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

import { render } from "./render.mjs";
import { mdToHtml } from "./lib/markdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");
const PLAN = join(FIXTURES, "good", "docs", "plans", "2026-01-01-widget.md");
const BUILD = join(FIXTURES, "good", "docs", "plans", "2026-01-03-widget-build.md");

test("render is deterministic: two runs, identical bytes", () => {
	assert.equal(render(PLAN), render(PLAN));
	assert.equal(render(BUILD), render(BUILD));
});

test("output is one self-contained page with no network fetches", () => {
	const html = render(PLAN);
	assert.match(html, /^<!doctype html>/i);
	assert.match(html, /<style>/);
	assert.match(html, /<script>/);
	// no fetched SUBRESOURCES (src=, or a <link href=). Anchor hrefs to docs are
	// explicitly allowed by the plan, so this must not flag <a href="https://...">.
	assert.ok(!/\bsrc=["'](https?:)?\/\//i.test(html), "network src= subresource found");
	assert.ok(!/<link\b[^>]*href=["'](https?:)?\/\//i.test(html), "network <link href> subresource found");
	// no timestamps
	assert.ok(!/\b20\d\d-\d\d-\d\dT\d\d:/.test(html), "timestamp-like string found");
});

test("doc-link anchors to network URLs are allowed (not treated as fetches)", () => {
	const html = mdToHtml("see [the docs](https://example.com/guide)");
	assert.match(html, /<a href="https:\/\/example.com\/guide">the docs<\/a>/);
	// the subresource guard from the render test must not trip on this anchor
	assert.ok(!/\bsrc=["'](https?:)?\/\//i.test(html));
});

test("graph JSON island carries the whole chain", () => {
	const html = render(BUILD);
	const m = html.match(/<script type="application\/json" id="ia-graph">([\s\S]*?)<\/script>/);
	assert.ok(m, "graph island missing");
	const graph = JSON.parse(m[1]);
	const ids = graph.nodes.map((n) => n.id);
	for (const id of ["T1", "S1", "O1", "D2", "C1"]) assert.ok(ids.includes(id), `missing ${id}`);
	assert.ok(graph.edges.some((e) => e.from === "T1" && e.type === "implements" && e.to === "S1"));
	assert.equal(graph.files.length, 3);
});

test("node headings render with stable anchors", () => {
	const html = render(PLAN);
	assert.match(html, /<h2 id="O1" class="node node-objective"[^>]*>O1: widgets are fast<\/h2>/);
});

test("mermaid fences become mermaid containers, other fences stay code", () => {
	const html = render(PLAN);
	assert.match(html, /<div class="mermaid">flowchart LR/);
	// the fenced pseudo-heading fixture block stays escaped code
	assert.match(html, /<pre><code[^>]*>## S99:/);
});

test("mdToHtml covers the documented subset", () => {
	const html = mdToHtml(
		[
			"para with **bold**, *em*, `code` and [a link](docs/x.md).",
			"",
			"- item one",
			"- item two",
			"",
			"1. first",
			"2. second",
			"",
			"> quoted",
			"",
			"| h1 | h2 |",
			"|---|---|",
			"| a | b |",
			"",
			"---",
		].join("\n"),
	);
	assert.match(html, /<strong>bold<\/strong>/);
	assert.match(html, /<em>em<\/em>/);
	assert.match(html, /<code>code<\/code>/);
	assert.match(html, /<a href="docs\/x.md">a link<\/a>/);
	assert.match(html, /<ul>\s*<li>item one<\/li>/);
	assert.match(html, /<ol>\s*<li>first<\/li>/);
	assert.match(html, /<blockquote>/);
	assert.match(html, /<table>[\s\S]*<th>h1<\/th>[\s\S]*<td>b<\/td>/);
	assert.match(html, /<hr\/?>/);
});

test("mdToHtml escapes raw HTML", () => {
	const html = mdToHtml("evil <script>alert(1)</script> text");
	assert.ok(!html.includes("<script>alert"), "raw HTML leaked unescaped");
	assert.match(html, /&lt;script&gt;/);
});

test("CLI writes the output file and exits 0", () => {
	const out = join(HERE, "..", "fixtures", ".tmp-render-test.html");
	const res = spawnSync(process.execPath, [join(HERE, "render.mjs"), PLAN, "-o", out], { encoding: "utf8" });
	assert.equal(res.status, 0, res.stderr);
	assert.match(readFileSync(out, "utf8"), /<!doctype html>/i);
	rmSync(out);
});
