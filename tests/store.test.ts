/** The write-through store adapter (src/adapters/store.ts) over raw backends. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreStatus } from "../src/types";
import { createStoreAdapter, flinshRaw, installBackgroundFlush, memoryRaw } from "../src/adapters/store";
import { createMockFlinsh } from "./helpers/mockFlinsh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("store adapter", () => {
  it("init preloads; missing keys are null; peek is synchronous", async () => {
    const raw = memoryRaw({ profile: { name: "Magdalena" }, "logs/2026-11": { month: "2026-11", days: {} } });
    const get = vi.spyOn(raw, "get");
    const s = createStoreAdapter(raw, "memory");
    await s.init(["profile", "settings", "logs/2026-11"]);
    expect(s.peek("profile")).toEqual({ name: "Magdalena" });
    expect(s.peek("settings")).toBeNull();
    expect(s.peek("logs/2026-11")).toEqual({ month: "2026-11", days: {} });
    const n = get.mock.calls.length;
    expect(await s.load("profile")).toEqual({ name: "Magdalena" });
    expect(get.mock.calls.length).toBe(n); // served from the cache
  });

  it("preloads through the Flinsh bridge too", async () => {
    const m = createMockFlinsh({ seed: { splits: { activeId: "a" } } });
    const s = createStoreAdapter(flinshRaw(m.bridge.store), "flinsh");
    await s.init(["splits", "active"]);
    expect(s.peek("splits")).toEqual({ activeId: "a" });
    expect(s.peek("active")).toBeNull();
  });

  it("coalesces many sets of one key into one write with the latest value (250 ms)", async () => {
    const raw = memoryRaw();
    const spy = vi.spyOn(raw, "set");
    const s = createStoreAdapter(raw, "memory");
    for (let i = 0; i < 10; i++) s.set("active", { sets: i });
    expect(s.peek("active")).toEqual({ sets: 9 });
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(raw.data.get("active")!)).toEqual({ sets: 9 });
  });

  it("flushes at once when the page is hidden (visibilitychange) or torn down (pagehide)", async () => {
    const raw = memoryRaw();
    const s = createStoreAdapter(raw, "memory");
    const off = installBackgroundFlush(s, window);
    let vis: DocumentVisibilityState = "visible";
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
    try {
      s.set("active", { a: 1 });
      document.dispatchEvent(new Event("visibilitychange")); // still visible: no flush
      await vi.advanceTimersByTimeAsync(0);
      expect(raw.data.has("active")).toBe(false);
      vis = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0); // microtasks only, well under 250 ms
      expect(JSON.parse(raw.data.get("active")!)).toEqual({ a: 1 });

      s.set("active", { a: 2 });
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.parse(raw.data.get("active")!)).toEqual({ a: 2 });
    } finally {
      off();
      delete (document as unknown as { visibilityState?: unknown }).visibilityState;
      if (desc) Object.defineProperty(Document.prototype, "visibilityState", desc);
    }
  });

  it("retries failed writes with backoff; status shows the error, then clears", async () => {
    const m = createMockFlinsh();
    m.failNext("set", 2, "timed out");
    const s = createStoreAdapter(flinshRaw(m.bridge.store), "flinsh", { retryMs: [1000, 3000] });
    const seen: StoreStatus[] = [];
    s.onStatus((st) => seen.push(st));
    s.set("profile", { name: "M" });
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.some((x) => x.error === "timed out")).toBe(true);
    expect(m.storeData.has("profile")).toBe(false);
    expect(s.peek("profile")).toEqual({ name: "M" }); // memory keeps it meanwhile
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.storeData.has("profile")).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(m.storeData.get("profile")).toEqual({ name: "M" });
    const last = seen[seen.length - 1];
    expect(last.error).toBeUndefined();
    expect(last.pending).toBe(0);
  });

  it("never throws to callers, refuses keys Flinsh would reject", async () => {
    const m = createMockFlinsh();
    const s = createStoreAdapter(flinshRaw(m.bridge.store), "flinsh");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => s.set("logs:2026-11", 1)).not.toThrow();
    s.set("logs/2026-11", { month: "2026-11", days: {} });
    await s.flush();
    expect([...m.storeData.keys()]).toEqual(["logs/2026-11"]);
    warn.mockRestore();
  });

  it("delete removes from memory and backend; list merges pending writes", async () => {
    const m = createMockFlinsh({ seed: { "chat/2026-11-01": [], "chat/2026-11-02": [] } });
    const s = createStoreAdapter(flinshRaw(m.bridge.store), "flinsh");
    await s.init([]);
    s.set("chat/2026-11-10", [{ id: "1" }]);
    expect(await s.list("chat/")).toEqual(["chat/2026-11-01", "chat/2026-11-02", "chat/2026-11-10"]);
    await s.delete("chat/2026-11-01");
    expect(m.storeData.has("chat/2026-11-01")).toBe(false);
    expect(await s.list("chat/")).toEqual(["chat/2026-11-02", "chat/2026-11-10"]);
    expect(s.peek("chat/2026-11-01")).toBeNull();
  });
});
