// Shared, dependency-free logic for the test doubles:
//   - an in-memory store with the Flinsh backend's semantics
//     (../Flinch/backend/app/sandbox/app_data.py: clean_key, 256 KB per value,
//     2 MB and 1,000 keys per user scope, list sorted by prefix)
//   - canned Claude replies for flinsh.ai.chat, in the shape the real parent
//     resolves with: the Anthropic Messages response body
//     {id, type:"message", role, model, content, stop_reason, stop_sequence, usage}.
// Used by tests/helpers/mockFlinsh.ts (vitest) and scripts/harness.mjs (Playwright).

export const KEY_RE = /^[A-Za-z0-9._\-][A-Za-z0-9._\-/ ]{0,255}$/;
export const MAX_KEY_LEN = 256;
export const KB = 1024;
export const MB = 1024 * 1024;
export const DEFAULT_LIMITS = { maxValueBytes: 256 * KB, quotaBytes: 2 * MB, maxKeys: 1000 };

const enc = new TextEncoder();
export const utf8Len = (s) => enc.encode(s).length;

/** Mirrors app_data.clean_key: returns the cleaned key or throws Error. */
export function cleanKey(key) {
  if (typeof key !== "string") throw new Error("key must be a string");
  const k = key.trim();
  if (!k) throw new Error("key must not be empty");
  if (k.length > MAX_KEY_LEN) throw new Error(`key is longer than ${MAX_KEY_LEN} characters`);
  if (k.includes("\u0000")) throw new Error("key must not contain NUL");
  if (k.includes("..") || k.startsWith("/") || k.includes("|"))
    throw new Error("key must not contain '..', '|', or a leading '/'");
  if (!KEY_RE.test(k)) throw new Error("key may only contain letters, digits, . _ - / and spaces");
  return k;
}

/** json.dumps(separators=(",",":"), ensure_ascii=False, allow_nan=False). */
export function encodeValue(value) {
  let text;
  try {
    text = JSON.stringify(value === undefined ? null : value, (_k, v) => {
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("nan");
      return v;
    });
  } catch {
    throw new Error("value must be JSON");
  }
  return text;
}

/** Bytes a key/value pair costs against the quota (utf-8 of key + JSON). */
export const entryBytes = (key, value) => utf8Len(key) + utf8Len(encodeValue(value));

/**
 * In-memory backend. `data` is a Map<key, value> (values stored as parsed JSON
 * copies, so callers can't mutate them by reference).
 */
export function createBackend(limits = {}, data = new Map()) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const bytes = new Map();
  for (const [k, v] of data) bytes.set(k, entryBytes(k, v));
  return {
    data,
    limits: L,
    get(key) {
      const k = cleanKey(key);
      return data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null;
    },
    set(key, value) {
      const k = cleanKey(key);
      const text = encodeValue(value);
      if (utf8Len(text) > L.maxValueBytes) throw new Error(`value is larger than ${Math.floor(L.maxValueBytes / KB)} KB`);
      const nbytes = utf8Len(k) + utf8Len(text);
      let others = 0;
      let otherCount = 0;
      for (const [kk, b] of bytes) if (kk !== k) { others += b; otherCount++; }
      if (others + nbytes > L.quotaBytes)
        throw new Error(`storage quota exceeded (${Math.floor(L.quotaBytes / KB)} KB for this user scope)`);
      if (!data.has(k) && otherCount >= L.maxKeys) throw new Error(`too many keys (limit ${L.maxKeys})`);
      data.set(k, JSON.parse(text));
      bytes.set(k, nbytes);
      return { ok: true, key: k, bytes: nbytes };
    },
    delete(key) {
      const k = cleanKey(key);
      bytes.delete(k);
      return data.delete(k);
    },
    list(prefix = "") {
      const p = prefix == null ? "" : String(prefix);
      if (p.length > MAX_KEY_LEN || p.includes("\u0000")) throw new Error("prefix is too long or invalid");
      return [...data.keys()].filter((k) => k.startsWith(p)).sort();
    },
    usedBytes() {
      let n = 0;
      for (const b of bytes.values()) n += b;
      return n;
    },
  };
}

