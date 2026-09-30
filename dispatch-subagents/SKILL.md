---
name: dispatch-subagents
description: Launch concurrent pi sub-agents across multiple models (e.g. for parallel code review, red-teaming, or cross-model verification) and collect their results. Use when you want several models to work a task in parallel and survive across tool-call boundaries. Primary mechanism is the in-harness `subagent` tool (pi-subagents plugin); a detached-CLI fallback remains for headless/non-pi-session dispatch. Covers model discovery, foreground vs background execution, cost/model attribution, and the legacy setsid gotcha.
---

# dispatch-subagents

Run N models concurrently against the same task. Two mechanisms, pick one:

| | In-harness (`subagent` tool) | Detached CLI (`dispatch.sh`) |
|---|---|---|
| Use when | You're already inside a pi session (the normal case) | Headless/non-pi-session context: cron, CI, a plain shell script with no pi turn to call a tool from |
| Model per task | `tasks: [{ agent, task, model }, ...]` in one call | One `pi --model provider/id --print` process per model |
| Survives tool-call boundary | Yes — pi-subagents' own async runner, not a bash child process | Only via `setsid … </dev/null &` (see Gotcha below) |
| Bad model id | **Fails loudly, synchronously**, in the tool result — verified: `Error: Model "totally-fake-vendor/nonexistent-model-9999" not found.` | Historically silent — 0-byte log, process just exits (verify with a PONG smoke test first) |
| Blocking | Foreground by default; pass `async: true` + call `wait` to go non-blocking | You choose: block on `wait`, or poll with `monitor.sh` |
| Cost/model attribution | Structured, per child, in the tool result (`usage`, `model`, `attemptedModels`) | Not built in — grep provider logs / vendor dashboards yourself |
| Transcripts | `transcriptPath` per child + `status.json`/`events.jsonl` for async runs | Wherever you point `--session-dir`/`--out` |

**Default to the in-harness path.** Reach for the detached-CLI fallback only when there's no pi session to call a tool from, or for a model/provider pi-subagents can't resolve.

This skill covers dispatch mechanics only. Consolidating N results into ranked,
deduplicated findings and posting them is the `adversarial-review` skill's job
(built on top of whichever mechanism you use here) — that workflow is
unchanged by which dispatch path you pick.

## Primary: the `subagent` tool (in-harness)

Requires the `pi-subagents` npm package installed (`pi install npm:pi-subagents`).

### Dispatch N models in one call

```ts
subagent({
  tasks: [
    { agent: "reviewer", task: "<shared task text>", model: "zai-coding-cn/glm-5.2" },
    { agent: "reviewer", task: "<shared task text>", model: "deepseek/deepseek-v4-pro" },
    { agent: "reviewer", task: "<shared task text>", model: "moonshotai/kimi-k2.7-code" },
  ],
})
```

One tool call, one shared task string per model — no per-model agent files, no
`REVIEWER_TAG` templating needed for the model identity part (an agent's
system prompt can still use it for self-identification in output if you want
that). `model` accepts the same `provider/id[:thinking]` shorthand as `--model`
on the CLI, fuzzy-matched against the registry (dots/case/separator variants
all resolve; verified working today for the three ids above).

### Verify a model id before a big dispatch — but the failure mode is now safe

Unlike the CLI path, calling `subagent` with a nonexistent model does **not**
silently no-op. It returns immediately with an explicit error in the tool
result:

```
Error: Model "totally-fake-vendor/nonexistent-model-9999" not found. Use --list-models to see available models.
```

