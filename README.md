# Global agent skills

Cross-harness, machine-global skills (auto-discovered by pi from `~/.agents/skills/`).
Workflow tooling that is not tied to any single project.

- **dispatch-subagents** — launch concurrent, detached pi sub-agents across models
  (parallel review / red-team / cross-model verification). Key gotcha: only
  `setsid … </dev/null &` survives the tool-call process-group reap.
- **gh-pr-review-comments** — read/reply/post inline GitHub PR review comments at
  scale; secondary-rate-limit ("abuse") spacing, pagination cap, commit-vs-working-tree
  verification.

Origin: extracted from the Loom M0 workflow (threadsafe/loom) on 2026-06-28.