// ── Canned AI (Anthropic Messages response bodies) ──────────────────────────

let msgSeq = 0;
export const CANNED_MODEL = "claude-sonnet-5-5";

/** A Messages response body from content blocks. */
export function messageBody(content, stopReason) {
  msgSeq++;
  const out = content.reduce((n, b) => n + JSON.stringify(b).length, 0);
  return {
    id: `msg_canned_${msgSeq}`,
    type: "message",
    role: "assistant",
    model: CANNED_MODEL,
    content,
    stop_reason: stopReason ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: Math.max(1, Math.round(out / 4)) },
  };
}

/** A plain text reply. */
export function textReply(text) {
  return messageBody([{ type: "text", text }], "end_turn");
}

/** A reply that calls one tool (optionally after some text). */
export function toolReply(name, input, text, id) {
  const content = [];
  if (text) content.push({ type: "text", text });
  content.push({ type: "tool_use", id: id ?? `toolu_canned_${msgSeq + 1}`, name, input });
  return messageBody(content, "tool_use");
}

/** The proposal the canned coach makes (a shorter, 3-exercise workout). */
export const CANNED_PROPOSAL = {
  title: "Short full body",
  exercises: [
    { name: "Goblet squat", sets: 3, reps: "8-10", weight: 40 },
    { name: "Push-up", sets: 3, reps: "8-10" },
    { name: "Dumbbell row", sets: 3, reps: "8-10", weight: 35 },
  ],
  reason: "Three moves, about 30 minutes, still hits legs, push and pull.",
};

export const CANNED = {
  proposalText: "Here's a shorter version for today.",
  chatDefault: "Nice work showing up. Want me to tweak today's plan?",
  afterToolResult: "Got it. Let me know if you want a different plan.",
};

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && b.type === "text" ? b.text : "")).join(" ");
}

function hasToolResult(msg) {
  return !!msg && Array.isArray(msg.content) && msg.content.some((b) => b && b.type === "tool_result");
}

/** The latest user TEXT in a request (tool_result-only messages are skipped). */
export function latestUserText(req) {
  const msgs = Array.isArray(req && req.messages) ? req.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== "user") continue;
    const t = textOf(m.content).trim();
    if (t) return t;
  }
  return "";
}

/** True when the system prompt is the "Plan today" mode prompt. */
export function isPlanTodayPrompt(system) {
  const s = typeof system === "string" ? system : textOf(system);
  return /mode:\s*plan[- ]today/i.test(s);
}

/** Classify a request the way the canned replies do. Exported for tests. */
export function classify(req) {
  const msgs = Array.isArray(req && req.messages) ? req.messages : [];
  if (hasToolResult(msgs[msgs.length - 1])) return "after-tool";
  const t = latestUserText(req).toLowerCase();
  if (/\bshort|30 ?min|thirty minutes|tired/.test(t) || isPlanTodayPrompt(req && req.system)) return "propose";
  return "chat";
}

/** Canned reply: a Messages body. proposeWorkout only if the tool was offered. */
export function cannedAi(req) {
  const kind = classify(req);
  if (kind === "after-tool") return textReply(CANNED.afterToolResult);
  const offered = Array.isArray(req && req.tools) && req.tools.some((t) => t && t.name === "proposeWorkout");
  if (kind === "propose" && offered) return toolReply("proposeWorkout", structuredClone(CANNED_PROPOSAL), CANNED.proposalText);
  return textReply(CANNED.chatDefault);
}

/** An Error carrying a flinsh.ai code, as the real bridge rejects with. */
export function aiError(code, message) {
  const e = new Error(message ?? `flinsh.ai: ${code}`);
  e.code = code;
  return e;
}
