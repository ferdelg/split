/**
 * One coach turn through the tool loop, plus chat trimming and history
 * replay. Only text is stored; a proposal is replayed to the model as text.
 */
import type { AIAdapter, AIContentBlock, AIMessage, ChatMessage, CoachContext, CoachMode, ProposalStatus, WeightUnit } from "../types";
import { buildSystemPrompt } from "./prompt";
import { PROPOSE_WORKOUT_TOOL, describeProposal, parseProposeWorkout } from "./tools";

export const HISTORY_IN_REQUEST = 12;
export const CHAT_MAX_MESSAGES = 40;
export const CHAT_MAX_BYTES = 24 * 1024;
export const MAX_CALLS = 3;
export const MAX_TOKENS = 700;

export const DEFAULT_PROPOSAL_TEXT = "Here's an adjusted workout for today.";
export const FALLBACK_TEXT = "I didn't catch that. Could you say it another way?";
export const GENERIC_ERROR = "The coach couldn't answer. Try again.";

const CHOICE: Record<ProposalStatus, string> = {
  pending: "hasn't decided",
  applied: "use for today",
  kept: "kept her plan",
  saved: "saved to split",
};

function messageText(m: ChatMessage, unit: WeightUnit): string {
  const text = (m.text ?? "").trim();
  if (m.role !== "assistant" || !m.proposal) return text;
  const replay = `[Proposed for today: ${describeProposal(m.proposal, unit)}; she chose: ${CHOICE[m.proposal.status] ?? CHOICE.pending}]`;
  return text ? `${text}\n${replay}` : replay;
}

/** Append, merging into the previous message when it has the same role. */
function pushMerged(out: { role: "user" | "assistant"; content: string }[], role: "user" | "assistant", text: string) {
  const last = out[out.length - 1];
  if (last && last.role === role) last.content = `${last.content}\n\n${text}`;
  else out.push({ role, content: text });
}

/**
 * Stored chat → model messages: no error bubbles, text only (proposals as
 * a bracketed line), same-role neighbours merged, at most `max` messages,
 * starting with a user message.
 */
export function historyToMessages(history: ChatMessage[], unit: WeightUnit, max = HISTORY_IN_REQUEST): AIMessage[] {
  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history ?? []) {
    if (!m || m.error || (m.role !== "user" && m.role !== "assistant")) continue;
    const text = messageText(m, unit);
    if (text) pushMerged(merged, m.role, text);
  }
  const tail = max > 0 ? merged.slice(-max) : [];
  while (tail.length && tail[0].role !== "user") tail.shift();
  return tail;
}

const bytesOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Keep the last `maxMessages`, then drop the oldest until it fits `maxBytes` (keeps at least the newest one). */
export function trimChat(history: ChatMessage[], maxMessages = CHAT_MAX_MESSAGES, maxBytes = CHAT_MAX_BYTES): ChatMessage[] {
  const out = (history ?? []).slice(-Math.max(1, maxMessages));
  let size = bytesOf(out);
  while (out.length > 1 && size > maxBytes) {
    const dropped = out.shift();
    size -= bytesOf(dropped) + 1; // + the comma
  }
  return out;
}

let seq = 0;
const replyId = (at: number) => `coach-${at.toString(36)}-${(++seq).toString(36)}`;

export async function runCoachTurn(
  deps: { ai: AIAdapter; unit: WeightUnit; now: () => number },
  ctx: CoachContext,
  history: ChatMessage[],
  userText: string,
  mode: CoachMode,
): Promise<{ reply: ChatMessage; error?: { code?: string; message: string } }> {
  const { ai, unit } = deps;
  const text = (userText ?? "").trim();
  const reply = (fields: Omit<ChatMessage, "id" | "role" | "at">): ChatMessage => {
    const at = deps.now();
    return { id: replyId(at), role: "assistant", at, ...fields };
  };
  const fail = (message: string, code?: string) => ({
    reply: reply({ text: message, error: true, ...(code ? { code } : {}) }),
    error: { ...(code ? { code } : {}), message },
  });

  // The caller may already have appended this user message to the history.
  let past = history ?? [];
  const lastMsg = past[past.length - 1];
  if (lastMsg && lastMsg.role === "user" && lastMsg.text.trim() === text) past = past.slice(0, -1);

  const messages: AIMessage[] = historyToMessages(past, unit, HISTORY_IN_REQUEST);
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && typeof last.content === "string") {
    messages[messages.length - 1] = { role: "user", content: `${last.content}\n\n${text}` };
  } else {
    messages.push({ role: "user", content: text });
  }

  const system = buildSystemPrompt(ctx, mode);
  let lastText = "";
  for (let call = 0; call < MAX_CALLS; call++) {
    let res;
    try {
      res = await ai.chat({ system, messages: [...messages], tools: [PROPOSE_WORKOUT_TOOL], max_tokens: MAX_TOKENS });
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      return fail(GENERIC_ERROR, typeof code === "string" ? code : undefined);
    }
    if (!res.ok) return fail(res.message || GENERIC_ERROR, res.code);

    const said = (res.text ?? "").trim();
    if (said) lastText = said;
    const calls = res.toolCalls ?? [];
    const propose = calls.find((c) => c.name === PROPOSE_WORKOUT_TOOL.name);
    if (propose) {
      // The card is the answer: never call the model again after a proposal.
      const p = parseProposeWorkout(propose.input, unit);
      if (!p) return { reply: reply({ text: said || lastText || FALLBACK_TEXT }) };
      return { reply: reply({ text: said || DEFAULT_PROPOSAL_TEXT, proposal: { ...p, status: "pending" } }) };
    }
    if (!calls.length) return { reply: reply({ text: said || lastText || FALLBACK_TEXT }) };

    const results: AIContentBlock[] = calls.map((c) => ({
      type: "tool_result",
      tool_use_id: c.id,
      content: `Unknown tool "${c.name}". The only tool is proposeWorkout; otherwise reply in text.`,
      is_error: true,
    }));
    const content: AIContentBlock[] = res.content?.length
      ? res.content
      : [
          ...(said ? [{ type: "text", text: said } as AIContentBlock] : []),
          ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input }) as AIContentBlock),
        ];
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: results });
  }
  return { reply: reply({ text: lastText || FALLBACK_TEXT }) };
}
