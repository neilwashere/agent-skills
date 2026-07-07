---
ia: v0-experimental
kind: build
feature: widget
upstream: docs/specs/2026-01-02-widget.md
links:
  - [T1, implements, S1]
  - [T2, implements, S2]
  - [D1, covered-by, T1]
  - [D2, covered-by, S2]
---

# Build plan: widget

## T1: implement the cache

Checks: bench script green.

## T2: implement signature verification

Checks: node --test green.
