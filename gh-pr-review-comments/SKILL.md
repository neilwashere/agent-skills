---
name: gh-pr-review-comments
description: Read, reply to, and post inline GitHub PR review comments at scale via the gh API, and verify replies landed. Use when addressing reviewer feedback on a PR (leaving "addressed in <sha>" replies) or when an agent posts inline review findings. Covers the secondary-rate-limit ("abuse") gotcha, pagination limits, the exact reply/post recipes, and verifying committed vs working-tree state.
---

# gh-pr-review-comments

Battle-tested recipes for working PR review threads from the CLI, from a session
that addressed ~59 inline comments and ran multiple cross-model review rounds.

## Read all inline comments (mind pagination)

```bash
gh api --paginate repos/OWNER/REPO/pulls/N/comments
```

- `?per_page=200` is **silently capped at 100** — always use `--paginate` (or
  page through) or you'll miss comments and think you replied to all of them.
- Each item: `id`, `path`, `line`, `body`, and `in_reply_to_id` (set on replies).
- Find threads still needing a reply: select comments whose `id` is not anyone's
  `in_reply_to_id`.

## Reply to a review comment

```bash
gh api repos/OWNER/REPO/pulls/N/comments/COMMENT_ID/replies \
  -f body="Addressed in <short-sha>."
```

## Post a NEW inline comment (e.g. a review finding)

```bash
gh api repos/OWNER/REPO/pulls/N/comments \
  -f body="[HIGH] finding text" \
  -f commit_id="<FULL 40-char sha>" \
  -f path="src/file.ts" \
  -F line=NN \
  -f side=RIGHT
```

- `commit_id` must be the **full** sha; `line` must exist on the RIGHT side at
  that commit. Use `-F` (not `-f`) for the integer `line`.

## THE rate-limit gotcha (secondary limit / "abuse")

Posting many replies quickly trips GitHub's secondary rate limit:

```
HTTP 422  {"resource":"PullRequestReview","code":"abuse","field":"base"}
```

It is **sticky** once tripped — subsequent posts keep failing for a while.
Mitigation that worked:

- Space posts out: `sleep 2-3` between each reply.
- If you hit 422, **back off ~30s** before retrying (not 2s).
- Posting in tight parallel `&` loops reliably trips it; serialize instead.
- After a batch, verify how many landed and retry only the missing ones:

```bash
gh api --paginate repos/OWNER/REPO/pulls/N/comments \
  | python3 -c "import json,sys;d=json.load(sys.stdin);\
ids={c['in_reply_to_id'] for c in d if c.get('in_reply_to_id')};\
print(len(ids),'threads have replies')"
```

## Verify a claim against COMMITTED state, not the working tree

The most important review-discipline lesson from this codebase: a background
auto-formatter (pi-lens biome/prettier) can silently rewrite files in the shared
working tree while tests/LSP run. So `cat -A file` / `sed -n` on the working
tree may **not** match what's actually committed in the PR.

When verifying whether a reviewer's finding is real, check the **committed blob**:

```bash
git show <sha>:path/to/file | sed -n 'A,Bp' | cat -A
```

In this repo that distinction flipped a "false positive" dismissal into a valid
finding — the working tree had been auto-normalized; the merged commit had not.

## Reply etiquette used here

- For each addressed comment, leave an inline reply: `Addressed in <short-sha>.`
- If a finding is wrong, reply explaining why (verified), with evidence — and
  if you later discover you were wrong, post a correction on the same thread.
- Reviewer claims are ~80% right and overreach; verify load-bearing/surprising
  ones against the committed state before acting.
