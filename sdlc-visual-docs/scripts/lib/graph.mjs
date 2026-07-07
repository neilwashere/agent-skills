// IA graph parser: front matter, inline heading nodes, upstream chain.
// Schema: ../../docs/schema.md (v0-experimental). Node built-ins only.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const EDGE_TYPES = new Set(["verifies", "implements", "mitigated-by", "covered-by"]);
export const KINDS = new Set(["plan", "spec", "build"]);

const ID_RULES = [
	[/^O\d+$/, "objective"],
	[/^C\d+$/, "contract"],
	[/^S\d+$/, "scenario"],
	[/^T\d+$/, "task"],
	[/^R\d+$/, "risk"],
	[/^D\d+$/, "dod"],
	// Escape hatch for pre-schema scenario IDs like M1.S1: uppercase start,
	// dot-separated alphanumeric segments (rejects "e.g.", trailing dots).
	[/^[A-Z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/, "scenario"],
];

/** Classify an ID token; null when it is not a graph node. */
export function nodeKind(id) {
	for (const [re, kind] of ID_RULES) if (re.test(id)) return kind;
	return null;
}

const TRIPLE_RE = /^\s*-\s*\[([^\]]*)\]\s*$/;

/**
 * Parse the tiny YAML subset the schema allows: string scalars plus a
 * `links:` list of three-element flow lists. Returns { meta, body, errors }.
 */
export function parseFrontMatter(text) {
	const meta = { links: [] };
	const errors = [];
	const lines = text.split("\n");
	if (lines[0]?.trim() !== "---") {
		return { meta, body: text, errors: ["no front matter block (expected leading ---)"] };
	}
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			end = i;
			break;
		}
	}
	if (end === -1) return { meta, body: text, errors: ["unterminated front matter block"] };

	let inLinks = false;
	for (let i = 1; i < end; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		if (/^links:\s*$/.test(line)) {
			inLinks = true;
			continue;
		}
		if (inLinks && TRIPLE_RE.test(line)) {
			const inner = line.match(TRIPLE_RE)[1];
			const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
			if (parts.length !== 3) {
				errors.push(`links entry ${JSON.stringify(line.trim())} is not a three-element flow list`);
			} else {
				meta.links.push(parts);
			}
			continue;
		}
		const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
		if (kv && !line.startsWith(" ")) {
			inLinks = false;
			if (kv[1] !== "links") meta[kv[1]] = kv[2].trim();
			continue;
		}
		errors.push(`unparseable front matter line: ${JSON.stringify(line)}`);
	}
	const body = lines.slice(end + 1).join("\n");
	return { meta, body, errors };
}

const HEADING_RE = /^(#{2,4}) (\S+): (.+?)\s*$/;
const FENCE_RE = /^(```|~~~)/;

/**
 * Extract inline heading nodes from a markdown body. Skips fenced code
 * blocks and level-1 headings. Each node: { id, kind, title, level, line,
 * severity } where severity comes from a `severity: <level>` line in the
 * node's own section (until the next heading of same or higher level).
 */
export function parseNodes(body) {
	const lines = body.split("\n");
	const nodes = [];
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE_RE.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = lines[i].match(HEADING_RE);
		if (!m) continue;
		const kind = nodeKind(m[2]);
		if (!kind) continue;
		nodes.push({ id: m[2], kind, title: m[3], level: m[1].length, line: i + 1, severity: null });
	}
	// severity: scan each node's section
	for (let n = 0; n < nodes.length; n++) {
		const start = nodes[n].line; // first line after the heading (1-based heading line)
		let endLine = lines.length;
		let fence = false;
		for (let i = start; i < lines.length; i++) {
			if (FENCE_RE.test(lines[i])) fence = !fence;
			if (fence) continue;
			const h = lines[i].match(/^(#{1,4}) /);
			if (h && h[1].length <= nodes[n].level) {
				endLine = i;
				break;
			}
		}
		for (let i = start; i < endLine; i++) {
			const sev = lines[i].match(/^severity:\s*(low|medium|high)\s*$/);
			if (sev) nodes[n].severity = sev[1];
		}
	}
	return nodes;
}

/**
 * Resolve an upstream path: try relative to the referencing file's dir, then
 * walk up ancestor directories (covers repo-root-relative paths without
 * needing to find the repo root explicitly).
 */
export function resolveUpstream(fromFile, upstream) {
	let dir = dirname(resolve(fromFile));
	for (;;) {
		const candidate = join(dir, upstream);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Load an artefact and follow its upstream chain. Returns
 * { files: [{ path, meta, body, nodes, errors }], errors } with the entry
 * artefact first. Missing upstream files and cycles are chain errors.
 */
export function loadChain(entryPath) {
	const files = [];
	const errors = [];
	const seen = new Set();
	let current = resolve(entryPath);
	while (current) {
		if (seen.has(current)) {
			errors.push(`upstream cycle at ${current}`);
			break;
		}
		seen.add(current);
		let text;
		try {
			text = readFileSync(current, "utf8");
		} catch {
			errors.push(`cannot read ${current}`);
			break;
		}
		const { meta, body, errors: fmErrors } = parseFrontMatter(text);
		const nodes = parseNodes(body);
		files.push({ path: current, meta, body, nodes, errors: fmErrors });
		if (!meta.upstream) break;
		const next = resolveUpstream(current, meta.upstream);
		if (!next) {
			errors.push(`upstream not found from ${current}: ${meta.upstream}`);
			break;
		}
		current = next;
	}
	return { files, errors };
}

/**
 * Build the combined graph over a loaded chain. Returns
 * { nodes: Map<id, node&{file}>, edges: [{from,type,to,file}], errors }.
 * Errors here are structural: duplicates, dangling endpoints, unknown edge
 * types, per-file front matter problems.
 */
export function buildGraph(chain) {
	const nodes = new Map();
	const edges = [];
	const errors = [...chain.errors];

	for (const f of chain.files) {
		for (const e of f.errors) errors.push(`${f.path}: ${e}`);
		for (const key of ["ia", "kind", "feature"]) {
			if (!f.meta[key]) errors.push(`${f.path}: missing required front matter key "${key}"`);
		}
		if (f.meta.kind && !KINDS.has(f.meta.kind)) errors.push(`${f.path}: unknown kind "${f.meta.kind}"`);
		for (const n of f.nodes) {
			if (nodes.has(n.id)) {
				errors.push(`${f.path}: duplicate node ID ${n.id} (first declared in ${nodes.get(n.id).file})`);
			} else {
				nodes.set(n.id, { ...n, file: f.path });
			}
		}
	}
	for (const f of chain.files) {
		for (const [from, type, to] of f.meta.links) {
			if (!EDGE_TYPES.has(type)) errors.push(`${f.path}: unknown edge type "${type}" in [${from}, ${type}, ${to}]`);
			for (const end of [from, to]) {
				if (!nodes.has(end)) errors.push(`${f.path}: dangling edge endpoint ${end} in [${from}, ${type}, ${to}]`);
			}
			edges.push({ from, type, to, file: f.path });
		}
	}
	return { nodes, edges, errors };
}
