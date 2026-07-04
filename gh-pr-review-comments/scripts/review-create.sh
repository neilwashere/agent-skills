#!/usr/bin/env bash
# review-create.sh — create ONE atomic PENDING review carrying ALL inline comments.
#
# Why: posting comments one-by-one via POST /pulls/N/comments emits one event +
# notification per comment, is exposed to secondary rate limits mid-batch, and a
# failure leaves a partial review. A PENDING review is invisible to others,
# emits NO event, validates every comment anchor server-side in one shot
# (a 422 means NOTHING landed), and only the later submit emits a single event.
#
# Usage:
#   review-create.sh [--repo owner/repo] [--pr N] manifest.json
#
# Manifest (single JSON file — never build bodies in shell strings):
#   {
#     "repo":   "owner/repo",            // optional if --repo given or cwd is the repo
#     "pr":     3,                        // optional if --pr given
#     "commit": "<FULL 40-char head sha>",
#     "bodyFile": "/tmp/review-summary.md",   // optional top-level review body
#     "comments": [
#       {"path": "src/x.ts", "line": 224, "side": "RIGHT", "bodyFile": "/tmp/c1.md"},
#       {"path": "src/y.ts", "line": 10,  "body": "short inline text is ok too"}
#     ]
#   }
#
# Each comment: exactly one of body|bodyFile. side defaults to RIGHT.
# Prints "review_id: <id>" on success — pass that to review-verify / review-submit.
set -euo pipefail

REPO="" PR="" MANIFEST=""
while [ $# -gt 0 ]; do
	case "$1" in
		--repo) REPO="$2"; shift 2;;
		--pr)   PR="$2"; shift 2;;
		-h|--help) sed -n '2,26p' "$0"; exit 0;;
		-*) echo "review-create: unknown flag $1" >&2; exit 2;;
		*)  MANIFEST="$1"; shift;;
	esac
done

[ -n "$MANIFEST" ] || { echo "review-create: manifest.json required (see --help)" >&2; exit 2; }
[ -f "$MANIFEST" ] || { echo "review-create: manifest not found: $MANIFEST" >&2; exit 2; }
jq -e . "$MANIFEST" >/dev/null || { echo "review-create: manifest is not valid JSON" >&2; exit 2; }

[ -n "$REPO" ] || REPO=$(jq -r '.repo // empty' "$MANIFEST")
[ -n "$REPO" ] || REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
[ -n "$REPO" ] || { echo "review-create: repo unknown — pass --repo or set manifest.repo" >&2; exit 2; }
[ -n "$PR" ] || PR=$(jq -r '.pr // empty' "$MANIFEST")
[ -n "$PR" ] || { echo "review-create: PR number unknown — pass --pr or set manifest.pr" >&2; exit 2; }

COMMIT=$(jq -r '.commit // empty' "$MANIFEST")
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "review-create: manifest.commit must be the FULL 40-char lowercase sha (got: '$COMMIT')" >&2; exit 2; }

N=$(jq '.comments | length' "$MANIFEST")
[ "$N" -gt 0 ] || { echo "review-create: manifest.comments is empty" >&2; exit 2; }

# Refuse if we already have a pending review on this PR (GitHub allows only one
# per user; other users' pending reviews are invisible, so any PENDING is ours).
EXISTING=$(gh api "repos/$REPO/pulls/$PR/reviews" --jq '[.[] | select(.state=="PENDING")][0].id // empty')
if [ -n "$EXISTING" ]; then
	echo "review-create: you already have a pending review (id $EXISTING) on $REPO#$PR." >&2
	echo "  finalise it:  review-submit.sh --repo $REPO --pr $PR --review-id $EXISTING" >&2
	echo "  or discard:   review-discard.sh --repo $REPO --pr $PR --review-id $EXISTING" >&2
	exit 3
fi

