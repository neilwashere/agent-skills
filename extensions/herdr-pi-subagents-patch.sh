#!/usr/bin/env bash
# Adds the counted herdr:busy overlay to Herdr's generated Pi integration.
# Herdr owns the root turn lifecycle; sibling integrations use this overlay for
# work that remains active outside that turn, including restored async runs.

set -euo pipefail

TARGET="${HOME}/.pi/agent/extensions/herdr-agent-state.ts"
MARKER="BEGIN herdr:busy overlay"
LEGACY_MARKER="custom patch: pi-subagents async visibility"

if [ ! -f "$TARGET" ]; then
	echo "herdr-pi-subagents-patch: $TARGET not found. Run 'herdr integration install pi' first." >&2
	exit 1
fi

if grep -q "$MARKER" "$TARGET"; then
	echo "herdr-pi-subagents-patch: already applied, nothing to do."
	exit 0
fi

if grep -q "$LEGACY_MARKER" "$TARGET"; then
	echo "herdr-pi-subagents-patch: legacy async-event patch found in $TARGET." >&2
	echo "Regenerate it with 'herdr integration install pi', then rerun this script." >&2
	exit 1
fi

HELPER_ANCHOR='export default function (pi) {'
STATE_ANCHOR='  let rootSession = false;'
DESIRED_ANCHOR='    return { state: "idle" as const, message: undefined };
  }'
LISTENER_ANCHOR='  pi.on("session_start", async (event, ctx) => {'

for anchor_value in "$HELPER_ANCHOR" "$STATE_ANCHOR" "$DESIRED_ANCHOR" "$LISTENER_ANCHOR"; do
	if ! grep -qF "$anchor_value" "$TARGET"; then
		echo "herdr-pi-subagents-patch: a required anchor was not found in $TARGET." >&2
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

helper_anchor = 'export default function (pi) {'
helper_patch = '''// --- BEGIN herdr:busy overlay ---
type BusyOverlay = {
  count: number;
  message?: string;
};

function updateBusyOverlay(overlay: BusyOverlay, data: unknown): void {
  const event =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : undefined;
  if (event?.active === true) {
    overlay.count += 1;
    overlay.message = typeof event.label === "string" ? event.label : undefined;
    return;
  }

  overlay.count = Math.max(0, overlay.count - 1);
  if (overlay.count === 0) {
    overlay.message = undefined;
  }
}
// --- END herdr:busy overlay ---

''' + helper_anchor
assert src.count(helper_anchor) == 1, "helper anchor not unique"
src = src.replace(helper_anchor, helper_patch, 1)

state_anchor = '  let rootSession = false;\n'
state_patch = state_anchor + '''
  // --- BEGIN herdr:busy overlay ---
  // Sibling integrations raise a counted overlay while work continues outside
  // the root Pi turn, and lower it before changing the displayed label.
  const busyOverlay: BusyOverlay = { count: 0 };
  // --- END herdr:busy overlay ---
'''
assert src.count(state_anchor) == 1, "state anchor not unique"
src = src.replace(state_anchor, state_patch, 1)

desired_anchor = '    return { state: "idle" as const, message: undefined };\n  }'
desired_patch = '''    // --- BEGIN herdr:busy overlay ---
    if (busyOverlay.count > 0) {
      return { state: "working" as const, message: busyOverlay.message };
    }
    // --- END herdr:busy overlay ---
''' + desired_anchor
assert src.count(desired_anchor) == 1, "desiredState anchor not unique"
src = src.replace(desired_anchor, desired_patch, 1)

listener_anchor = '  pi.on("session_start", async (event, ctx) => {'
listener_patch = '''  // --- BEGIN herdr:busy overlay ---
  pi.events.on("herdr:busy", (data: unknown) => {
    if (!rootSession) {
      return;
    }
    updateBusyOverlay(busyOverlay, data);
    publishState();
  });
  // --- END herdr:busy overlay ---

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
