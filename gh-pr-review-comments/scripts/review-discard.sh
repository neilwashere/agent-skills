#!/usr/bin/env bash
# review-discard.sh — delete a PENDING review (the amendment path).
#
# Pending reviews are invisible and event-less, so discard + re-create is the
# safe way to amend: nothing ever reaches watchers until review-submit.sh.
#
# Usage:
#   review-discard.sh [--repo owner/repo] --pr N [--review-id ID]
#
# --review-id defaults to your PENDING review on the PR.
set -euo pipefail

REPO="" PR="" ID=""
while [ $# -gt 0 ]; do
	case "$1" in
		--repo) REPO="$2"; shift 2;;
		--pr) PR="$2"; shift 2;;
		--review-id) ID="$2"; shift 2;;
		-h|--help) sed -n '2,10p' "$0"; exit 0;;
		*) echo "review-discard: unknown arg $1" >&2; exit 2;;
	esac
done

[ -n "$REPO" ] || REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
[ -n "$REPO" ] || { echo "review-discard: --repo required (not inside a repo)" >&2; exit 2; }
[ -n "$PR" ] || { echo "review-discard: --pr required" >&2; exit 2; }

if [ -z "$ID" ]; then
	ID=$(gh api "repos/$REPO/pulls/$PR/reviews" --jq '[.[] | select(.state=="PENDING")][0].id // empty')
	[ -n "$ID" ] || { echo "review-discard: no PENDING review found on $REPO#$PR" >&2; exit 1; }
fi

STATE=$(gh api "repos/$REPO/pulls/$PR/reviews/$ID" --jq .state)
[ "$STATE" = "PENDING" ] || { echo "review-discard: review $ID is $STATE, not PENDING — refusing (submitted reviews need dismissal, not deletion)" >&2; exit 1; }

gh api -X DELETE "repos/$REPO/pulls/$PR/reviews/$ID" >/dev/null
echo "discarded pending review $ID on $REPO#$PR (no event was ever emitted)"
