#!/usr/bin/env bash
# Verify every git: package clone actually sits on the ref settings.json names.
#
# Exists because a pin can drift silently: `pi update --extensions`/`--all` only
# reconcile a clone to the ref ALREADY configured, they never move the pin. A
# clone can therefore sit far behind the ref in settings (settings said
# pi-sdlc@v2.4.0 while the clone was still on a v1.0.2 commit), and pi loads the
# stale checkout with no warning.
#
# Refs are resolved via ls-remote, not locally: pi fetches a pinned ref to
# FETCH_HEAD without creating a local tag ref, so `git rev-parse v3.0.0` fails
# inside a perfectly correct clone. Needs network; reports unreachable remotes
# rather than guessing.
#
# Fix a MISMATCH or MISSING with:  pi install <spec>
set -uo pipefail

settings="${1:-$HOME/.pi/agent/settings.json}"
[ -f "$settings" ] || { echo "no settings at $settings" >&2; exit 2; }

# Resolve a ref to a commit on the remote. Annotated tags appear twice, as the
# tag object and a "^{}" dereference line; the dereference is the commit we want.
resolve_remote() {
	local clone=$1 ref=$2 out
	out=$(git -C "$clone" ls-remote origin \
		"refs/tags/$ref^{}" "refs/tags/$ref" "refs/heads/$ref" 2>/dev/null) || return 1
	[ -n "$out" ] || return 1
	# prefer the ^{} line when present
	awk '/\^\{\}$/ {print $1; found=1; exit} {last=$1} END {if (!found) print last}' <<<"$out"
}

rc=0
while IFS= read -r spec; do
	rest=${spec#git:}
	if [[ $rest == *@* ]]; then
		repo=${rest%@*}
		ref=${rest##*@}
	else
		repo=$rest
		ref=""
	fi

	clone="$HOME/.pi/agent/git/$repo"
	if [ ! -d "$clone/.git" ]; then
		printf '%-58s MISSING (not cloned)\n' "$repo"
		rc=1
		continue
	fi

	head=$(git -C "$clone" rev-parse HEAD 2>/dev/null)

	if [ -z "$ref" ]; then
		printf '%-58s unpinned, at %s\n' "$repo" "${head:0:7}"
		continue
	fi

	want=$(resolve_remote "$clone" "$ref")
	if [ -z "$want" ]; then
		printf '%-58s ref %s UNRESOLVABLE (offline, or ref gone)\n' "$repo" "$ref"
		rc=1
	elif [ "$head" = "$want" ]; then
		printf '%-58s ok (%s)\n' "$repo" "$ref"
	else
		printf '%-58s MISMATCH: on %s, want %s (%s)\n' \
			"$repo" "${head:0:7}" "${want:0:7}" "$ref"
		rc=1
	fi
done < <(python3 -c "
import json,sys
for p in json.load(open(sys.argv[1])).get('packages', []):
    if p.startswith('git:'):
        print(p)
" "$settings")

[ $rc -eq 0 ] && echo "all git package pins satisfied"
exit $rc
