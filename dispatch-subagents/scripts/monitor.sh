#!/usr/bin/env bash
# monitor.sh — poll a dispatch output dir: which agents are alive, log sizes,
# and a peek at each agent's tail. Safe to run repeatedly between tool calls.
#
# Usage: ./monitor.sh DIR [--tail N]
set -uo pipefail

DIR="${1:-}"
TAILN=12
[ "${2:-}" = "--tail" ] && TAILN="${3:-12}"
[ -z "$DIR" ] && {
	echo "usage: monitor.sh DIR [--tail N]" >&2
	exit 2
}
[ -d "$DIR" ] || {
	echo "no such dir: $DIR" >&2
	exit 2
}

echo "=== status ($DIR) ==="
for pf in "$DIR"/*.prompt.txt; do
	[ -e "$pf" ] || continue
	tag="$(basename "$pf" .prompt.txt)"
	log="$DIR/$tag.log"
	if pgrep -f "$pf" >/dev/null 2>&1; then state="RUNNING"; else state="EXITED "; fi
	bytes=$(wc -c <"$log" 2>/dev/null || echo 0)
	printf "  %-40s %s  %6s bytes\n" "$tag" "$state" "$bytes"
done

echo "=== tails (last $TAILN lines each) ==="
for log in "$DIR"/*.log; do
	[ -e "$log" ] || continue
	echo "----- $(basename "$log") -----"
	tail -n "$TAILN" "$log" 2>/dev/null
	echo
done
