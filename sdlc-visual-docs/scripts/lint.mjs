#!/usr/bin/env node
// IA graph lint. Normative rules: ../docs/schema.md (v0-experimental).
// Usage: node lint.mjs <artefact.md>   (exit 0 clean/warned, 1 on errors)

import { fileURLToPath } from "node:url";
import { relative } from "node:path";

import { loadChain, buildGraph } from "./lib/graph.mjs";

/**
 * Lint one artefact (following its upstream chain).
 * Returns { ok, errors, warnings, report, chain, graph }.
 */
export function lint(entryPath) {
	const chain = loadChain(entryPath);
	const graph = buildGraph(chain);
	const { nodes, edges, errors } = graph;
	const warnings = [];

	const has = (pred) => edges.some(pred);

	for (const node of nodes.values()) {
		if (node.kind === "scenario") {
			const verifiesObjective = has(
				(e) => e.type === "verifies" && e.from === node.id && nodes.get(e.to)?.kind === "objective",
			);
			if (!verifiesObjective) errors.push(`scenario ${node.id} has no "verifies" edge to an objective`);
		}
		if (node.kind === "contract") {
			const verified = has((e) => e.type === "verifies" && e.to === node.id && nodes.get(e.from)?.kind === "scenario");
			if (!verified) errors.push(`contract ${node.id} has no verifying scenario`);
		}
		if (node.kind === "task") {
			const covered = has(
				(e) => (e.type === "implements" && e.from === node.id) || (e.type === "covered-by" && e.to === node.id),
			);
			if (!covered) errors.push(`task ${node.id} has no "implements" or "covered-by" edge`);
		}
		if (node.kind === "risk" && node.severity === "high") {
			const mitigated = has((e) => e.type === "mitigated-by" && e.from === node.id);
			if (!mitigated) warnings.push(`risk ${node.id} is severity high with no "mitigated-by" edge`);
		}
	}

	const report = chain.files.map((f) => ({
		file: f.path,
		kind: f.meta.kind ?? null,
		nodes: f.nodes.map((n) => n.id),
	}));

	return { ok: errors.length === 0, errors, warnings, report, chain, graph };
}

function main(argv) {
	const entry = argv[2];
	if (!entry) {
		console.error("usage: node lint.mjs <artefact.md>");
		return 2;
	}
	const { ok, errors, warnings, report } = lint(entry);
	for (const f of report) {
		const rel = relative(process.cwd(), f.file);
		console.log(`${rel} (${f.kind ?? "?"}): ${f.nodes.length ? f.nodes.join(", ") : "no nodes"}`);
	}
	for (const w of warnings) console.log(`WARN ${w}`);
	for (const e of errors) console.error(`FAIL ${e}`);
	console.log(ok ? `OK (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : `FAILED (${errors.length} error${errors.length === 1 ? "" : "s"})`);
	return ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exit(main(process.argv));
}
