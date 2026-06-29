#!/usr/bin/env bash
# list-models.sh — discover which pi providers/models are actually available
# on THIS machine before dispatching sub-agents. Saves you from dispatching
# jobs against a hallucinated model id that silently exits.
#
# Usage: ./list-models.sh [--grep PATTERN]
#
# Sources (in order of authority):
#   1. ~/.pi/agent/auth.json      → which providers have credentials
#   2. ~/.pi/agent/settings.json  → the configured default provider/model
#   3. ~/.pi/agent/models.json    → custom/override model catalog (per provider)
#   4. pi-ai builtin catalog       → node_modules/@earendil-works/pi-ai/dist/providers/<provider>.models.js
#
# Built-in provider models (bedrock, zai, deepseek, ...) are NOT in models.json;
# they live in the pi-ai package catalog. This script greps both.
set -uo pipefail

GREP_PAT="${2:-}"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

echo "=== providers with credentials (auth.json) ==="
python3 - "$AGENT_DIR/auth.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    for k, v in d.items():
        print(f"  {k:18} ({v.get('type','?')})")
except FileNotFoundError:
    print("  (no auth.json)")
PY

echo "=== configured default (settings.json) ==="
python3 - "$AGENT_DIR/settings.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(f"  {d.get('defaultProvider','?')} / {d.get('defaultModel','?')}  (thinking: {d.get('defaultThinkingLevel','?')})")
except FileNotFoundError:
    print("  (no settings.json)")
PY

echo "=== custom model catalog (models.json) ==="
python3 - "$AGENT_DIR/models.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    provs = d.get("providers", d)
    for pname, pdata in provs.items():
        models = pdata.get("models", pdata) if isinstance(pdata, dict) else pdata
        ids = [m.get("id") if isinstance(m, dict) else m for m in models] if isinstance(models, list) else list(models.keys())
        print(f"  {pname}: {', '.join(ids)}")
except FileNotFoundError:
    print("  (no models.json)")
PY

echo "=== builtin pi-ai catalog (grep) ==="
# Resolve the pi-ai providers dir from the nearest node_modules, else the global install.
PIAI=""
for d in "./node_modules/@earendil-works/pi-ai/dist/providers" \
	"$HOME/.nvm/versions/node/"*/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers; do
	[ -d "$d" ] && PIAI="$d" && break
done
if [ -z "$PIAI" ]; then
	echo "  (pi-ai catalog not found; run from a project with pi-ai installed)"
else
	echo "  catalog: $PIAI"
	if [ -n "$GREP_PAT" ]; then
		grep -rhoE "\"[a-z0-9][a-z0-9._-]+\"" "$PIAI"/*.models.js 2>/dev/null |
			tr -d '"' | sort -u | grep -iE "$GREP_PAT" | sed 's/^/    /'
	else
		echo "  (pass a model substring as 2nd arg to grep the catalog, e.g. --grep opus)"
	fi
fi
