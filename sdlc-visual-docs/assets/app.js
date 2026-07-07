// sdlc-visual-docs page runtime. Vanilla JS, inlined, no fetches.
// Reads the #ia-graph JSON island; drives highlight/collapse/filter.
(function () {
	"use strict";
	var island = document.getElementById("ia-graph");
	if (!island) return;
	var graph = JSON.parse(island.textContent);
	var edges = graph.edges || [];

	function neighbours(id) {
		var set = { };
		set[id] = true;
		edges.forEach(function (e) {
			if (e.from === id) set[e.to] = true;
			if (e.to === id) set[e.from] = true;
		});
		return set;
	}

	var selected = null;
	function applySelection(id) {
		var all = document.querySelectorAll("[data-node]");
		if (!id) {
			all.forEach(function (el) { el.classList.remove("highlight", "dim"); });
			return;
		}
		var keep = neighbours(id);
		all.forEach(function (el) {
			var nid = el.getAttribute("data-node");
			el.classList.toggle("highlight", !!keep[nid]);
			el.classList.toggle("dim", !keep[nid]);
		});
	}

	document.addEventListener("click", function (ev) {
		var nodeEl = ev.target.closest("[data-node]");
		if (nodeEl && !ev.target.closest("a")) {
			var id = nodeEl.getAttribute("data-node");
			selected = selected === id ? null : id;
			applySelection(selected);
			return;
		}
		var head = ev.target.closest("section.component > h2");
		if (head) {
			head.parentElement.classList.toggle("collapsed");
			return;
		}
		var filter = ev.target.closest("[data-risk-filter]");
		if (filter) {
			var wrap = document.querySelector(".risks");
			if (!wrap) return;
			var want = filter.getAttribute("data-risk-filter");
			["filter-high", "filter-medium", "filter-low"].forEach(function (c) { wrap.classList.remove(c); });
			if (want !== "all") wrap.classList.add("filter-" + want);
		}
	});

	// Mermaid: initialise only if the vendored bundle was inlined (T5).
	if (window.mermaid) {
		window.mermaid.initialize({ startOnLoad: true, theme: "neutral" });
	}
})();
