/**
 * Write-through cache over a RawStore (flinsh.store, localStorage or memory).
 *
 * - Reads after init are synchronous (peek) from memory.
 * - set() updates memory at once and flushes coalesced: one backend write per
 *   key per flush window, never two writes in flight for the same key.
 * - Values whose JSON exceeds CHUNK_BYTES are split into `<key>.c0..cN` parts
 *   plus a manifest `{ __chunks: n, __v: 1 }` at `<key>`.
 * - Never throws to callers; failures retry with backoff and go to onStatus.
 */
import type { FlinshStoreApi, RawStore, StoreAdapter, StoreBackend, StoreStatus } from "../types";
import { safeLocal } from "./env";

export const CHUNK_BYTES = 120_000;
/** Characters per chunk part: ≤ 3 UTF-8 bytes each keeps a part ≤ 120 KB. */
export const CHUNK_CHARS = 40_000;
const CHUNK_RE = /\.c\d+$/;
const KEY_RE = /^[A-Za-z0-9._\-][A-Za-z0-9._\-/ ]{0,255}$/;
const QUOTA_RE = /quota|larger than|413|too big/i;
const MISSING_RE = /not found|missing|no such|does not exist/i;

export function isValidKey(key: string): boolean {
  return typeof key === "string" && KEY_RE.test(key) && !key.includes("..") && !key.includes("|");
}

function checkKey(key: string): void {
  if (!isValidKey(key)) throw new Error(`invalid store key: ${JSON.stringify(key)}`);
}

const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
export function utf8Bytes(s: string): number {
  if (enc) return enc.encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

/** Split without cutting a surrogate pair in half. */
export function splitJson(json: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < json.length) {
    let end = Math.min(json.length, i + size);
    if (end < json.length) {
      const c = json.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end--;
    }
    parts.push(json.slice(i, end));
    i = end;
  }
  return parts;
}

function isManifest(v: unknown): v is { __chunks: number; __v: 1 } {
  return !!v && typeof v === "object" && typeof (v as { __chunks?: unknown }).__chunks === "number" && (v as { __v?: unknown }).__v === 1;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Raw backends ───────────────────────────────────────────────────────────

function normalizeList(r: unknown): string[] {
  let keys: string[] = [];
  if (Array.isArray(r)) keys = r.map((x) => (typeof x === "string" ? x : (x as { key?: string })?.key)).filter((x): x is string => typeof x === "string");
  else if (r && typeof r === "object" && Array.isArray((r as { keys?: unknown }).keys)) keys = normalizeList((r as { keys: unknown[] }).keys);
  return keys.sort();
}

export function flinshRaw(api: FlinshStoreApi): RawStore {
  return {
    async get(key) {
      checkKey(key);
      const v = await api.get(key);
      return v === undefined ? null : v;
    },
    async set(key, value) {
      checkKey(key);
      return api.set(key, value);
    },
    async delete(key) {
      checkKey(key);
      return !!(await api.delete(key));
    },
    async list(prefix) {
      return normalizeList(await api.list(prefix ?? ""));
    },
  };
}

export function localRaw(prefix = "split/"): RawStore {
  return {
    async get(key) {
      checkKey(key);
      const s = safeLocal.get(prefix + key);
      if (s == null) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      checkKey(key);
      if (!safeLocal.set(prefix + key, JSON.stringify(value))) throw new Error("localStorage quota exceeded or unavailable");
      return { ok: true };
    },
    async delete(key) {
      checkKey(key);
      const had = safeLocal.get(prefix + key) != null;
      safeLocal.remove(prefix + key);
      return had;
    },
    async list(p) {
      const full = prefix + (p ?? "");
      return safeLocal.keys().filter((k) => k.startsWith(full)).map((k) => k.slice(prefix.length)).sort();
    },
  };
}

/** In-memory backend; values are JSON round-tripped like a real backend. */
export function memoryRaw(seed: Record<string, unknown> = {}): RawStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) data.set(k, JSON.stringify(v));
  return {
    data,
    async get(key) {
      checkKey(key);
      const s = data.get(key);
      return s == null ? null : JSON.parse(s);
    },
    async set(key, value) {
      checkKey(key);
      data.set(key, JSON.stringify(value));
      return { ok: true };
    },
    async delete(key) {
      checkKey(key);
      return data.delete(key);
    },
    async list(p) {
      return [...data.keys()].filter((k) => k.startsWith(p ?? "")).sort();
    },
  };
}

// ── Background flush ───────────────────────────────────────────────────────

/**
 * Write pending saves the moment the app is hidden or the page is torn down
 * (visibilitychange→hidden, pagehide), instead of waiting out the coalescing
 * window: iOS may suspend the frame before a 250 ms timer fires. The writes are
 * issued synchronously inside the event handler. Returns a cleanup.
 */
