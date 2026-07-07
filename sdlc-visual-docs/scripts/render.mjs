#!/usr/bin/env node
// Deterministic renderer: one SDLC artefact (plus its upstream chain) ->
// one self-contained HTML page. No LLM, no network, no timestamps.
// Usage: node render.mjs <artefact.md> [-o out.html]   (default: stdout)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import { mdToHtml, escapeHtml } from "./lib/markdown.mjs";
import { lint } from "./lint.mjs";
import { components } from "./lib/components.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "assets");

function asset(name) {
	try {
		return readFileSync(join(ASSETS, name), "utf8");
	} catch {
		return "";
	}
}

// Escape a JSON payload for safe embedding inside <script>...</script>: a raw
// JSON.stringify leaves `<`/`>` intact, so a string containing `</script>`
// would break out of the element (F2). Also neutralise the JS line separators.
function jsonForScript(obj) {
	return JSON.stringify(obj)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/** Build the graph JSON island payload (stable ordering, relative paths). */
export function graphPayload(entryPath, res) {
	const base = dirname(resolve(entryPath));
	const rel = (p) => relative(base, p) || p;
	const { nodes, edges } = res.graph;
	return {
		ia: res.chain.files[0]?.meta.ia ?? null,
		feature: res.chain.files[0]?.meta.feature ?? null,
		entryKind: res.chain.files[0]?.meta.kind ?? null,
		files: res.chain.files.map((f) => ({ path: rel(f.path), kind: f.meta.kind ?? null, feature: f.meta.feature ?? null })),
		nodes: [...nodes.values()].map((n) => ({
			id: n.id,
			kind: n.kind,
			title: n.title,
			severity: n.severity,
			file: rel(n.file),
		})),
		edges: edges.map((e) => ({ from: e.from, type: e.type, to: e.to })),
		errors: res.errors,
		warnings: res.warnings,
	};
}

/** Render one artefact to a full HTML page string. */
export function render(entryPath) {
	const res = lint(entryPath);
	const payload = graphPayload(entryPath, res);
	const entry = res.chain.files[0];
	const title = `${payload.feature ?? "artefact"} (${payload.entryKind ?? "?"})`;

	const banner = res.errors.length
		? `<div class="banner-errors"><strong>Graph errors (lint fails):</strong><ul>${res.errors
				.map((e) => `<li>${escapeHtml(e)}</li>`)
				.join("")}</ul></div>`
		: "";

	// Reading order: upstream first (plan, then spec, then build).
	const articles = [...res.chain.files]
		.reverse()
		.map(
			(f) =>
				`<article class="artefact" id="file-${escapeHtml(relative(dirname(resolve(entryPath)), f.path) || f.path)}">
<div class="provenance">${escapeHtml(relative(dirname(resolve(entryPath)), f.path) || f.path)} (${escapeHtml(f.meta.kind ?? "?")})</div>
${mdToHtml(f.body)}
</article>`,
		)
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${asset("style.css")}</style>
</head>
<body>
<header class="page">
<h1>${escapeHtml(title)}</h1>
<div class="meta">ia: ${escapeHtml(payload.ia ?? "?")} · chain: ${payload.files
		.map((f) => `${escapeHtml(f.path)} (${escapeHtml(f.kind ?? "?")})`)
		.join(" ← ")}</div>
</header>
<main>
${banner}
${components(payload)}
${articles}
</main>
<script type="application/json" id="ia-graph">${jsonForScript(payload)}</script>
<script>${asset("mermaid.min.js")}</script>
<script>${asset("app.js")}</script>
</body>
</html>
`;
}

function main(argv) {
	const args = argv.slice(2);
	const force = args.includes("--force");
	const filtered = args.filter((a) => a !== "--force");
	const oIdx = filtered.indexOf("-o");
	let out = null;
	if (oIdx !== -1) {
		out = filtered[oIdx + 1];
		if (!out || out.startsWith("-")) {
			console.error("usage: node render.mjs <artefact.md> [-o out.html] [--force]");
			return 2;
		}
		filtered.splice(oIdx, 2);
	}
	const entry = filtered[0];
	if (!entry) {
		console.error("usage: node render.mjs <artefact.md> [-o out.html] [--force]");
		return 2;
	}
	// Gate on lint: a failing artefact (dangling/hostile upstream, malformed
	// graph) does not render unless --force. This keeps the path-traversal and
	// malformed cases from producing a normal-looking, shareable page (F4).
	const res = lint(entry);
	if (!res.ok && !force) {
		for (const e of res.errors) console.error(`FAIL ${e}`);
		console.error(`refusing to render ${entry}: ${res.errors.length} lint error(s). Pass --force to override.`);
		return 2;
	}
	const html = render(entry);
	if (out) {
		writeFileSync(out, html);
		console.error(`wrote ${out}`);
	} else {
		process.stdout.write(html);
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exit(main(process.argv));
}
