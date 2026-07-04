#!/usr/bin/env bash
# review-submit.sh — finalise a PENDING review. THIS is the step that emits the
# single review event/notification; everything before it was invisible.
#
# Usage:
#   review-submit.sh [--repo owner/repo] --pr N --review-id ID \
#       [--event COMMENT|REQUEST_CHANGES|APPROVE] [--body-file file]
#
# --event defaults to COMMENT (right for agent panels; APPROVE on your own PR 422s).
# --body-file adds/replaces the top-level review summary at submit time.
set -euo pipefail

REPO="" PR="" ID="" EVENT="COMMENT" BODY_FILE=""
while [ $# -gt 0 ]; do
	case "$1" in
		--repo) REPO="$2"; shift 2;;
		--pr) PR="$2"; shift 2;;
		--review-id) ID="$2"; shift 2;;
		--event) EVENT="$2"; shift 2;;
		--body-file) BODY_FILE="$2"; shift 2;;
		-h|--help) sed -n '2,10p' "$0"; exit 0;;
		*) echo "review-submit: unknown arg $1" >&2; exit 2;;
	esac
done

[ -n "$REPO" ] || REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
[ -n "$REPO" ] || { echo "review-submit: --repo required (not inside a repo)" >&2; exit 2; }
[ -n "$PR" ] || { echo "review-submit: --pr required" >&2; exit 2; }
[ -n "$ID" ] || { echo "review-submit: --review-id required (from review-create.sh)" >&2; exit 2; }
case "$EVENT" in COMMENT|REQUEST_CHANGES|APPROVE) ;; *) echo "review-submit: bad --event '$EVENT'" >&2; exit 2;; esac

PAYLOAD=$(jq -n --arg e "$EVENT" '{event: $e}')
if [ -n "$BODY_FILE" ]; then
	[ -s "$BODY_FILE" ] || { echo "review-submit: --body-file missing/empty: $BODY_FILE" >&2; exit 2; }
	PAYLOAD=$(jq --rawfile b "$BODY_FILE" '.body = $b' <<<"$PAYLOAD")
fi

RESP=$(printf '%s' "$PAYLOAD" | gh api "repos/$REPO/pulls/$PR/reviews/$ID/events" --input -)
STATE=$(jq -r '.state' <<<"$RESP")
URL=$(jq -r '.html_url' <<<"$RESP")
echo "review_id: $ID"
echo "state: $STATE"
echo "url: $URL"
[ "$STATE" != "PENDING" ] || { echo "review-submit: still PENDING — submit did not take" >&2; exit 1; }