So a typo'd model in one task of a parallel dispatch fails that one task
loudly instead of producing a mystery empty result. Auth/quota failures during
actual execution (e.g. GLM's 5-hour quota) are a different failure class —
they happen mid-run, not at resolution time, and show up via that task's
`exitCode`/`attemptedModels`/`modelAttempts` in the result rather than a
pre-flight check. A cheap smoke test before a big/expensive dispatch is still
good hygiene for catching a dead key, just less load-bearing than it was for
the CLI path.

### Foreground vs background

Default is foreground — the tool call blocks until every task in `tasks`
finishes. For a long panel (multiple `thinking: high` models), prefer:

```ts
subagent({ tasks: [...], async: true })
// then, if there's nothing else useful to do right now:
wait({ all: true })
```

`wait` blocks deliberately (not polling) and returns as soon as the group
finishes or needs attention. If you don't call `wait` and the turn just ends
in an interactive session, you get a completion notification on your next
turn instead — no `monitor.sh`-style log tailing required either way.

Caveat verified today: in a **headless one-shot** invocation (`pi -p`, no
subsequent turn), that completion notification has nowhere to land — you'll
see `"...intercom delivery was not acknowledged..."` in stderr. Harmless if
you already called `wait` in the same turn (the result is already in hand);
avoid `async: true` without an explicit `wait` in a single-shot script context.

### Reading results: model + cost attribution, no log-grepping

Each task's result carries real per-child attribution directly:

```json
{
  "agent": "reviewer",
  "model": "moonshotai/kimi-k2.7-code:high",
  "usage": { "input": 17733, "output": 2979, "cacheRead": 26368, "cost": 0.03377227, "turns": 5 },
  "transcriptPath": "<repo>/.pi-subagents/artifacts/<runId>_reviewer_N_transcript.jsonl"
}
```

Note: a subscription-tier provider (e.g. `zai-coding-cn`) can legitimately
report `"cost": 0` — that's flat-rate billing, not a missing field.

For async runs, the same fields live in `status.json` per step, plus
`recentTools` (a tool-name timeline per child) and `events.jsonl` for full
lifecycle events.

### Gotchas (in-harness path)

- [ ] Long panels: use `async: true` + `wait`, don't hold one blocking tool
      call open for 10+ minutes.
- [ ] Headless `-p` scripts: don't rely on the completion-notification channel
      — call `wait` explicitly before the process exits.
- [ ] `.pi-subagents/artifacts/` gets written under the run's cwd — it'll show
      up as untracked cruft in `git status` if that cwd is a repo; clean it up
      or gitignore it.
- [ ] `model` is still a string match against the registry — a genuine typo
      fails loudly per-task now, but a *plausible-looking wrong* model (e.g.
      right vendor, wrong id) still silently succeeds against the wrong model.
      Cross-check `model` in the result against what you asked for.

## Models enabled on this machine (verified 2026-07-08; re-check with list-models.sh)

`list-models.sh` asks `pi --list-models`, which counts credentials from auth.json,
provider environment variables (e.g. `ZAI_API_KEY`) and the AWS chain for Bedrock.
Do not judge availability from auth.json alone: providers set by environment
never appear there, which is how zai seats were once skipped as "absent".
Run it in the environment the dispatch will use, since env credentials are per process.

Same provider/id strings work for both dispatch paths.

| Provider (`--provider` / task `model` prefix) | Model | Notes |
|---|---|---|
| `anthropic` | `claude-fable-5` | configured default (oauth); also `claude-opus-4-8`, `claude-sonnet-5` |
| `amazon-bedrock` | `global.anthropic.claude-opus-4-8` | note `global.` prefix (the old `eu.` profile id is gone); also `global.anthropic.claude-sonnet-5` |
| `openai-codex` | `gpt-5.5` | oauth |
| `zai-coding-cn` | `glm-5.2` | **5-hour usage quota** — emits a Chinese `429 已达到…使用上限` and produces no review when exhausted; reports `cost: 0` (subscription, not metered) even on success |
| `deepseek` | `deepseek-v4-pro` | also `deepseek-v4-flash` — good cheap default for orchestration/scouting |
| `moonshotai` | `kimi-k2.7-code` | **fixed 2026-07-06**: key rotated at platform.kimi.ai, now reads `MOONSHOT_API_KEY`. The old hand-rolled `kimi-ai` custom provider (in `~/.pi/agent/models.json`) is deleted — it shadowed the built-in `moonshotai` provider and used the wrong env var name (`KIMI_API_KEY` is reserved by pi for the *different* "Kimi For Coding" plan, provider id `kimi-coding`, api.kimi.com/coding — not the platform.kimi.ai general console) |

Removed since last verification: `openai` (api_key entry deleted from
auth.json — `gpt-5-codex`/`gpt-5.5-pro` unusable). A key can die BETWEEN runs
on the same day. For the in-harness path a bad/dead model now fails loudly per
task (see above); a cheap PONG smoke test is still worth it to catch an
auth/quota problem before a big dispatch, on either path.

```bash
./scripts/list-models.sh                 # providers pi can run + whether each enabledModel runs
./scripts/list-models.sh --grep opus     # runnable ids matching a pattern
./scripts/list-models.sh --check anthropic/claude-opus-5:high zai/glm-5.3   # ok / cannot run; exit 1 if any cannot
pi --provider deepseek --model deepseek-v4-pro --print --no-session "Reply PONG"
```

## Fallback: detached CLI (no pi session — cron, CI, plain shell scripts)

Use this only when there's no pi session/tool call available to dispatch from,
or for a provider/model pi-subagents can't resolve.

### The one gotcha that matters most

The harness kills a tool-call's **process group** when the call returns. So
`pi ... &`, `nohup pi ... &`, and even `nohup ... & disown` all die between
tool calls — you'll see processes vanish and **0-byte logs**. The only form
that survives is starting a **new session**:

```bash
setsid bash -c 'pi ... > log 2>&1' </dev/null &
```

`scripts/dispatch.sh` does exactly this. Always launch through it (or
replicate the `setsid … </dev/null &` form).

### Dispatch one specific vendor model

```bash
pi --provider amazon-bedrock --model global.anthropic.claude-opus-4-8 --print --no-session "…"
# shorthand, equivalent:
pi --model amazon-bedrock/global.anthropic.claude-opus-4-8 --print --no-session "…"
pi --model amazon-bedrock/global.anthropic.claude-opus-4-8:high --print --no-session "…"
```

`dispatch.sh` takes specs in the `provider/model` form and splits on the
**first `/`** into `--provider`/`--model` (model ids contain dots, never
slashes, so the split is unambiguous).

### Step 1 — verify the models exist (cheap; avoids silent failures)

Dispatching against a hallucinated model id on this path just exits 0-bytes —
unlike the in-harness path, there is no loud pre-flight error here. Confirm
first with `list-models.sh` (see table above) and a PONG smoke test.

### Step 2 — write the prompt

One prompt file, shared by all agents. If it contains the literal token
`REVIEWER_TAG`, `dispatch.sh` gives each agent its own copy with the token
replaced by `"<model> agent:"` so its output (and any GitHub comments it
posts) self-identifies. Make the prompt self-contained: repo path, exact
commit SHA, what to read, how to verify (build/test commands), and the exact
output format.

### Step 3 — dispatch

```bash
./scripts/dispatch.sh --prompt /tmp/review.txt --out /tmp/run1 --thinking high \
  --model amazon-bedrock/global.anthropic.claude-opus-4-8 \
  --model moonshotai/kimi-k2.7-code \
  --model zai-coding-cn/glm-5.2 \
  --model deepseek/deepseek-v4-pro
```

### Step 4 — monitor (poll between tool calls)

```bash
./scripts/monitor.sh /tmp/run1            # alive/exited + log sizes + tails
```

- **`--print` buffers**: logs stay 0 bytes until an agent finishes. 0 bytes is
  NOT failure while the process is alive.
- A live agent spawns tool subprocesses (tsserver, language servers) — seeing
  those is a positive "actively working" signal.
- Agents finish at very different speeds (DeepSeek/GLM can run many minutes
  longer than Opus/Kimi). Poll with backoff; don't assume a slow one is stuck.

### Gotchas checklist (detached-CLI path)

- [ ] Used `setsid … </dev/null &` (via dispatch.sh), not `nohup`/bare `&`.
- [ ] Verified each `provider/model` with `list-models.sh` first.
- [ ] Prompt embeds the **exact commit SHA** and concrete verify steps.
- [ ] Treated 0-byte logs as "still running", not "failed".
- [ ] Accounted for per-provider rate limits (GLM 5-hour quota).
- [ ] If agents post to GitHub, see the `gh-pr-review-comments` skill for the
      secondary-rate-limit ("abuse") spacing gotcha.

## After dispatch: consolidation and posting

Not this skill's job on either path — see the `adversarial-review` skill for
consolidating N models' findings into ranked, deduplicated results, and
`gh-pr-review-comments` for posting them as one atomic inline PR review.
