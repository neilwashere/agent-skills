---
name: dispatch-subagents
description: Launch concurrent, detached pi sub-agents across multiple models (e.g. for parallel code review, red-teaming, or cross-model verification) and collect their results. Use when you want several models to work a task in parallel and survive across tool-call boundaries. Covers model discovery, the setsid detachment gotcha, --print buffering, monitoring, and rate limits.
---

# dispatch-subagents

Run N pi agents concurrently across different models, detached so they survive
the agent harness's per-tool-call process-group reaping. Built from a real
session that dispatched 4 reviewers (Bedrock Opus, Kimi, GLM, DeepSeek) at once.

## The one gotcha that matters most

The harness kills a tool-call's **process group** when the call returns. So
`pi ... &`, `nohup pi ... &`, and even `nohup ... & disown` all die between
tool calls — you'll see processes vanish and **0-byte logs**. The only form
that survives is starting a **new session**:

```bash
setsid bash -c 'pi ... > log 2>&1' </dev/null &
```

`scripts/dispatch.sh` does exactly this. Always launch through it (or replicate
the `setsid … </dev/null &` form).

## Dispatch one specific vendor model

The canonical way to target a specific vendor model in the pi harness is the
`--provider` + `--model` pair:

```bash
pi --provider amazon-bedrock --model eu.anthropic.claude-opus-4-8 --print --no-session "…"
```

pi also accepts a **shorthand** on `--model` alone: `provider/id` with an optional
`:<thinking>` suffix (per `pi --help`). These are equivalent to the above:

```bash
pi --model amazon-bedrock/eu.anthropic.claude-opus-4-8 --print --no-session "…"
pi --model amazon-bedrock/eu.anthropic.claude-opus-4-8:high --print --no-session "…"
```

Useful flags: `--print` (non-interactive, exit after answer), `--no-session`
(don't persist), `--thinking off|minimal|low|medium|high|xhigh`. `dispatch.sh`
takes specs in the `provider/model` form and splits on the **first `/`** into
`--provider`/`--model` (model ids contain dots, never slashes, so the split is
unambiguous).

## Step 1 — verify the models exist (cheap; avoids silent failures)

Dispatching against a hallucinated model id just exits 0-bytes. Confirm first:

```bash
./scripts/list-models.sh                 # providers w/ creds, default, custom catalog
./scripts/list-models.sh --grep opus     # grep the builtin pi-ai catalog for a model
```

Model ids come from four places (authority order): `~/.pi/agent/auth.json`
(which providers have creds), `~/.pi/agent/settings.json` (default),
`~/.pi/agent/models.json` (custom catalog), and the pi-ai builtin catalog at
`node_modules/@earendil-works/pi-ai/dist/providers/<provider>.models.js`.
Built-in provider models (bedrock/zai/deepseek) are NOT in models.json.

Optionally smoke-test one model before a big run:

```bash
pi --provider deepseek --model deepseek-v4-pro --print --no-session "Reply PONG"
```

### Models enabled on this machine (verified 2026-06-28; re-check with list-models.sh)

| Provider (`--provider`) | Model (`--model`) | Notes |
|---|---|---|
| `amazon-bedrock` | `eu.anthropic.claude-opus-4-8` | configured default; region-prefixed inference profile |
| `kimi-ai` | `kimi-k2.7-code` | also `-highspeed`, `kimi-k2.6`, `kimi-k2.5` (models.json) |
| `zai-coding-cn` | `glm-5.2` | **5-hour usage quota** — emits a Chinese `429 已达到…使用上限` and produces no review when exhausted |
| `deepseek` | `deepseek-v4-pro` | also `deepseek-v4-flash` |

Other providers with creds: `kimi-coding`, `openai-codex`.

## Step 2 — write the prompt

One prompt file, shared by all agents. If it contains the literal token
`REVIEWER_TAG`, `dispatch.sh` gives each agent its own copy with the token
replaced by `"<model> agent:"` so its output (and any GitHub comments it posts)
self-identifies. Make the prompt self-contained: repo path, exact commit SHA,
what to read, how to verify (build/test commands), and the exact output format.

## Step 3 — dispatch

```bash
./scripts/dispatch.sh --prompt /tmp/review.txt --out /tmp/run1 --thinking high \
  --model amazon-bedrock/eu.anthropic.claude-opus-4-8 \
  --model kimi-ai/kimi-k2.7-code \
  --model zai-coding-cn/glm-5.2 \
  --model deepseek/deepseek-v4-pro
```

## Step 4 — monitor (poll between tool calls)

```bash
./scripts/monitor.sh /tmp/run1            # alive/exited + log sizes + tails
```

- **`--print` buffers**: logs stay 0 bytes until an agent finishes. 0 bytes is
  NOT failure while the process is alive.
- A live agent spawns tool subprocesses (tsserver, language servers) — seeing
  those is a positive "actively working" signal.
- Agents finish at very different speeds (DeepSeek/GLM can run many minutes
  longer than Opus/Kimi). Poll with backoff; don't assume a slow one is stuck.

## Gotchas checklist

- [ ] Used `setsid … </dev/null &` (via dispatch.sh), not `nohup`/bare `&`.
- [ ] Verified each `provider/model` with `list-models.sh` first.
- [ ] Prompt embeds the **exact commit SHA** and concrete verify steps.
- [ ] Treated 0-byte logs as "still running", not "failed".
- [ ] Accounted for per-provider rate limits (GLM 5-hour quota).
- [ ] If agents post to GitHub, see the `gh-pr-review` skill for the
      secondary-rate-limit ("abuse") spacing gotcha.
