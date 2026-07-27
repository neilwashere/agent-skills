#!/usr/bin/env bash
# Reapplies the pi-subagents async-visibility patch to herdr's generated
# ~/.pi/agent/extensions/herdr-agent-state.ts after `herdr integration install pi`
# (or an auto-update) overwrites it. Idempotent: safe to rerun; no-ops if the
# patch is already present or if the file's anchor text has drifted (in which
# case it prints a warning instead of guessing).
#
# Why this exists: herdr's built-in pi hook only reports the root session's
# own agent_start/agent_settled turn state. nicobailon/pi-subagents runs async
# subagents as detached OS processes that never touch those hooks, so herdr
# shows "idle" while a background subagent is still working. This patch makes
# the same herdr:pi hook also track outstanding subagent:async-started /
# subagent:async-complete run ids and folds them into its working/idle state.

set -euo pipefail

TARGET="${HOME}/.pi/agent/extensions/herdr-agent-state.ts"
MARKER="custom patch: pi-subagents async visibility"

if [ ! -f "$TARGET" ]; then
  echo "herdr-pi-subagents-patch: $TARGET not found. Run 'herdr integration install pi' first." >&2
  exit 1
fi

if grep -q "$MARKER" "$TARGET"; then
  echo "herdr-pi-subagents-patch: already applied, nothing to do."
  exit 0
fi

STATE_ANCHOR='  let rootSession = false;'
DESIRED_ANCHOR='    return { state: "idle" as const, message: undefined };
  }'
LISTENER_ANCHOR='  pi.on("session_start", async (event, ctx) => {'

for anchor_name in STATE_ANCHOR DESIRED_ANCHOR LISTENER_ANCHOR; do
  anchor_value="${!anchor_name}"
  if ! grep -qF "$anchor_value" "$TARGET"; then
    echo "herdr-pi-subagents-patch: anchor '$anchor_name' not found in $TARGET." >&2
    echo "herdr's integration file has drifted from what this patch expects (likely a version bump)." >&2
    echo "Re-diff manually against the patch block in this script before editing further." >&2
    exit 1
  fi
done

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

python3 - "$TARGET" "$TMP" <<'PYEOF'
import sys

target, tmp = sys.argv[1], sys.argv[2]
with open(target, "r") as f:
    src = f.read()

state_anchor = '  let rootSession = false;\n'
state_patch = state_anchor + '''
  // --- BEGIN custom patch: pi-subagents async visibility (local, not from herdr) ---
  // herdr's built-in agent_start/agent_settled hooks only see the root session's
  // own turn. nicobailon/pi-subagents runs async subagents as detached OS
  // processes, which never touch those hooks, so the root pane looks idle while
  // a background subagent is still working. This tracks outstanding async run
  // ids from pi-subagents' own pi.events and folds them into the same working
  // state this file already reports under source "herdr:pi". Reapply after any
  // `herdr integration install pi` update via herdr-pi-subagents-patch.sh beside
  // this file.
  const subagentRunIds = new Set<string>();
  // --- END custom patch ---
'''
assert src.count(state_anchor) == 1, "state anchor not unique"
src = src.replace(state_anchor, state_patch, 1)

desired_anchor = '    return { state: "idle" as const, message: undefined };\n  }'
desired_patch = '''    // --- BEGIN custom patch: pi-subagents async visibility ---
    if (subagentRunIds.size > 0) {
      const n = subagentRunIds.size;
      return { state: "working" as const, message: `${n} background subagent${n === 1 ? "" : "s"} running` };
    }
    // --- END custom patch ---
''' + desired_anchor
assert src.count(desired_anchor) == 1, "desiredState anchor not unique"
src = src.replace(desired_anchor, desired_patch, 1)

listener_anchor = '  pi.on("session_start", async (event, ctx) => {'
listener_patch = '''  // --- BEGIN custom patch: pi-subagents async visibility ---
  pi.events.on("subagent:async-started", (data: any) => {
    if (!rootSession) {
      return;
    }
    const id = data?.id;
    if (typeof id === "string" && id) {
      subagentRunIds.add(id);
    }
    publishState();
  });

  pi.events.on("subagent:async-complete", (data: any) => {
    if (!rootSession) {
      return;
    }
    const id = data?.id;
    if (typeof id === "string" && id) {
      subagentRunIds.delete(id);
    }
    publishState();
  });
  // --- END custom patch ---

''' + listener_anchor
assert src.count(listener_anchor) == 1, "listener anchor not unique"
src = src.replace(listener_anchor, listener_patch, 1)

with open(tmp, "w") as f:
    f.write(src)
PYEOF

mv "$TMP" "$TARGET"
trap - EXIT
node --experimental-strip-types --check "$TARGET"
echo "herdr-pi-subagents-patch: applied and syntax-checked $TARGET"
