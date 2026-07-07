// IA graph parser: front matter, inline heading nodes, upstream chain.
// Schema: ../../docs/schema.md (v0-experimental). Node built-ins only.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, isAbsolute, sep } from "node:path";

export const EDGE_TYPES = new Set(["verifies", "implements", "mitigated-by", "covered-by"]);
export const KINDS = new Set(["plan", "spec", "build"]);

// Allowed endpoint kinds per edge type (semantic shape; schema docs/schema.md).
export const EDGE_SHAPES = {
	verifies: { from: ["scenario"], to: ["objective", "contract"] },
	implements: { from: ["task"], to: ["scenario"] },
	"mitigated-by": { from: ["risk"], to: ["scenario"] },
	"covered-by": { from: ["dod"], to: ["scenario", "task"] },
};

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

/** Parse an inline `links:` value: a flow list of three-element flow lists,
 * e.g. `[[S1, verifies, O1], [R1, mitigated-by, S1]]`. Returns
 * { triples, error }. A bare `[a, b, c]` (not a list of lists) is an error,
 * so malformed inline links fail loudly instead of vanishing. */
export function parseInlineLinks(raw) {
	const outer = raw.trim();
	// Whole value must be a bracketed list of bracketed triples and nothing
	// else: this rejects a bare `[a, b, c]` and trailing garbage like
	// `[[a, b, c], junk]` instead of silently keeping the parseable prefix.
	if (!/^\[\s*\[[^\[\]]*\]\s*(,\s*\[[^\[\]]*\]\s*)*\]$/.test(outer)) {
		return { triples: [], error: `inline links must be a list of three-element flow lists ([[a, b, c], ...]); got ${outer}` };
	}
	const triples = [];
	const re = /\[([^\[\]]*)\]/g;
	let m;
	while ((m = re.exec(outer)) !== null) {
		const parts = m[1].split(",").map((s) => s.trim());
		if (parts.length !== 3 || parts.some((p) => !p))
			return { triples: [], error: `inline links entry [${m[1]}] is not a three-element flow list` };
		triples.push(parts);
	}
	return { triples, error: null };
}

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
		const inlineLinks = line.match(/^links:\s*(\S.*)$/);
		if (inlineLinks) {
			inLinks = false;
			const { triples, error } = parseInlineLinks(inlineLinks[1]);
			if (error) errors.push(error);
			else meta.links.push(...triples);
			continue;
		}
		if (inLinks && TRIPLE_RE.test(line)) {
			const inner = line.match(TRIPLE_RE)[1];
			const parts = inner.split(",").map((s) => s.trim());
			if (parts.length !== 3 || parts.some((p) => !p)) {
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

/**
 * Extract inline heading nodes from a markdown body. Skips fenced code
 * blocks and level-1 headings. Each node: { id, kind, title, level, line,
 * severity } where severity comes from a `severity: <level>` line in the
 * node's own section (until the next heading of same or higher level).
 */
export function parseNodes(body) {
	const lines = body.split("\n");
	const nodes = [];
	let fence = null; // { char, len } while inside a fenced block
	for (let i = 0; i < lines.length; i++) {
		const open = lines[i].match(/^\s*(`{3,}|~{3,})/);
		if (!fence && open) {
			fence = { char: open[1][0], len: open[1].length };
			continue;
		}
		if (fence) {
			// A closing fence is a bare marker line (same char, >= length, no info string).
			const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
			if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
			continue;
		}
		const m = lines[i].match(HEADING_RE);
		if (!m) continue;
		const kind = nodeKind(m[2]);
		if (!kind) continue;
		nodes.push({ id: m[2], kind, title: m[3], level: m[1].length, line: i + 1, severity: null });
	}
	// severity: scan each node's section, using the same structured fence
	// tracking as the node scan so a `severity:` line inside an info-string
	// code block is not read as real severity.
	for (let n = 0; n < nodes.length; n++) {
		const start = nodes[n].line; // first line after the heading (1-based heading line)
		let fence = null;
		let severity = null;
		for (let i = start; i < lines.length; i++) {
			const open = lines[i].match(/^\s*(`{3,}|~{3,})/);
			if (!fence && open) {
				fence = { char: open[1][0], len: open[1].length };
				continue;
			}
			if (fence) {
				const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
				if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
				continue;
			}
			const h = lines[i].match(/^(#{1,4}) /);
			if (h && h[1].length <= nodes[n].level) break;
			const sev = lines[i].match(/^severity:\s*(low|medium|high)\s*$/);
			if (sev) severity = sev[1];
		}
		nodes[n].severity = severity;
	}
	return nodes;
}

/**
 * Resolve an upstream path: try relative to the referencing file's dir, then
 * walk up ancestor directories (covers repo-root-relative paths without
 * needing to find the repo root explicitly).
 */
/** True when an upstream value is safe to resolve: relative, no `..`
 * segments, no absolute path. Traversal outside the artefact tree is a
 * security boundary (see security.test.mjs F1). */
export function upstreamError(upstream) {
	if (isAbsolute(upstream)) return `upstream path may not be absolute: ${upstream}`;
	if (upstream.split(/[\\/]/).includes("..")) return `upstream path may not contain "..": ${upstream}`;
	return null;
}

/** Nearest ancestor directory containing a `.git` entry (file or dir), or
 * null. This is the boundary for repo-relative upstream resolution. */
export function repoRootFor(startDir) {
	let dir = startDir;
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function resolveUpstream(fromFile, upstream) {
	const startDir = dirname(resolve(fromFile));
	const root = repoRootFor(startDir);
	const boundary = root ?? startDir;
	let boundaryReal;
	try {
		boundaryReal = realpathSync(boundary);
	} catch {
		boundaryReal = resolve(boundary);
	}
	let dir = startDir;
	for (;;) {
		const candidate = join(dir, upstream);
		if (existsSync(candidate)) {
			// Resolve symlinks and confine the real path within the boundary: an
			// in-repo symlink (e.g. docs/etc -> /etc) must not let `etc/passwd`
			// escape the repo and disclose an out-of-tree file.
			let real;
			try {
				real = realpathSync(candidate);
			} catch {
				real = resolve(candidate);
			}
			if (real === boundaryReal || real.startsWith(boundaryReal + sep)) return real;
			return null; // resolves (via symlink or otherwise) outside the boundary
		}
		// Bound the ancestor walk at the repo root. Without a repo boundary,
		// resolution is confined to the entry file's own directory, so a value
		// like `etc/passwd` cannot climb to a filesystem-root file.
		if (!root || dir === root) return null;
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
		const uErr = upstreamError(meta.upstream);
		if (uErr) {
			errors.push(`${current}: ${uErr}`);
			break;
		}
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
				nodes.set(n.id, { ...n, file: f.path, fileKind: f.meta.kind ?? null });
			}
		}
	}
	for (const f of chain.files) {
		for (const [from, type, to] of f.meta.links) {
			if (!EDGE_TYPES.has(type)) errors.push(`${f.path}: unknown edge type "${type}" in [${from}, ${type}, ${to}]`);
			for (const end of [from, to]) {
				if (!nodes.has(end)) errors.push(`${f.path}: dangling edge endpoint ${end} in [${from}, ${type}, ${to}]`);
			}
			// Endpoint-kind (semantic shape): a verifies edge must run scenario->objective|contract, etc.
			const shape = EDGE_SHAPES[type];
			if (shape && nodes.has(from) && nodes.has(to)) {
				const fk = nodes.get(from).kind;
				const tk = nodes.get(to).kind;
				if (!shape.from.includes(fk))
					errors.push(`${f.path}: edge [${from}, ${type}, ${to}] has wrong source kind (${from} is a ${fk}; ${type} must start at ${shape.from.join("|")})`);
				if (!shape.to.includes(tk))
					errors.push(`${f.path}: edge [${from}, ${type}, ${to}] has wrong target kind (${to} is a ${tk}; ${type} must end at a ${shape.to.join("|")})`);
			}
			edges.push({ from, type, to, file: f.path });
		}
	}
	return { nodes, edges, errors };
}
