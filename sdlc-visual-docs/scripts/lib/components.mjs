// The five v0 visual components, generated as static HTML from the graph
// payload. Interactivity (highlight, collapse, filter) lives in
// assets/app.js; everything here must be deterministic.

import { escapeHtml } from "./markdown.mjs";

const KIND_LABEL = {
	objective: "Objective",
	contract: "Contract",
	scenario: "Scenario",
	task: "Task",
	risk: "Risk",
	dod: "DoD",
};

function edgesOf(payload, id) {
	return payload.edges.filter((e) => e.from === id || e.to === id);
}

/**
 * Coverage per node kind. "Uncovered" means: nothing discharges this node.
 * Coverage is only judged where the chain can express it: objectives need a
 * spec in the chain (fast-path chains have no scenarios to verify them);
 * scenario-by-task coverage needs a build file.
 */
export function isCovered(payload, node) {
	const es = payload.edges;
	const hasBuild = payload.files.some((f) => f.kind === "build");
	const hasSpec = payload.files.some((f) => f.kind === "spec");
	switch (node.kind) {
		case "objective":
			return !hasSpec || es.some((e) => e.type === "verifies" && e.to === node.id);
		case "contract":
			return es.some((e) => e.type === "verifies" && e.to === node.id);
		case "scenario":
			return !hasBuild || es.some((e) => (e.type === "implements" && e.to === node.id) || (e.type === "covered-by" && e.from === node.id));
		case "task":
			return es.some((e) => (e.type === "implements" && e.from === node.id) || (e.type === "covered-by" && e.to === node.id));
		case "dod":
			return es.some((e) => e.type === "covered-by" && e.from === node.id);
		case "risk":
			return node.severity !== "high" || es.some((e) => e.type === "mitigated-by" && e.from === node.id);
		default:
			return true;
	}
}

function nodeRef(id) {
	return `<a href="#${escapeHtml(id)}" data-node="${escapeHtml(id)}" class="id">${escapeHtml(id)}</a>`;
}

function traceMatrix(payload) {
	const order = ["objective", "contract", "scenario", "task", "dod", "risk"];
	const nodes = [...payload.nodes].sort(
		(a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id, "en", { numeric: true }),
	);
	const rows = nodes
		.map((n) => {
			const covered = isCovered(payload, n);
			const rels = edgesOf(payload, n.id)
				.map((e) =>
					e.from === n.id
						? `<span>${escapeHtml(e.type)} → ${nodeRef(e.to)}</span>`
						: `<span>${nodeRef(e.from)} ${escapeHtml(e.type)} →</span>`,
				)
				.join(" ");
			return `<tr class="${covered ? "covered" : "uncovered"}" data-node="${escapeHtml(n.id)}">
<td class="id">${nodeRef(n.id)}</td>
<td class="kind">${KIND_LABEL[n.kind] ?? n.kind}</td>
<td>${escapeHtml(n.title)}</td>
<td class="edges">${rels || "<span>—</span>"}</td>
<td>${covered ? '<span class="badge ok">covered</span>' : '<span class="badge uncovered">uncovered</span>'}</td>
</tr>`;
		})
		.join("\n");
	return `<section class="component" id="trace">
<h2>Traceability</h2>
<table class="trace"><thead><tr><th>ID</th><th>Kind</th><th>Title</th><th>Edges</th><th>Coverage</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</section>`;
}

function contractPanel(payload) {
	const contracts = payload.nodes.filter((n) => n.kind === "contract");
	if (!contracts.length) return "";
	const items = contracts
		.map((c) => {
			const verifiers = payload.edges.filter((e) => e.type === "verifies" && e.to === c.id).map((e) => nodeRef(e.from));
			return `<li data-node="${escapeHtml(c.id)}">${nodeRef(c.id)}: ${escapeHtml(c.title)} <span class="kind">(${escapeHtml(
				c.file,
			)})</span><br>verified by: ${verifiers.join(", ") || '<span class="badge uncovered">nothing</span>'}</li>`;
		})
		.join("\n");
	return `<section class="component" id="contracts">
<h2>Contract surface (shapes this change freezes)</h2>
<ul>
${items}
</ul>
</section>`;
}

function riskMap(payload) {
	const risks = payload.nodes.filter((n) => n.kind === "risk");
	if (!risks.length) return "";
	const sevRank = { high: 0, medium: 1, low: 2, null: 3 };
	const sorted = [...risks].sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3) || a.id.localeCompare(b.id, "en", { numeric: true }));
	const items = sorted
		.map((r) => {
			const sev = r.severity ?? "unrated";
			const mitigations = payload.edges.filter((e) => e.type === "mitigated-by" && e.from === r.id).map((e) => nodeRef(e.to));
			return `<div class="risk ${escapeHtml(r.severity ?? "low")}" data-node="${escapeHtml(r.id)}">
<span class="sev">${escapeHtml(sev)}</span> ${nodeRef(r.id)}: ${escapeHtml(r.title)}<br>
mitigation verified by: ${mitigations.join(", ") || "<em>none declared</em>"}
</div>`;
		})
		.join("\n");
	return `<section class="component" id="risks">
<h2>Risks</h2>
<p>
<button class="linklike" data-risk-filter="all">all</button>
<button class="linklike" data-risk-filter="high">high</button>
<button class="linklike" data-risk-filter="medium">medium</button>
<button class="linklike" data-risk-filter="low">low</button>
</p>
<div class="risks">
${items}
</div>
</section>`;
}

function dodChecklist(payload) {
	const dods = payload.nodes.filter((n) => n.kind === "dod").sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
	if (!dods.length) return "";
	const items = dods
		.map((d) => {
			const covered = isCovered(payload, d);
			const by = payload.edges.filter((e) => e.type === "covered-by" && e.from === d.id).map((e) => nodeRef(e.to));
			return `<li class="${covered ? "covered" : "uncovered"}" data-node="${escapeHtml(d.id)}">${nodeRef(d.id)}: ${escapeHtml(
				d.title,
			)}${by.length ? ` — covered by ${by.join(", ")}` : ""}</li>`;
		})
		.join("\n");
	return `<section class="component" id="dod">
<h2>Definition of done coverage</h2>
<ul class="dod">
${items}
</ul>
</section>`;
}

/**
 * All graph-driven components. The fifth component (architecture diagrams)
 * renders inline in the artefact bodies via mermaid fences; interactivity is
 * assets/app.js.
 */
export function components(payload) {
	return [traceMatrix(payload), contractPanel(payload), riskMap(payload), dodChecklist(payload)].filter(Boolean).join("\n");
}
