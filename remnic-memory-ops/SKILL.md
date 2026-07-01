---
name: remnic-memory-ops
description: Operate and troubleshoot the Remnic memory daemon (the memory provider for pi/OpenClaw on this machine). Use when memory recall is empty, memories aren't being captured, or you need to check whether Remnic is healthy. Covers the silent-rot failure mode, the health guard, how to read the logs, and the config/credential layout.
---

# remnic-memory-ops

Remnic is the memory provider on this machine. It runs as a **systemd user
service** (`remnic.service`) on `127.0.0.1:4318`, integrated into pi via the
`~/.pi/agent/extensions/remnic/` extension (recall + observe + MCP tools).

## ⚠️ The #1 gotcha: Remnic fails SILENTLY

Recall, MCP tools, and explicit `memory_store` all keep working **even when
auto-capture (extraction) is 100% dead.** Extraction distils observed turns into
memories via an LLM (OpenAI by default); if that key is revoked/invalid it 401s
in the background forever with no surfaced error. Real incident: a revoked
`sk-proj-…` key 401'd **2688 times / 0 successes** while everything *looked* fine.

**Never trust "it recalls, so it works."** The only ground truth for capture is:
- the daemon log (`~/.remnic/logs/daemon.log`), and
- whether the stored-memory count is actually growing.

## First move when memory seems broken

```bash
~/.remnic/bin/remnic-health.sh          # the guard — checks daemon, key, failures, growth
remnic doctor                            # official diagnostic (run from the project dir)
tail -40 ~/.remnic/logs/daemon.log       # look for: 401 / "extraction reported failure"
```

Healthy extraction looks like: `remnic: persisted: N facts, M entities, …`.
Broken looks like: `401 Incorrect API key` → `falling back to gateway default AI`
→ `extraction reported failure with no durable outputs`.

## The health guard (silent-rot alarm)

`~/.remnic/bin/remnic-health.sh`, run hourly by `remnic-health.timer`:
- **CRITICAL** (exit 2): extraction key rejected by OpenAI (live 401), daemon
  down / not listening on :4318, or config unreadable.
- **WARN** (exit 1): extraction-failure count in the daemon log grew since last run.
- **OK** (exit 0): daemon up, key valid, no new failures.

Alerts append to `~/.remnic/logs/health.log` and best-effort `notify-send`.
State (baseline counts) lives in `~/.remnic/state/health.json`. Manage it with:

```bash
systemctl --user status remnic-health.timer
systemctl --user start remnic-health.service   # run the check now
cat ~/.remnic/logs/health.log                  # past alerts
```

## Config & credential layout (who reads what)

- **Daemon config (authoritative):** `~/.config/remnic/config.json`, pointed to
  by `REMNIC_CONFIG_PATH` in the systemd unit. Holds `remnic.openaiApiKey`
  (extraction), `remnic.memoryDir`, and `server.authToken`. **Owner-only (600).**
- **CRITICAL nuance:** systemd user services do **not** source `~/.zshrc` /
  `~/.zsh_secrets`. So fixing the shell `OPENAI_API_KEY` does **not** fix the
  daemon — you must update the daemon config (or add an `EnvironmentFile` to the
  unit). Keep both in sync; the daemon config is what actually runs.
- **pi extension config:** `~/.pi/agent/extensions/remnic/remnic.config.json`
  (daemon URL, namespace `default`, connector auth token).
- **Verify a key before trusting it:**
  `curl -s -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"`
  → `200` valid, `401` revoked/invalid (note: `insufficient_quota` ≠ `401`;
  a 401 "Incorrect API key" means the key is *unrecognized*, not a billing issue).

## Fixing a dead extraction key

1. Get a valid key (test it with the curl above first).
2. Update `~/.config/remnic/config.json` → `remnic.openaiApiKey`; keep perms 600.
3. `systemctl --user restart remnic.service`
4. **Verify capture, not just "no error":** feed a turn (pi `observe`, or use the
   MCP `observe` tool) and confirm `remnic: persisted: …` in the log + new files
   under `<memoryDir>/facts/<date>/`.
5. Sync the shell copy in `~/.zsh_secrets` so env-based tools match.

## Secret-hygiene note

pi's bash-tool scratch logs (`/tmp/pi-bash-*.log`) can capture secrets printed in
command output (API keys, tokens). Treat them as sensitive; scrub or rotate if a
live key ever landed there.
