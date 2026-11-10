// Shared vitest setup. Keep this tiny; per-test mocks live in tests/helpers.
// jsdom lacks a few browser APIs the UI touches; stub them (only when absent).
import { beforeEach } from "vitest";

// Node ≥ 22 ships its own global localStorage (broken without
// --localstorage-file: methods missing, warnings) that shadows jsdom's.
// Install a spec-shaped in-memory Storage on window and globalThis, reset
// before each test.
class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  get length() {
    return this.#m.size;
  }
  clear() {
    this.#m.clear();
  }
  getItem(k: string) {
    return this.#m.has(String(k)) ? this.#m.get(String(k))! : null;
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.#m.delete(String(k));
  }
  setItem(k: string, v: string) {
    this.#m.set(String(k), String(v));
  }
  [name: string]: unknown;
}

const memLocal = new MemoryStorage();
const memSession = new MemoryStorage();
for (const target of [globalThis, typeof window !== "undefined" ? window : null]) {
  if (!target) continue;
  Object.defineProperty(target, "localStorage", { configurable: true, get: () => memLocal });
  Object.defineProperty(target, "sessionStorage", { configurable: true, get: () => memSession });
}
beforeEach(() => {
  memLocal.clear();
  memSession.clear();
});

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function () {} as Element["scrollTo"];
  }
  if (typeof HTMLCanvasElement !== "undefined") {
    // jsdom's getContext logs "not implemented" and returns null; return null quietly.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
    window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  }
}
