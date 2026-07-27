# New machine setup

Provisioning a machine to match the current pi environment. Run in order — step 2
must come before step 4, because several packages are private repos.

Reference versions at time of writing: node v25.6.1, pi 0.82.1.

## 1. Install pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
```

## 2. Authenticate to GitHub

```bash
gh auth login
```

Needed *before* installing packages: this skills repo is private, and so are
`threadsafe-systems/pi-sdlc`, `pi-worktree`, `pi-repo-html`, and
`pi-conveyancing-agent`. Without auth they fail to fetch.

## 3. Clone the skills

```bash
git clone git@github.com:neilwashere/agent-skills.git ~/.agents/skills
```

That is the entire skill install — pi scans `~/.agents/skills/` recursively for
directories containing `SKILL.md`, so nothing needs registering in settings.
Leave `~/.pi/agent/skills/` empty.

## 4. Install packages

`pi install` writes the settings entry *and* materialises the checkout, so drive
it from the reference snapshot rather than hand-editing JSON:

```bash
cd ~/.agents/skills
python3 -c "
import json
for p in json.load(open('pi-settings.reference.json'))['packages']:
    print(p)
" | while read -r spec; do pi install "$spec"; done
```

Then verify every pinned clone really is on its pinned ref (see the gotcha at the
bottom — this does not verify itself):

```bash
./scripts/audit-package-pins.sh
```

Expect `ok` for pinned entries, `unpinned` for the three that track default
branches. Anything reporting `MISMATCH` or `MISSING` is fixed by re-running
`pi install <spec>`.

## 5. Apply the remaining settings

`pi install` only manages `packages`. Merge the rest of
`pi-settings.reference.json` into `~/.pi/agent/settings.json` — `theme`,
`defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `enabledModels`,
`extensions`, `skills`, `hideThinkingBlock`, `warnings`, `defaultProjectTrust`,
`transport`, `terminal`.

On a genuinely fresh machine the file can simply be copied, then re-run step 4 to
reconcile:

```bash
cp ~/.agents/skills/pi-settings.reference.json ~/.pi/agent/settings.json
```

## 6. Install the global extensions

```bash
cp -a ~/.agents/skills/extensions/. ~/.pi/agent/extensions/
```

pi auto-discovers `*.ts` there. Then regenerate the herdr-owned file rather than
trusting the committed snapshot (only if herdr is installed):

```bash
herdr integration install pi
~/.pi/agent/extensions/herdr-pi-subagents-patch.sh
```

Sanity-check the hand-authored one:

```bash
node ~/.pi/agent/extensions/herdr-awaiting-input.test.mjs
```

## 7. Credentials — never copied from the repo

Two separate stores, both deliberately excluded from version control:

- **OAuth providers** (`anthropic`, `openai-codex`) live in
  `~/.pi/agent/auth.json`. Do **not** copy that file. Start `pi` and run
  `/login` for each provider.
- **API-key providers** come from environment variables sourced by
  `~/.zsh_secrets` (loaded from `.zshrc`). Move that file across securely —
  scp/password manager, never git. Variables in use:
  `AWS_BEARER_TOKEN_BEDROCK`, `BRAVE_API_KEY`, `DASHSCOPE_API_KEY`,
  `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `LINEAR_API_KEY`, `MOONSHOT_API_KEY`,
  `OPENAI_API_KEY`, `ZAI_API_KEY`, `ZEROENTROPY_API_KEY`.

## 8. Optional — herdr reference source

The `herdr` skill is the upstream Rust tree with a `SKILL.md` at its root (~43M),
gitignored here rather than committed. Only if the reference source is wanted:

```bash
herdr --version   # clone that tag into ~/.agents/skills/herdr (already ignored)
```

## Verify

```bash
pi list                                    # packages resolve
~/.agents/skills/scripts/audit-package-pins.sh
```

Start `pi` and confirm the skills are discovered. `teach` will **not** appear in
the model-visible list — it sets `disable-model-invocation: true` and is
slash-command only.

## The gotcha this setup exists to avoid

Pinned git packages drift silently. `pi update --extensions` and `pi update --all`
deliberately **do not** move a pin to a newer ref; they only reconcile a clone to
the ref already configured. Editing the version in `settings.json` therefore
changes nothing on its own.

This bit us: settings declared `pi-sdlc@v2.4.0` while the working clone sat on a
`v1.0.2`-era commit, so every session silently loaded a much older skill than the
settings implied.

Two consequences:

- To move a pin, use the one-shot that updates settings *and* the checkout:
  `pi install git:github.com/threadsafe-systems/pi-sdlc@v3.0.0`.
- Do not verify a pin with `git rev-parse <tag>`. pi fetches a pinned ref to
  `FETCH_HEAD` without creating a local tag ref, so the tag is unresolvable
  inside a perfectly correct clone. `scripts/audit-package-pins.sh` resolves via
  `ls-remote` for this reason.
