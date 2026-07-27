// Reports "waiting for the user to answer a question" to Herdr, for every model.
//
// Herdr's pi integration (herdr-agent-state.ts, installed beside this file) claims
// full lifecycle authority over the pane, which switches OFF herdr's terminal-screen
// heuristics — `herdr agent explain` reports
// `screen_detection_skip_reason: full_lifecycle_hook_authority`. In that mode the only
// route to herdr's red "blocked" state is the `herdr:blocked` event on pi's extension
// bus, and pi core never emits it. So a turn that ends with the assistant asking a
// question is indistinguishable from any other finished turn: the pane reports plain
// `idle`, and the Agents panel shows done/idle rather than needs-input.
//
// This extension supplies that missing signal by inspecting the final assistant message
// of a settled turn. It is model-agnostic on purpose: the same question asked by Gemini,
// Claude, or anything else produces the same pane state.

type QuestionMatch = { label: string };

const MAX_LABEL = 120;
const MAX_CONTINUATION_LINES = 8;

/** Trailing wrappers that may follow the question mark: `?)`, `?"`, `?*`, `?_`, `` ?` ``. */
const TRAILING_WRAPPERS = /[)\]}>"'`*_~\s]+$/;

/** Lines that continue a question rather than answering it: asides, options, tables. */
const CONTINUATION_LINE =
  /^(?:[-*+]\s|\d+[.)]\s|>\s?|\||\(|\*\(|_\(|\*_?\(|—\s|–\s|:\s*$)/;

function stripFencedCode(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

function endsWithQuestion(line: string): boolean {
  return line.replace(TRAILING_WRAPPERS, "").endsWith("?");
}

function toLabel(line: string): string {
  const flattened = line
    .replace(/[*_`~]+/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return flattened.length > MAX_LABEL ? `${flattened.slice(0, MAX_LABEL - 1)}…` : flattened;
}

/**
 * Decide whether a finished assistant message leaves the user with a question to answer.
 *
 * Walks backwards from the last non-empty line, stepping over lines that merely continue
 * a question (bullet options, tables, parenthetical or italic asides) so that a question
 * followed by "(For example: ...)" still counts, while a message whose closing line is a
 * statement ("Should I? I'll go ahead and do it.") does not.
 */
export function questionAwaitingInput(text: string): QuestionMatch | undefined {
  if (!text) return undefined;
  const lines = stripFencedCode(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;

  let walked = 0;
  for (let i = lines.length - 1; i >= 0 && walked <= MAX_CONTINUATION_LINES; i--, walked++) {
    const line = lines[i];
    if (endsWithQuestion(line)) return { label: toLabel(line) };
    // A closing line that is not a continuation means the message ends on a statement.
    if (!CONTINUATION_LINE.test(line)) return undefined;
  }
  return undefined;
}

function assistantText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n");
}

export default function (pi: any) {
  if (process.env.HERDR_ENV !== "1") return;
  if (process.env.HERDR_AWAITING_INPUT === "0") return;

  let rootSession = false;
  let lastAssistantText = "";
  let blocked = false;

  function setBlocked(active: boolean, label?: string): void {
    if (active === blocked) return;
    blocked = active;
    // Consumed by herdr-agent-state.ts, which reports it to herdr as "blocked".
    pi.events.emit("herdr:blocked", active ? { active: true, label } : { active: false });
  }

  pi.on("session_start", (_event: any, ctx: any) => {
    rootSession = ctx?.hasUI === true;
    lastAssistantText = "";
    setBlocked(false);
  });

  pi.on("agent_start", () => {
    lastAssistantText = "";
    setBlocked(false);
  });

  pi.on("message_end", (event: any) => {
    if (event?.message?.role !== "assistant") return;
    const text = assistantText(event.message);
    if (text.trim()) lastAssistantText = text;
  });

  pi.on("agent_settled", (_event: any, ctx: any) => {
    if (!rootSession || ctx?.isIdle?.() !== true) return;
    const match = questionAwaitingInput(lastAssistantText);
    if (match) setBlocked(true, match.label);
  });

  pi.on("session_shutdown", () => setBlocked(false));
}
