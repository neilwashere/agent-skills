#!/usr/bin/env bash
# review-verify.sh — verify a PENDING review's comments by CONTENT, not just count.
#
# Lesson learned the hard way: "the comment exists" is not verification — a
# whole batch once landed with literal '@/tmp/c1.md' bodies. This prints every
# comment's path:line and full body so the agent can eyeball them, and it
# hard-fails on suspicious bodies (unexpanded @file refs, empty bodies).
#
# Usage:
#   review-verify.sh [--repo owner/repo] --pr N [--review-id ID] [--expect N] [--full]
#
# --review-id  defaults to your (only possible) PENDING review on the PR
# --expect N   fail unless the review has exactly N comments
# --full       print full bodies (default: first 3 lines of each)
set -euo pipefail

REPO="" PR="" ID="" EXPECT="" FULL=0
while [ $# -gt 0 ]; do
	case "$1" in
		--repo) REPO="$2"; shift 2;;
		--pr) PR="$2"; shift 2;;
		--review-id) ID="$2"; shift 2;;
		--expect) EXPECT="$2"; shift 2;;
		--full) FULL=1; shift;;
		-h|--help) sed -n '2,14p' "$0"; exit 0;;
		*) echo "review-verify: unknown arg $1" >&2; exit 2;;
	esac
done

[ -n "$REPO" ] || REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
[ -n "$REPO" ] || { echo "review-verify: --repo required (not inside a repo)" >&2; exit 2; }
[ -n "$PR" ] || { echo "review-verify: --pr required" >&2; exit 2; }

if [ -z "$ID" ]; then
	ID=$(gh api "repos/$REPO/pulls/$PR/reviews" --jq '[.[] | select(.state=="PENDING")][0].id // empty')
	[ -n "$ID" ] || { echo "review-verify: no PENDING review found on $REPO#$PR" >&2; exit 1; }
fi

REVIEW=$(gh api "repos/$REPO/pulls/$PR/reviews/$ID")
STATE=$(jq -r '.state' <<<"$REVIEW")
COMMIT=$(jq -r '.commit_id' <<<"$REVIEW")
COMMENTS=$(gh api --paginate "repos/$REPO/pulls/$PR/reviews/$ID/comments")
N=$(jq 'length' <<<"$COMMENTS")

echo "review_id: $ID"
echo "state: $STATE"
echo "commit: $COMMIT"
echo "comments: $N"
[ "$STATE" = "PENDING" ] || echo "WARNING: review is $STATE, not PENDING — it has already been submitted/dismissed" >&2

FAIL=0
if [ -n "$EXPECT" ] && [ "$N" -ne "$EXPECT" ]; then
	echo "FAIL: expected $EXPECT comments, found $N" >&2
	FAIL=1
fi

for i in $(seq 0 $((N - 1))); do
	c=$(jq ".[$i]" <<<"$COMMENTS")
	path=$(jq -r '.path' <<<"$c")
	# PENDING-review comments expose only diff `position` (line/original_line are
	# null until submit) — label accordingly so nobody mistakes position for line.
	line=$(jq -r 'if .line then (.line|tostring) elif .original_line then (.original_line|tostring) elif .position then "diff-position " + (.position|tostring) else "?" end' <<<"$c")
	body=$(jq -r '.body' <<<"$c")
	echo
	echo "--- [$((i + 1))/$N] $path:$line ---"
	if [ -z "$body" ]; then
		echo "FAIL: empty body" >&2; FAIL=1
	elif [ "$(head -c 1 <<<"$body")" = "@" ]; then
		echo "FAIL: body starts with '@' — looks like an unexpanded @file reference:" >&2
		head -1 <<<"$body" >&2; FAIL=1
	fi
	if [ "$FULL" -eq 1 ]; then printf '%s\n' "$body"; else head -3 <<<"$body"; fi
done

echo
if [ "$FAIL" -ne 0 ]; then
	echo "VERIFY FAILED — fix with review-discard.sh + amended review-create.sh (pending reviews emit no events; discarding is invisible)" >&2
	exit 1
fi
echo "VERIFY OK — finalise with: review-submit.sh --repo $REPO --pr $PR --review-id $ID"
