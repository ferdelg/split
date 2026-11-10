/**
 * AI adapter: flinsh.ai.chat (the shell's proxy) → direct Anthropic with the
 * owner's key (standalone only) → none.
 *
 * The direct path is a raw fetch to the Messages endpoint (no SDK: bundle
 * size). The key lives only in localStorage under "split.apiKey", never in the
 * store, and is never read or written inside Flinsh.
 */
import type { AIAdapter, AIContentBlock, AIFailure, AIMode, AIRequest, AIResponse, AIToolCall, FlinshBridge } from "../types";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const API_KEY_STORAGE = "split.apiKey";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const MSG = {
  notConfiguredStandalone: "Add an Anthropic API key in Me → Settings to turn on the coach.",
  notConfiguredFlinsh: "The coach needs Flinsh's AI connection, which isn't available here. Everything else works.",
  noKeyFlinsh: "Add your Anthropic key in Flinsh Settings to turn on the coach",
  catchingBreath: "The coach is catching its breath. Try again in a bit.",
  office: "Your office has turned off AI for apps.",
  network: "Couldn't reach the coach. Check your connection and try again.",
  auth: "Your API key was rejected. Check it in Me → Settings.",
  refused: "I can't help with that one. Try asking a different way.",
  error: "The coach couldn't answer. Try again.",
};

const inFlinsh = () => {
  try {
    return typeof window !== "undefined" && !!window.flinsh;
  } catch {
    return false;
  }
};

/**
 * What she sees for a coach failure. A flinsh.ai `code` wins (PLAN "Errors");
 * otherwise the adapter's failure reason decides.
 */
export function coachErrorMessage(code: string | undefined, reason: AIFailure): string {
  if (code) {
    switch (code) {
      case "no_ai_key":
        return MSG.noKeyFlinsh;
      case "rate_limited":
      case "ai_budget_exceeded":
        return MSG.catchingBreath;
      case "ai_disabled_by_office":
        return MSG.office;
      default:
        return `${MSG.error} (${code})`;
    }
  }
  switch (reason) {
    case "not_configured":
      return inFlinsh() ? MSG.notConfiguredFlinsh : MSG.notConfiguredStandalone;
    case "no_key":
      return inFlinsh() ? MSG.noKeyFlinsh : MSG.notConfiguredStandalone;
    case "network":
      return MSG.network;
    case "auth":
      return MSG.auth;
    case "rate_limit":
      return MSG.catchingBreath;
    case "refused":
      return MSG.refused;
    default:
      return MSG.error;
  }
}

function fail(reason: AIFailure, code?: string): AIResponse {
  const message = coachErrorMessage(code, reason);
  return code ? { ok: false, reason, code, message } : { ok: false, reason, message };
}

export function getApiKey(): string | null {
  if (inFlinsh()) return null;
  try {
    const v = window.localStorage.getItem(API_KEY_STORAGE);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  if (inFlinsh()) return;
  try {
    const k = key?.trim();
    if (k) window.localStorage.setItem(API_KEY_STORAGE, k);
    else window.localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* storage blocked (opaque origin): nothing to do */
  }
}

/** Models that get the current-API extras (effort, fallbacks, thinking mode). */
const isSonnet55 = (m: string) => m === "claude-sonnet-5-5";
const isOpus55 = (m: string) => m === "claude-opus-5-5";
const usesFallbacks = (m: string) => isSonnet55(m) || isOpus55(m);

export function buildAnthropicBody(req: AIRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.max_tokens ?? 1024,
    system: req.system,
    messages: req.messages,
  };
  if (req.tools && req.tools.length) body.tools = req.tools;
  if (isSonnet55(model)) {
    // Fast chat: no thinking before the first reply; accepted only at effort ≤ high.
    body.thinking = { type: "between_tools" };
    body.output_config = { effort: "low" };
  } else if (isOpus55(model)) {
    body.output_config = { effort: "low" };
  }
  if (usesFallbacks(model)) body.fallbacks = "default";
  return body;
}

export function buildAnthropicHeaders(key: string, model: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (usesFallbacks(model)) h["anthropic-beta"] = FALLBACK_BETA;
  return h;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function fromContent(content: AIContentBlock[], stopReason: string): AIResponse {
  const texts: string[] = [];
  const toolCalls: AIToolCall[] = [];
  for (const b of content) {
    if (!isObj(b)) return fail("bad_response");
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      toolCalls.push({ id: b.id, name: b.name, input: isObj(b.input) ? b.input : {} });
    }
  }
  return { ok: true, text: texts.join("\n\n").trim(), toolCalls, content, stopReason };
}

