// Hand-rolled markdown subset -> HTML. Deterministic, escape-first.
// Supported: headings, paragraphs, ul/ol (flat), blockquotes, tables,
// fenced code (```/~~~; ```mermaid becomes a mermaid container), hr,
// links, bold, italic, inline code. Anything exotic renders as escaped
// paragraphs on purpose (see SKILL.md gotchas).

import { nodeKind } from "./graph.mjs";

export function escapeHtml(s) {
	return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Allow only navigation-safe href schemes: relative/fragment paths, plus
// http(s) and mailto (anchors, not subresources). javascript:, data:, vbscript:,
// file: and friends are dropped so the link renders as inert text. Input is
// already HTML-escaped, so this guards clickable-scheme XSS on file:// pages.
export function safeHref(href) {
	const h = href.trim();
	const scheme = h.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
	if (!scheme) return h; // relative path or #fragment: safe
	return /^(https?|mailto):$/i.test(`${scheme[1]}:`) ? h : null;
}

function inline(s) {
	let out = escapeHtml(s);
	// code spans first so their contents are not further formatted
	out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
	out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
		const safe = safeHref(href);
		return safe === null ? text : `<a href="${safe}">${text}</a>`;
	});
	out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
	return out;
}

const NODE_HEADING_RE = /^(#{2,4}) (\S+): (.+?)\s*$/;
const PLAIN_HEADING_RE = /^(#{1,4}) (.+?)\s*$/;

/** Render a markdown body. Node headings get stable anchors + classes. */
export function mdToHtml(src) {
	const lines = src.split("\n");
	const out = [];
	let i = 0;
	let para = [];

	const flushPara = () => {
		if (para.length) {
			out.push(`<p>${para.map(inline).join("\n")}</p>`);
			para = [];
		}
	};

	while (i < lines.length) {
		const line = lines[i];

		// fenced code: open on a fence line (with optional info string), close only
		// on a bare marker line of the same char and >= length (CommonMark-ish),
		// so an info-string line inside the block does not close it early (F6).
		const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/);
		if (fence) {
			flushPara();
			const fenceChar = fence[2][0];
			const fenceLen = fence[2].length;
			const lang = fence[3];
			const buf = [];
			i++;
			const isClose = (l) => {
				const m = l.match(/^\s*(`{3,}|~{3,})\s*$/);
				return m && m[1][0] === fenceChar && m[1].length >= fenceLen;
			};
			while (i < lines.length && !isClose(lines[i])) {
				buf.push(lines[i]);
				i++;
			}
			i++; // closing fence
			const codeText = buf.join("\n");
			if (lang === "mermaid") {
				out.push(`<figure class="diagram"><div class="mermaid">${escapeHtml(codeText)}</div></figure>`);
			} else {
				const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
				out.push(`<pre><code${cls}>${escapeHtml(codeText)}</code></pre>`);
			}
			continue;
		}

		// blank
		if (!line.trim()) {
			flushPara();
			i++;
			continue;
		}

		// hr
		if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
			flushPara();
			out.push("<hr>");
			i++;
			continue;
		}

		// headings (node headings first for anchors)
		const nodeH = line.match(NODE_HEADING_RE);
		if (nodeH && nodeKind(nodeH[2])) {
			flushPara();
			const level = nodeH[1].length;
			const kind = nodeKind(nodeH[2]);
			out.push(
				`<h${level} id="${escapeHtml(nodeH[2])}" class="node node-${kind}" data-node="${escapeHtml(nodeH[2])}">${escapeHtml(nodeH[2])}: ${inline(nodeH[3])}</h${level}>`,
			);
			i++;
			continue;
		}
		const plainH = line.match(PLAIN_HEADING_RE);
		if (plainH) {
			flushPara();
			const level = plainH[1].length;
			out.push(`<h${level}>${inline(plainH[2])}</h${level}>`);
			i++;
			continue;
		}

		// blockquote
		if (line.startsWith(">")) {
			flushPara();
			const buf = [];
			while (i < lines.length && lines[i].startsWith(">")) {
				buf.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			out.push(`<blockquote>${mdToHtml(buf.join("\n"))}</blockquote>`);
			continue;
		}

		// table
		if (line.startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
			flushPara();
			const cells = (l) =>
				l
					.replace(/^\|/, "")
					.replace(/\|\s*$/, "")
					.split("|")
					.map((c) => inline(c.trim()));
			const head = cells(line);
			i += 2;
			const rows = [];
			while (i < lines.length && lines[i].startsWith("|")) {
				rows.push(cells(lines[i]));
				i++;
			}
			out.push(
				`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows
					.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
					.join("")}</tbody></table>`,
			);
			continue;
		}

		// lists (flat; indented continuations join the item)
		const ul = /^\s*[-*] (.+)$/;
		const ol = /^\s*\d+\. (.+)$/;
		if (ul.test(line) || ol.test(line)) {
			flushPara();
			const ordered = ol.test(line);
			const re = ordered ? ol : ul;
			const items = [];
			while (i < lines.length) {
				const m = lines[i].match(re);
				if (m) {
					items.push(m[1]);
					i++;
				} else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
					items[items.length - 1] += ` ${lines[i].trim()}`;
					i++;
				} else break;
			}
			const tag = ordered ? "ol" : "ul";
			out.push(`<${tag}>\n${items.map((it) => `<li>${inline(it)}</li>`).join("\n")}\n</${tag}>`);
			continue;
		}

		// paragraph line
		para.push(line.trim());
		i++;
	}
	flushPara();
	return out.join("\n");
}
