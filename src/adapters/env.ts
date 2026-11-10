/** Where are we running? Inside Flinsh (window.flinsh) or standalone. */
import type { FlinshBridge } from "../types";

export function isInFlinsh(): boolean {
  try {
    return typeof window !== "undefined" && !!window.flinsh;
  } catch {
    return false;
  }
}

/** Resolves window.flinsh now, on "flinsh:ready", or null after the timeout. */
export function waitForBridge(timeoutMs = 400): Promise<FlinshBridge | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.flinsh) return Promise.resolve(window.flinsh);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: FlinshBridge | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("flinsh:ready", onReady);
      clearTimeout(timer);
      resolve(v);
    };
    const onReady = () => finish(window.flinsh ?? null);
    window.addEventListener("flinsh:ready", onReady);
    const timer = setTimeout(() => finish(window.flinsh ?? null), timeoutMs);
  });
}

/**
 * localStorage that never throws. Inside the Flinsh iframe the origin is
 * opaque and merely touching window.localStorage raises a SecurityError.
 */
function ls(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const safeLocal = {
  get(k: string): string | null {
    try {
      return ls()?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  set(k: string, v: string): boolean {
    try {
      const s = ls();
      if (!s) return false;
      s.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  remove(k: string): void {
    try {
      ls()?.removeItem(k);
    } catch {
      /* ignore */
    }
  },
  available(): boolean {
    try {
      const s = ls();
      if (!s) return false;
      const probe = "__split_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },
  /** All keys (for localRaw.list). */
  keys(): string[] {
    try {
      const s = ls();
      if (!s) return [];
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k != null) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
};
