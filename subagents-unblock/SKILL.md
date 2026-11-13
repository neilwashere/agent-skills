---
name: subagents-unblock
description: Clear a cached pi-subagents model or provider exclusion after quota, authentication, or permission access has been restored. Invoke with a provider/model id, `provider NAME`, `all`, or `list`.
disable-model-invocation: true
---

# Unblock pi-subagents models

Run the helper with the user's argument:

```bash
node "$HOME/.agents/skills/subagents-unblock/scripts/unblock.mjs" list
node "$HOME/.agents/skills/subagents-unblock/scripts/unblock.mjs" model <provider/model>
node "$HOME/.agents/skills/subagents-unblock/scripts/unblock.mjs" provider <provider>
node "$HOME/.agents/skills/subagents-unblock/scripts/unblock.mjs" all
```

A bare `provider/model` argument means `model provider/model`. If the request does not identify a target, run `list` and ask which exclusion to clear. A model clear also removes a provider-wide exclusion affecting that model; state this when the helper reports one.

After a successful clear, tell the user to run `/reload` in every active Pi session before launching another subagent. The exclusion cache is held in memory, so changing its persisted store alone does not unblock the current runtime.
