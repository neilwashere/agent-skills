#!/usr/bin/env bash
# list-models.sh — which provider/model ids pi can actually run on THIS machine,
# asked of pi itself, before dispatching sub-agents against them.
#
# Usage:
#   list-models.sh                         providers pi can run, with counts, plus the
#                                          enabledModels from settings.json and whether each runs
#   list-models.sh --grep PATTERN          runnable ids matching PATTERN (extended regex, case-insensitive)
#   list-models.sh --all                   every runnable id
#   list-models.sh --check ID [ID ...]     "ok" or "cannot run" per provider/model id; a ":thinking"
#                                          suffix is ignored. Exits 1 if any id cannot run.
#
# The source of truth is `pi --list-models`, which lists a model only when its
# provider has credentials pi can resolve: auth.json entries, provider
# environment variables (ZAI_API_KEY, MOONSHOT_API_KEY, ...), the AWS profile or
# credentials chain for amazon-bedrock, and models.json. Reading auth.json alone
# misses every provider configured by environment, which is how zai and Bedrock
# seats used to be wrongly reported as absent.
#
# "Can run" means credentials are configured, not that they work right now:
# an expired key, an exhausted quota or a lapsed SSO session still only shows
# up at dispatch. A one-line PONG smoke test catches those:
#   pi -p --no-tools --no-session --model <provider/model> "Reply PONG"
#
# Credentials come from the calling environment, so run this in the same
# environment the dispatch will run in (e.g. a pane shell that sources your secrets).
set -uo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-${PI_AGENT_DIR:-$HOME/.pi/agent}}"
mode=summary
pattern=""
ids=()
case "${1:-}" in
  "") ;;
  --grep) mode=grep; pattern="${2:-}"; [ -n "$pattern" ] || { echo "usage: $0 --grep PATTERN" >&2; exit 2; } ;;
  --all) mode=all ;;
  --check) mode=check; shift; ids=("$@"); [ "${#ids[@]}" -gt 0 ] || { echo "usage: $0 --check provider/model [...]" >&2; exit 2; } ;;
  -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
esac

command -v pi >/dev/null 2>&1 || { echo "pi is not on PATH" >&2; exit 2; }
if ! table=$(pi --list-models 2>/dev/null); then
  echo "pi --list-models failed" >&2
  exit 2
fi
# provider/model, one per line
runnable=$(printf '%s\n' "$table" | awk 'NR > 1 && NF >= 2 { print $1 "/" $2 }' | sort -u)
[ -n "$runnable" ] || { echo "pi lists no runnable models: no provider has credentials in this environment" >&2; exit 2; }

can_run() { printf '%s\n' "$runnable" | grep -qxF "${1%%:*}"; }

case "$mode" in
  all)
    printf '%s\n' "$runnable"
    ;;
  grep)
    printf '%s\n' "$runnable" | grep -iE -- "$pattern" || { echo "no runnable model matches $pattern" >&2; exit 1; }
    ;;
  check)
    missing=0
    for id in "${ids[@]}"; do
      if can_run "$id"; then
        printf 'ok          %s\n' "$id"
      else
        printf 'cannot run  %s\n' "$id"
        missing=1
      fi
    done
    exit "$missing"
    ;;
  summary)
    echo "=== providers pi can run here (pi --list-models) ==="
    printf '%s\n' "$runnable" | cut -d/ -f1 | uniq -c | awk '{ printf "  %-20s %s models\n", $2, $1 }'
    echo "=== default and enabledModels (settings.json) ==="
    if [ -f "$AGENT_DIR/settings.json" ] && command -v jq >/dev/null 2>&1; then
      default=$(jq -r 'if .defaultProvider and .defaultModel then "\(.defaultProvider)/\(.defaultModel)" else empty end' "$AGENT_DIR/settings.json")
      [ -n "$default" ] && printf '  default  %s  %s\n' "$default" "$(can_run "$default" && echo ok || echo 'CANNOT RUN')"
      jq -r '.enabledModels[]? // empty' "$AGENT_DIR/settings.json" | while read -r id; do
        printf '  enabled  %s  %s\n' "$id" "$(can_run "$id" && echo ok || echo 'CANNOT RUN')"
      done
    else
      echo "  (no settings.json, or jq is missing)"
    fi
    echo "(--grep PATTERN or --all for ids; --check ID... to verify specific seats)"
    ;;
esac
