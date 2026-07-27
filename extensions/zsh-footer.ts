/**
 * Zsh-style Footer Extension
 *
 * Replaces pi's default footer with a prompt line mimicking the
 * Robbyrussell oh-my-zsh theme plus standard pi session metrics.
 *
 * Left side (zsh prompt):
 *    ➜ dir git:(branch) ✗
 *
 * Right side (pi metrics):
 *    ↑1.2k ↓3.4k │ $0.12 │ ctx 45% │ deepseek-v4-pro
 *
 * Features:
 *  - Green/red arrow (last tool exit code)
 *  - Cyan directory basename
 *  - Git branch with dirty/clean indicator
 *  - Token counts (input/output/cache), cost, context usage, model
 *  - Reacts to branch changes, model switches, every turn
 */

import type { AssistantMessage, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";

// ── helpers ────────────────────────────────────────────────────────

function isGitDirty(cwd: string): boolean {
  try {
    const out = execSync("git status --porcelain 2>/dev/null", {
      cwd,
      timeout: 2000,
      encoding: "utf-8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function dirBasename(cwd: string): string {
  const home = process.env.HOME || "~";
  if (cwd === home) return "~";
  const segments = cwd.replace(/\/+$/, "").split("/");
  return segments.slice(-2).join("/") || cwd;
}

function fmtNum(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function fmtCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `<$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

// ── extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let lastExitOk = true;
  let dirty = false;
  let savedTui: { requestRender: () => void } | null = null;

  // ── track last bash exit code ────────────────────────────────────

  pi.on("tool_result", (event) => {
    if (event.toolName === "bash" && event.details && "exitCode" in event.details) {
      lastExitOk = event.details.exitCode === 0;
      savedTui?.requestRender();
    }
  });

  // ── install the footer ───────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    dirty = isGitDirty(ctx.cwd);

    ctx.ui.setFooter((tui, theme, footerData) => {
      savedTui = tui;

      const unsub = footerData.onBranchChange(() => {
        dirty = isGitDirty(ctx.cwd);
        tui.requestRender();
      });

      return {
        dispose: unsub,
        invalidate() {
          dirty = isGitDirty(ctx.cwd);
        },

        render(width: number): string[] {
          // ── left side: zsh-style prompt ─────────────────────────
          const leftSegments: string[] = [];

          const arrowColor = lastExitOk ? "success" : "error";
          leftSegments.push(theme.fg(arrowColor, theme.bold("➜")) + " ");
          leftSegments.push(theme.fg("accent", dirBasename(ctx.cwd)));

          const branch = footerData.getGitBranch();
          if (branch) {
            leftSegments.push(theme.fg("muted", " git:("));
            leftSegments.push(theme.fg("warning", branch));
            leftSegments.push(theme.fg("muted", ")"));
            if (dirty) {
              leftSegments.push(theme.fg("warning", " ✗"));
            }
          }

          // ── right side: pi session metrics ─────────────────────
          let input = 0,
            output = 0,
            cacheRead = 0,
            cacheWrite = 0,
            totalCost = 0,
            cacheHitRate = 0;

          const branchEntries = ctx.sessionManager.getBranch();
          let assistantCount = 0;
          for (const e of branchEntries) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              input += m.usage.input;
              output += m.usage.output;
              cacheRead += m.usage.cacheRead;
              cacheWrite += m.usage.cacheWrite;
              totalCost += m.usage.cost.total;
              assistantCount++;
            }
          }

          // Cache hit rate from the last assistant message
          if (assistantCount > 0) {
            const lastAssistant = [...branchEntries]
              .reverse()
              .find(
                (e) => e.type === "message" && e.message.role === "assistant",
              );
            if (lastAssistant && lastAssistant.type === "message") {
              const m = lastAssistant.message as AssistantMessage;
              if (m.usage.cacheRead + m.usage.cacheWrite > 0) {
                cacheHitRate = Math.round(
                  (m.usage.cacheRead /
                    (m.usage.cacheRead + m.usage.cacheWrite + m.usage.input)) *
                    100,
                );
              }
            }
          }

          // Context usage percentage
          const ctxUsage = ctx.getContextUsage();
          const modelCtxWindow = ctx.model?.contextWindow ?? 200_000;
          const ctxPct = ctxUsage
            ? Math.round((ctxUsage.tokens / modelCtxWindow) * 100)
            : 0;

          // Build right-side segments
          const rightSegments: string[] = [];

          // Token summary: ↑in ↓out Rcache Wcache
          if (input + output > 0) {
            const tokParts: string[] = [];
            tokParts.push(theme.fg("muted", `↑${fmtNum(input)}`));
            tokParts.push(theme.fg("dim", `↓${fmtNum(output)}`));
            if (cacheRead > 0)
              tokParts.push(theme.fg("dim", `R${fmtNum(cacheRead)}`));
            if (cacheWrite > 0)
              tokParts.push(theme.fg("dim", `W${fmtNum(cacheWrite)}`));
            rightSegments.push(tokParts.join(" "));
            rightSegments.push(theme.fg("dim", "│"));
          }

          // Cache hit rate
          if (cacheHitRate > 0) {
            rightSegments.push(theme.fg("dim", `CH${cacheHitRate}%`));
            rightSegments.push(theme.fg("dim", "│"));
          }

          // Cost
          rightSegments.push(theme.fg("muted", fmtCost(totalCost)));
          rightSegments.push(theme.fg("dim", "│"));

          // Context usage
          const ctxColor = ctxPct > 80 ? "warning" : ctxPct > 50 ? "muted" : "dim";
          rightSegments.push(theme.fg(ctxColor, `ctx ${ctxPct}%`));
          rightSegments.push(theme.fg("dim", "│"));

          // Model
          const modelStr = ctx.model
            ? theme.fg("dim", ctx.model.id)
            : theme.fg("dim", "no-model");
          rightSegments.push(modelStr);

          // ── assemble ────────────────────────────────────────────
          const left = leftSegments.join("");
          const right = rightSegments.join(" ");
          const pad = " ".repeat(
            Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
          );
          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  });

  // ── react to model changes ───────────────────────────────────────

  pi.on("model_select", () => {
    savedTui?.requestRender();
  });

  // ── re-render on every turn so token/cost/ctx metrics stay fresh ─

  pi.on("turn_end", () => {
    savedTui?.requestRender();
  });

  pi.on("message_end", () => {
    savedTui?.requestRender();
  });

  // ── toggle command ───────────────────────────────────────────────

  pi.registerCommand("zsh-footer", {
    description: "Toggle the zsh-style footer on/off",
    handler: async (_args, ctx) => {
      // Toggle: if we have a saved tui reference, footer is active → disable
      if (savedTui) {
        ctx.ui.setFooter(undefined);
        savedTui = null;
        ctx.ui.notify("Default footer restored", "info");
      } else {
        // Re-enable by calling setFooter again — but we need the factory.
        // Easiest path: just tell the user to /reload.
        ctx.ui.notify("Run /reload to re-enable the zsh footer", "info");
      }
    },
  });
}