export function installBackgroundFlush(
  store: Pick<StoreAdapter, "flush">,
  win: Window | undefined = typeof window !== "undefined" ? window : undefined,
): () => void {
  if (!win) return () => {};
  const doc = win.document;
  const flushNow = () => {
    try {
      void store.flush().catch(() => {});
    } catch {
      /* never throw from a lifecycle handler */
    }
  };
  const onVis = () => {
    if (doc.visibilityState === "hidden") flushNow();
  };
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("pagehide", flushNow);
  return () => {
    doc.removeEventListener("visibilitychange", onVis);
    win.removeEventListener("pagehide", flushNow);
  };
}

// ── Adapter ────────────────────────────────────────────────────────────────

const TOMBSTONE = Symbol("deleted");

export interface StoreAdapterOptions {
  flushDelayMs?: number;
  retryMs?: number[];
  /** Today's date, so quota recovery never deletes today's chat. */
  today?: () => string;
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** StoreAdapter plus raw key listing (chunk parts included), for delete-all. */
export interface StoreAdapterWithRaw extends StoreAdapter {
  rawList(prefix: string): Promise<string[]>;
}

export function createStoreAdapter(raw: RawStore, backend: StoreBackend, opts: StoreAdapterOptions = {}): StoreAdapterWithRaw {
  const flushDelayMs = opts.flushDelayMs ?? 250;
  const retryMs = opts.retryMs?.length ? opts.retryMs : [1000, 3000, 10000, 30000];
  const today = opts.today ?? localToday;

  const cache = new Map<string, unknown>();
  /** Keys whose last load failed (as opposed to being absent). */
  const failed = new Set<string>();
  /** Known number of chunk parts on the backend per key (0 = not chunked). */
  const chunkCounts = new Map<string, number>();
  const dirty = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  const loading = new Map<string, Promise<unknown>>();
  const listeners = new Set<(s: StoreStatus) => void>();
  let error: string | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const pendingCount = () => new Set([...dirty, ...inflight.keys()]).size;
  let lastSent = "";
  function emit(force = false) {
    const s: StoreStatus = error ? { pending: pendingCount(), error } : { pending: pendingCount() };
    const sig = `${s.pending}|${s.error ?? ""}`;
    if (!force && sig === lastSent) return;
    lastSent = sig;
    for (const l of [...listeners]) {
      try {
        l(s);
      } catch {
        /* a listener must not break the store */
      }
    }
  }

  async function knownChunks(key: string): Promise<number> {
    const n = chunkCounts.get(key);
    if (n !== undefined) return n;
    try {
      const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.c(\\d+)$`);
      let max = 0;
      for (const k of await raw.list(`${key}.c`)) {
        const m = re.exec(k);
        if (m) max = Math.max(max, Number(m[1]) + 1);
      }
      return max;
    } catch {
      return 0;
    }
  }

  async function deleteParts(key: string, from: number, to: number) {
    const jobs: Promise<unknown>[] = [];
    for (let i = from; i < to; i++) jobs.push(raw.delete(`${key}.c${i}`).catch(() => false));
    await Promise.all(jobs);
  }

  async function writeValue(key: string, value: unknown): Promise<void> {
    const old = await knownChunks(key);
    if (value === TOMBSTONE) {
      try {
        await raw.delete(key);
      } catch (e) {
        if (!MISSING_RE.test(errMsg(e))) throw e;
      }
      await deleteParts(key, 0, old);
      chunkCounts.set(key, 0);
      return;
    }
    const json = JSON.stringify(value ?? null);
    if (utf8Bytes(json) > CHUNK_BYTES) {
      const parts = splitJson(json);
      for (let i = 0; i < parts.length; i++) await raw.set(`${key}.c${i}`, parts[i]);
      await raw.set(key, { __chunks: parts.length, __v: 1 });
      chunkCounts.set(key, parts.length);
      if (old > parts.length) await deleteParts(key, parts.length, old);
    } else {
      await raw.set(key, value ?? null);
      chunkCounts.set(key, 0);
      if (old > 0) await deleteParts(key, 0, old);
    }
  }

  /**
   * Quota recovery, cheapest data first: the oldest chat day that isn't
   * today's, then the oldest full photo (its log keeps the 48 px thumb).
   * Logs, the split and settings are never touched.
   */
  async function freeSpace(writingKey: string): Promise<boolean> {
    try {
      const keep = `chat/${today()}`;
      const old = (prefix: string) => raw.list(prefix).then((ks) => ks.filter((k) => !CHUNK_RE.test(k) && k !== keep && k !== writingKey).sort());
      const victim = (await old("chat/"))[0] ?? (writingKey.startsWith("photo/") ? undefined : (await old("photo/"))[0]);
      if (!victim) return false;
      const n = await knownChunks(victim);
      await raw.delete(victim);
      await deleteParts(victim, 0, n);
      cache.delete(victim);
      chunkCounts.set(victim, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function drain(key: string): Promise<void> {
    let freed = 0;
    while (dirty.has(key)) {
      dirty.delete(key);
      const value = cache.has(key) ? cache.get(key) : TOMBSTONE;
      try {
        await writeValue(key, value);
        attempt = 0;
        if (error) {
          error = undefined;
          emit(true);
        }
      } catch (e) {
        dirty.add(key);
        const msg = errMsg(e);
        if (QUOTA_RE.test(msg) && freed < 5 && (await freeSpace(key))) {
          freed++;
          continue;
        }
        error = msg || "store write failed";
        emit(true);
        scheduleRetry();
        return;
      }
    }
  }

  function startKey(key: string): Promise<void> {
    const cur = inflight.get(key);
    if (cur) return cur;
    const p = drain(key).finally(() => {
      inflight.delete(key);
      emit();
    });
    inflight.set(key, p);
    return p;
  }

  function scheduleRetry() {
    if (retryTimer) return;
    const delay = retryMs[Math.min(attempt, retryMs.length - 1)];
    attempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, delay);
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushDelayMs);
  }

  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const jobs = [...dirty].map(startKey);
    emit();
    await Promise.all([...jobs, ...inflight.values()]);
    emit();
  }

  async function fetchKey(key: string): Promise<unknown> {
    const v = await raw.get(key);
    if (isManifest(v)) {
      const parts = await Promise.all(Array.from({ length: v.__chunks }, (_, i) => raw.get(`${key}.c${i}`)));
      if (parts.some((p) => typeof p !== "string")) throw new Error(`missing chunk for ${key}`);
      chunkCounts.set(key, v.__chunks);
      return JSON.parse(parts.join(""));
    }
    chunkCounts.set(key, 0);
    return v === undefined ? null : v;
  }

  async function load<T>(key: string): Promise<T | null> {
    if (cache.has(key)) {
      const v = cache.get(key);
      return v === TOMBSTONE ? null : (v as T);
    }
    if (dirty.has(key) || inflight.has(key)) return null; // pending delete
    let p = loading.get(key);
    if (!p) {
      p = fetchKey(key).then(
        (v) => {
          failed.delete(key);
          if (!cache.has(key) && !dirty.has(key)) cache.set(key, v);
          return v;
        },
        (e) => {
          // Not "missing": the caller must not treat this as empty data and write over it.
          failed.add(key);
          error = `Couldn't load ${key}: ${errMsg(e)}`;
          emit(true);
          return null;
        },
      );
      p.finally(() => loading.delete(key));
      loading.set(key, p);
    }
    await p;
    const v = cache.get(key);
    return v === undefined || v === TOMBSTONE ? null : (v as T);
  }

  async function loadMany<T>(keys: string[]): Promise<Record<string, T | null>> {
    const vals = await Promise.all(keys.map((k) => load<T>(k)));
    const out: Record<string, T | null> = {};
    keys.forEach((k, i) => (out[k] = vals[i]));
    return out;
  }

  return {
    backend,
    async init(preloadKeys) {
      try {
        await loadMany(preloadKeys);
      } catch (e) {
        error = errMsg(e);
        emit(true);
      }
    },
    peek<T>(key: string): T | null {
      const v = cache.get(key);
      return v === undefined || v === TOMBSTONE ? null : (v as T);
    },
    load,
    loadMany,
    set<T>(key: string, value: T) {
      if (!isValidKey(key)) {
        console.warn(`[split] refusing invalid store key ${JSON.stringify(key)}`);
        return;
      }
      cache.set(key, value === undefined ? null : value);
      dirty.add(key);
      emit();
      scheduleFlush();
    },
    async delete(key: string) {
      if (!isValidKey(key)) return;
      cache.set(key, TOMBSTONE);
      dirty.add(key);
      emit();
      await startKey(key);
    },
    async list(prefix: string) {
      let keys: string[] = [];
      try {
        keys = (await raw.list(prefix)).filter((k) => !CHUNK_RE.test(k));
      } catch {
        keys = [];
      }
      const set = new Set(keys);
      for (const [k, v] of cache) {
        if (!k.startsWith(prefix)) continue;
        if (v === TOMBSTONE) set.delete(k);
        else if (dirty.has(k) || inflight.has(k)) set.add(k);
      }
      return [...set].sort();
    },
    flush,
    didFail: (key: string) => failed.has(key),
    rawList: (prefix: string) => raw.list(prefix),
    onStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    cachedBytes() {
      let n = 0;
      for (const v of cache.values()) if (v !== TOMBSTONE) n += JSON.stringify(v ?? null).length;
      return n;
    },
  };
}
