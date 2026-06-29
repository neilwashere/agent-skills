#!/usr/bin/env bash
# dispatch.sh — launch concurrent, detached pi sub-agents across several models.
#
# WHY THIS EXISTS / THE LOAD-BEARING GOTCHA:
#   Plain `pi ... &`, `nohup pi ... &`, even `nohup ... & disown` get KILLED the
#   moment the calling bash tool-call returns, because the harness reaps the
#   tool's process group. The ONLY thing that survives across tool calls is a
#   NEW SESSION: `setsid bash -c '...' </dev/null &`. This script does that.
#
# Usage:
#   ./dispatch.sh --prompt PROMPT.txt --out /tmp/run1 \
#       --model amazon-bedrock/eu.anthropic.claude-opus-4-8 \
#       --model kimi-ai/kimi-k2.7-code \
#       --model zai-coding-cn/glm-5.2 \
#       --model deepseek/deepseek-v4-pro
#
# Options:
#   --prompt FILE     Prompt file (required). If it contains the token
#                     REVIEWER_TAG, each agent gets its own copy with the tag
#                     replaced by "<model> agent:" so its output self-identifies.
#   --out DIR         Output/log dir (default: /tmp/pi-dispatch-<epoch>).
#   --thinking LEVEL  off|minimal|low|medium|high|xhigh (default: high).
#   --model SPEC      provider/model. Repeatable. (model ids may contain dots;
#                     they never contain '/', so first '/' splits provider.)
#
# After launching, MONITOR with:  ./monitor.sh DIR
set -uo pipefail

PROMPT=""
OUTDIR="/tmp/pi-dispatch-$(date +%s)"
THINKING="high"
declare -a SPECS=()
while [ $# -gt 0 ]; do
	case "$1" in
	--prompt)
		PROMPT="$2"
		shift 2
		;;
	--out)
		OUTDIR="$2"
		shift 2
		;;
	--thinking)
		THINKING="$2"
		shift 2
		;;
	--model)
		SPECS+=("$2")
		shift 2
		;;
	*)
		echo "unknown arg: $1" >&2
		exit 2
		;;
	esac
done

[ -z "$PROMPT" ] && {
	echo "error: --prompt required" >&2
	exit 2
}
[ -f "$PROMPT" ] || {
	echo "error: prompt file not found: $PROMPT" >&2
	exit 2
}
[ "${#SPECS[@]}" -eq 0 ] && {
	echo "error: at least one --model required" >&2
	exit 2
}

mkdir -p "$OUTDIR"
echo "out dir: $OUTDIR"

for spec in "${SPECS[@]}"; do
	provider="${spec%%/*}"
	model="${spec#*/}"
	tag="$(echo "$model" | tr '/.: ' '____')"
	log="$OUTDIR/$tag.log"
	pf="$OUTDIR/$tag.prompt.txt"

	# Per-agent prompt: substitute REVIEWER_TAG so each agent self-identifies.
	if grep -q REVIEWER_TAG "$PROMPT"; then
		sed "s|REVIEWER_TAG|${model} agent:|g" "$PROMPT" >"$pf"
	else
		cp "$PROMPT" "$pf"
	fi

	# setsid + </dev/null + & is the only form that survives the tool boundary.
	setsid bash -c "pi --provider '$provider' --model '$model' --print --no-session --thinking '$THINKING' \"\$(cat '$pf')\" > '$log' 2>&1" </dev/null &
	echo "launched: $spec  ->  $log  (wrapper pid $!)"
done
disown -a

cat <<EOF

All agents launched detached. NOTES:
  - --print buffers: logs stay 0 bytes until the agent finishes. 0 bytes != failure.
  - A live agent spawns tool subprocesses (tsserver, etc.) — that's "actively working".
  - Monitor with:   $(dirname "$0")/monitor.sh "$OUTDIR"
  - Tip: smoke-test a model first ( pi --provider P --model M --print --no-session "Reply PONG" )
    to catch auth/rate-limit errors cheaply before a big dispatch.
EOF
