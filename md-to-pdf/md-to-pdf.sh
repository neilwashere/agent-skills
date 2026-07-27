#!/usr/bin/env bash
# md-to-pdf.sh - render a Markdown file to a clean A4 PDF, fully offline.
# Converts a small Markdown subset (h1/h2/h3, **bold**, *italic*, _em_, `code`,
# > blockquotes, - bullets, [text](url) and <email> autolinks) to styled HTML,
# then prints to PDF via a cached headless Chrome/Chromium. Built for CVs,
# cover letters, pitch one-pagers and prose docs. The renderer only lays prose
# out, it never rewrites it, so it introduces no em-dashes or other "tells".
# Fully offline: no pandoc/weasyprint/wkhtmltopdf needed; reuses a Chromium
# already cached by Playwright/Puppeteer (or a system browser).
#
# Usage: bin/md-to-pdf.sh <input.md> [output.pdf]
set -uo pipefail
SRC="${1:?usage: md-to-pdf.sh <input.md> [output.pdf]}"
OUT="${2:-${SRC%.md}.pdf}"
[ -f "$SRC" ] || { echo "markdown not found: $SRC" >&2; exit 1; }

# Discover any cached Chromium/Chrome (Playwright or Puppeteer cache, or system). Newest wins.
CHROME="$( { find "$HOME/.cache/ms-playwright" -maxdepth 3 -path '*chrome-linux*/chrome' -type f 2>/dev/null;
            find "$HOME/.cache/puppeteer" -maxdepth 4 -path '*chrome-linux*/chrome' -type f 2>/dev/null;
            command -v chromium chromium-browser google-chrome 2>/dev/null; } | sort | tail -1)"
[ -n "$CHROME" ] || { echo "no cached Chrome/Chromium found (Playwright or Puppeteer cache, or system browser)" >&2; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
HTML="$TMP/doc.html"

SRC="$SRC" HTML="$HTML" node <<'NODE' || { echo "markdown->html conversion failed" >&2; exit 1; }
const fs = require('fs');
const src = fs.readFileSync(process.env.SRC, 'utf8');

function inline(s) {
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '@@CODE' + (codes.length - 1) + '@@'; }); // shield code spans
  s = s.replace(/&lt;([^\s@]+@[^\s]+?)&gt;/g, '<a href="mailto:$1">$1</a>'); // <email> autolink
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  s = s.replace(/@@CODE(\d+)@@/g, (_, i) => '<code>' + codes[i] + '</code>'); // restore code spans
  return s;
}

const lines = src.split('\n');
let body = '', inList = false, sinceH1 = -1, quote = [];
const closeList = () => { if (inList) { body += '</ul>\n'; inList = false; } };
const flushQuote = () => { if (quote.length) { body += `<blockquote>${quote.map(inline).join(' ')}</blockquote>\n`; quote = []; } };

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  if (/^>\s?/.test(line)) { closeList(); quote.push(line.replace(/^>\s?/, '')); continue; }
  flushQuote();
  if (/^#\s+/.test(line))   { closeList(); body += `<h1>${inline(line.slice(2))}</h1>\n`; sinceH1 = 0; continue; }
  if (/^##\s+/.test(line))  { closeList(); body += `<h2>${inline(line.slice(3))}</h2>\n`; sinceH1 = -1; continue; }
  if (/^###\s+/.test(line)) { closeList(); body += `<h3>${inline(line.slice(4))}</h3>\n`; sinceH1 = -1; continue; }
  if (/^---\s*$/.test(line)) { closeList(); continue; } // dividers handled by CSS
  if (/^-\s+/.test(line))   { if (!inList) { body += '<ul>\n'; inList = true; } body += `<li>${inline(line.slice(2))}</li>\n`; continue; }
  if (line.trim() === '')   { closeList(); continue; }
  closeList();
  let cls = '';
  if (sinceH1 === 0)      { cls = ' class="subtitle"'; sinceH1 = 1; }
  else if (sinceH1 === 1) { cls = ' class="contact"';  sinceH1 = 2; }
  body += `<p${cls}>${inline(line)}</p>\n`;
}
closeList(); flushQuote();

const css = `
@page { size: A4; margin: 13mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.4; color: #1b1b1b; margin: 0; }
h1 { font-size: 23pt; font-weight: 700; letter-spacing: -0.4px; margin: 0 0 3px; }
.subtitle { font-size: 10.5pt; font-weight: 600; color: #0a66c2; margin: 0 0 5px; }
.contact { font-size: 9pt; color: #555; margin: 0 0 6px; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 1.6px; color: #0a66c2; border-bottom: 1.5px solid #d4d4d4; padding-bottom: 3px; margin: 15px 0 8px; break-after: avoid; }
h3 { font-size: 11pt; font-weight: 700; margin: 12px 0 1px; break-after: avoid; break-inside: avoid; }
h3 em { font-weight: 400; font-style: italic; color: #555; font-size: 9.5pt; }
p { margin: 4px 0; }
ul { margin: 4px 0 8px; padding-left: 15px; }
li { margin: 3px 0; break-inside: avoid; }
a { color: #0a66c2; text-decoration: none; }
strong { font-weight: 700; }
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 8.8pt; background: #f1f1f1; padding: 0 3px; border-radius: 3px; }
blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #0a66c2; background: #f5f8fc; font-size: 9.5pt; break-inside: avoid; }
`;

fs.writeFileSync(process.env.HTML, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>\n${body}</body></html>`);
console.log('html ' + body.length + ' chars');
NODE

"$CHROME" --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw --virtual-time-budget=3000 \
  --print-to-pdf="$OUT" "file://$HTML" >/dev/null 2>&1

[ -f "$OUT" ] || { echo "PDF render failed (chrome: $CHROME)" >&2; exit 1; }
echo "PDF $OUT ($(wc -c < "$OUT") bytes)"
