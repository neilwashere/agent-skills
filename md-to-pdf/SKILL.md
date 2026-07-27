---
name: md-to-pdf
description: Render a Markdown file to a clean, styled A4 PDF fully offline (no pandoc/weasyprint/wkhtmltopdf). Use for CVs, cover letters, pitch one-pagers, panel/Q&A answers, briefs, or any prose Markdown that needs a shareable PDF. Layout-only — never rewrites prose, so it adds no em-dashes or other "tells".
compatibility: Requires bash, node, and a cached Chromium/Chrome (Playwright or Puppeteer cache, or a system browser). Linux/macOS.
---

# md-to-pdf

Convert a Markdown file into a clean A4 PDF, fully offline. A small Markdown
subset is turned into styled HTML and printed to PDF via a cached headless
Chrome/Chromium. The renderer **only lays prose out — it never rewrites the
text**, so it introduces no em-dashes or other machine "tells".

## Usage

Paths are relative to this skill's directory; run the script from there (or
prefix it with the skill's absolute path).

```bash
./md-to-pdf.sh <input.md> [output.pdf]
```

- `<input.md>` — required; the Markdown source.
- `[output.pdf]` — optional; defaults to `<input>.pdf` next to the source.

Examples:

```bash
# Default output path (same name, .pdf extension)
./md-to-pdf.sh projects/panel/panel-final.md

# Explicit, human-friendly output name (quote paths with spaces)
./md-to-pdf.sh cv.md "Neil Chambers - CV.pdf"
```

On success it prints `PDF <path> (<bytes> bytes)` to stdout.

## Supported Markdown subset

- `# h1` (with the line right after treated as a blue subtitle, and the next as
  a muted contact line — tuned for CV/one-pager headers)
- `## h2` (uppercase section rule), `### h3`
- `**bold**` / `__bold__`, `*italic*` / `_italic_`, `` `code` ``
- `> blockquotes`, `- bullet lists`
- `[text](url)` links and `<email>` autolinks
- `---` dividers (styled via spacing, not drawn)

## How it works

1. A Node one-liner converts the Markdown subset to styled HTML (A4, Helvetica,
   LinkedIn-blue accents).
2. It discovers a cached Chromium/Chrome — newest of: Playwright cache
   (`~/.cache/ms-playwright`), Puppeteer cache (`~/.cache/puppeteer`), or a
   system `chromium`/`chromium-browser`/`google-chrome` on `PATH`.
3. Chrome headless prints the HTML to PDF (`--print-to-pdf`, no header/footer).

No network, no pandoc/LaTeX. If you have run Playwright/Puppeteer before (e.g.
via a browser tool), a suitable Chromium is already cached.

## Requirements

- `bash`, `node`
- A cached Chromium/Chrome. If none is found, the script exits with
  `no cached Chrome/Chromium found`. Fix by installing a system browser or
  priming the Playwright cache (`npx playwright install chromium`).

## Notes

- Quote output paths that contain spaces.
- For richer Markdown (tables, images, nested lists) this minimal renderer is
  intentionally limited — extend the HTML/CSS in `md-to-pdf.sh` if needed.