# Build the payload with jq only — comment bodies come from files (or manifest
# .body), NEVER from shell string interpolation (quoting was a real failure mode).
PAYLOAD=$(jq -n --arg commit "$COMMIT" '{commit_id: $commit, comments: []}')

TOP_BODY_FILE=$(jq -r '.bodyFile // empty' "$MANIFEST")
if [ -n "$TOP_BODY_FILE" ]; then
	[ -s "$TOP_BODY_FILE" ] || { echo "review-create: bodyFile missing/empty: $TOP_BODY_FILE" >&2; exit 2; }
	PAYLOAD=$(jq --rawfile b "$TOP_BODY_FILE" '.body = $b' <<<"$PAYLOAD")
fi

for i in $(seq 0 $((N - 1))); do
	c=$(jq ".comments[$i]" "$MANIFEST")
	path=$(jq -r '.path // empty' <<<"$c")
	line=$(jq -r '.line // empty' <<<"$c")
	side=$(jq -r '.side // "RIGHT"' <<<"$c")
	bodyfile=$(jq -r '.bodyFile // empty' <<<"$c")
	hasbody=$(jq 'has("body")' <<<"$c")

	[ -n "$path" ] || { echo "review-create: comments[$i] missing path" >&2; exit 2; }
	[[ "$line" =~ ^[0-9]+$ ]] || { echo "review-create: comments[$i] line must be a positive integer (got '$line')" >&2; exit 2; }
	[[ "$side" == "RIGHT" || "$side" == "LEFT" ]] || { echo "review-create: comments[$i] side must be RIGHT or LEFT" >&2; exit 2; }

	if [ -n "$bodyfile" ] && [ "$hasbody" = "true" ]; then
		echo "review-create: comments[$i] has BOTH body and bodyFile — pick one" >&2; exit 2
	elif [ -n "$bodyfile" ]; then
		[ -s "$bodyfile" ] || { echo "review-create: comments[$i] bodyFile missing/empty: $bodyfile" >&2; exit 2; }
		PAYLOAD=$(jq --arg p "$path" --argjson l "$line" --arg s "$side" --rawfile b "$bodyfile" \
			'.comments += [{path: $p, line: $l, side: $s, body: $b}]' <<<"$PAYLOAD")
	elif [ "$hasbody" = "true" ]; then
		body=$(jq -r '.body' <<<"$c")
		[ -n "$body" ] || { echo "review-create: comments[$i] body is empty" >&2; exit 2; }
		PAYLOAD=$(jq --arg p "$path" --argjson l "$line" --arg s "$side" --arg b "$body" \
			'.comments += [{path: $p, line: $l, side: $s, body: $b}]' <<<"$PAYLOAD")
	else
		echo "review-create: comments[$i] needs body or bodyFile" >&2; exit 2
	fi

	# Catch the classic '-f body=@file' literal-string bug and similar mistakes.
	first=$(jq -r '.comments[-1].body' <<<"$PAYLOAD" | head -c 1)
	if [ "$first" = "@" ]; then
		echo "review-create: comments[$i] body starts with '@' — looks like an unexpanded @file reference, refusing" >&2; exit 2
	fi
done

# NOTE: no "event" field → review is created PENDING (draft): no event, no
# notification, invisible to other users until review-submit.sh.
RESP=$(printf '%s' "$PAYLOAD" | gh api "repos/$REPO/pulls/$PR/reviews" --input -) || {
	echo "review-create: POST failed — a 422 here means an invalid anchor (line not on the $COMMIT diff's stated side, bad path, wrong sha). NOTHING was posted (atomic)." >&2
	exit 1
}

ID=$(jq -r '.id' <<<"$RESP")
STATE=$(jq -r '.state' <<<"$RESP")
echo "review_id: $ID"
echo "state: $STATE"
echo "comments: $N"
echo
echo "next:  review-verify.sh --repo $REPO --pr $PR --review-id $ID --expect $N"
echo "then:  review-submit.sh --repo $REPO --pr $PR --review-id $ID"
