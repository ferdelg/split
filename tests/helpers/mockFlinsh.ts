/**
 * A window.flinsh double with the real backend's store semantics
 * (../Flinch/backend/app/sandbox/app_data.py) and a scriptable `ai.chat`
 * that resolves with Anthropic Messages bodies and rejects with an Error
 * carrying `.code` (as ../Flinch/web/src/lib/miniAppSandbox.ts does).
 * `notifications` (PROPOSED API) is opt-in; `files` is never present, so the
 * app exercises its inline photo mode. Shared logic lives in
 * scripts/harness/canned.mjs so the Playwright harness answers the same way.
 */
import type { AIRequest, FlinshBridge, ScheduledReminder } from "../../src/types";
import { aiError, cannedAi, createBackend, type Limits, type MessageBody } from "../../scripts/harness/canned.mjs";

export type StoreOp = "get" | "set" | "delete" | "list";
export type FailOp = StoreOp | "ai";
/** A reply (Messages body, possibly partial), or an Error to reject with. */
export type AiReply = Partial<MessageBody> | Record<string, unknown> | Error;
export type AiScript = ((req: AIRequest) => AiReply | Promise<AiReply>) | AiReply[];

export interface MockFlinshOptions {
  /** Seed store values. */
  seed?: Record<string, unknown>;
  limits?: Partial<Limits>;
  /** Delay per call in ms; 0 = resolve on a microtask. */
  delayMs?: number;
  /** false = no ai member; a function or queue = scripted; default = canned. */
  ai?: false | "canned" | AiScript;
  /** Add the PROPOSED flinsh.notifications API. */
  notifications?: boolean;
  input?: Record<string, unknown>;
}

export interface MockCalls {
  store: { op: StoreOp; key?: string; prefix?: string; value?: unknown }[];
  ai: AIRequest[];
  notifications: { op: "schedule" | "cancel" | "list"; arg?: unknown }[];
  ready: number;
}

export function createMockFlinsh(opts: MockFlinshOptions = {}) {
  const storeData = new Map<string, unknown>(Object.entries(opts.seed ?? {}).map(([k, v]) => [k, structuredClone(v)]));
  const backend = createBackend(opts.limits, storeData);
  const calls: MockCalls = { store: [], ai: [], notifications: [], ready: 0 };
  const failures = new Map<FailOp, { n: number; message: string; code?: string }>();
  const delayMs = opts.delayMs ?? 0;
  let aiScript: AiScript | null = opts.ai === undefined || opts.ai === "canned" || opts.ai === false ? null : opts.ai;

  const wait = () => (delayMs > 0 ? new Promise<void>((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const maybeFail = (op: FailOp) => {
    const f = failures.get(op);
    if (f && f.n > 0) {
      f.n--;
      if (f.n === 0) failures.delete(op);
      throw f.code ? aiError(f.code, f.message) : new Error(f.message);
    }
  };
  // Every result crosses postMessage in real life: structured-clone it.
  const run = async <T>(op: FailOp, fn: () => T): Promise<T> => {
    await wait();
    maybeFail(op);
    return structuredClone(fn());
  };

  const bridge: FlinshBridge = {
    input: opts.input ?? {},
    ready: () => void calls.ready++,
    done: () => {},
    resize: () => {},
    store: {
      get: (key) => (calls.store.push({ op: "get", key }), run("get", () => backend.get(key))),
      set: (key, value) => {
        calls.store.push({ op: "set", key, value });
        // postMessage would throw DataCloneError synchronously on functions etc.
        const cloned = structuredClone(value);
        return run("set", () => backend.set(key, cloned));
      },
      delete: (key) => (calls.store.push({ op: "delete", key }), run("delete", () => backend.delete(key))),
      list: (prefix) => (calls.store.push({ op: "list", prefix }), run("list", () => backend.list(prefix ?? ""))),
    },
  };

  if (opts.ai !== false) {
    bridge.ai = {
      chat: async (req) => {
        calls.ai.push(structuredClone(req) as unknown as AIRequest);
        await wait();
        maybeFail("ai");
        let out: AiReply;
        if (!aiScript) out = cannedAi(req as unknown as AIRequest);
        else if (typeof aiScript === "function") out = await aiScript(req as unknown as AIRequest);
        else {
          const next = aiScript.shift();
          if (!next) throw aiError("ai_error", "mock ai: response queue empty");
          out = next;
        }
        if (out instanceof Error) throw out;
        return structuredClone(out);
      },
    };
  }

  let scheduled: ScheduledReminder[] = [];
  if (opts.notifications) {
    bridge.notifications = {
      schedule: async (list) => {
        calls.notifications.push({ op: "schedule", arg: structuredClone(list) });
        scheduled = structuredClone(list);
        return { ok: true };
      },
      cancel: async (ids) => {
        calls.notifications.push({ op: "cancel", arg: ids });
        scheduled = scheduled.filter((r) => !ids.includes(r.id));
        return { ok: true };
      },
      list: async () => (calls.notifications.push({ op: "list" }), structuredClone(scheduled)),
    };
  }

  return {
    bridge,
    storeData,
    backend,
    calls,
    scheduled: () => scheduled,
    /** The next `n` calls of `op` reject with `message` (and `code`, for ai). */
    failNext(op: FailOp, n = 1, message = "mock failure", code?: string) {
      failures.set(op, { n, message, code });
    },
    /** Every following ai.chat rejects with this code (null = back to the script). */
    setAiScript(script: AiScript | null) {
      aiScript = script;
    },
    /** Shorthand: every ai.chat rejects with `code` until reset with setAiScript(null). */
    aiRejects(code: string) {
      aiScript = () => aiError(code, `flinsh.ai: ${code}`);
    },
  };
}

export type MockFlinsh = ReturnType<typeof createMockFlinsh>;