/** Parse an Anthropic Messages response body (what both paths return). */
export function parseAnthropicResponse(json: unknown): AIResponse {
  if (!isObj(json)) return fail("bad_response");
  const stopReason = typeof json.stop_reason === "string" ? json.stop_reason : "";
  if (stopReason === "refusal") return fail("refused");
  if (!Array.isArray(json.content)) return fail("bad_response");
  return fromContent(json.content as AIContentBlock[], stopReason || "end_turn");
}

/** The structured error code flinsh.ai.chat rejects with, if any. */
export function flinshErrorCode(e: unknown): string | null {
  if (!isObj(e) && !(e instanceof Error)) return null;
  const c = (e as { code?: unknown }).code;
  return typeof c === "string" && c ? c : null;
}

/** Map a flinsh.ai error code to a failure. */
export function fromFlinshError(code: string): AIResponse {
  switch (code) {
    case "no_ai_key":
      return fail("no_key", code);
    case "rate_limited":
    case "ai_budget_exceeded":
      return fail("rate_limit", code);
    case "permission_denied":
      return fail("auth", code);
    case "timeout":
      return fail("network", code);
    case "ai_disabled_by_office":
      return fail("refused", code);
    default:
      return fail("error", code);
  }
}

async function httpFailure(res: Response): Promise<AIResponse> {
  if (res.status === 401 || res.status === 403) return fail("auth");
  if (res.status === 429 || res.status === 529) return fail("rate_limit");
  let detail = "";
  try {
    const j = (await res.json()) as { error?: { message?: unknown } };
    if (typeof j?.error?.message === "string") detail = j.error.message;
  } catch {
    /* non-JSON error body */
  }
  return { ok: false, reason: "error", message: detail ? `${MSG.error} (${detail})` : MSG.error };
}

/**
 * `bridge`: the bridge initApp resolved (tests inject a mock). When omitted,
 * window.flinsh is consulted at call time.
 */
export function createAIAdapter(opts: { getModel: () => string; fetchImpl?: typeof fetch; bridge?: FlinshBridge | null }): AIAdapter {
  const currentBridge = (): FlinshBridge | null => {
    if (opts.bridge !== undefined) return opts.bridge;
    try {
      return typeof window !== "undefined" ? window.flinsh ?? null : null;
    } catch {
      return null;
    }
  };
  const bridgeChat = () => {
    const ai = currentBridge()?.ai;
    return ai && typeof ai.chat === "function" ? ai : null;
  };
  const model = () => opts.getModel() || DEFAULT_MODEL;

  const mode = (): AIMode => {
    if (bridgeChat()) return "flinsh";
    if (!currentBridge() && !inFlinsh() && getApiKey()) return "direct";
    return "none";
  };

  async function chat(req: AIRequest): Promise<AIResponse> {
    const m = mode();
    if (m === "flinsh") {
      // Accepted fields: model, system, messages, tools, tool_choice, max_tokens,
      // thinking. tool_choice must stay "auto", so it's omitted.
      const request: Record<string, unknown> = { model: model(), system: req.system, messages: req.messages, max_tokens: req.max_tokens ?? 1024 };
      if (req.tools && req.tools.length) request.tools = req.tools;
      try {
        return parseAnthropicResponse(await bridgeChat()!.chat(request));
      } catch (e) {
        const code = flinshErrorCode(e);
        if (code) return fromFlinshError(code);
        const msg = e instanceof Error ? e.message : "";
        return /network|timeout|timed out|fetch|offline/i.test(msg) ? fail("network") : fail("error");
      }
    }
    if (m === "direct") {
      const key = getApiKey()!;
      const mdl = model();
      const doFetch = opts.fetchImpl ?? globalThis.fetch;
      let res: Response;
      try {
        res = await doFetch(ANTHROPIC_URL, {
          method: "POST",
          headers: buildAnthropicHeaders(key, mdl),
          body: JSON.stringify(buildAnthropicBody(req, mdl)),
        });
      } catch {
        return fail("network");
      }
      if (!res.ok) return httpFailure(res);
      try {
        return parseAnthropicResponse(await res.json());
      } catch {
        return fail("bad_response");
      }
    }
    return { ok: false, reason: "not_configured", message: currentBridge() || inFlinsh() ? MSG.notConfiguredFlinsh : MSG.notConfiguredStandalone };
  }

  return { mode, chat };
}
