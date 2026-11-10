/**
 * Keep the screen on during a workout (navigator.wakeLock). Silent when it
 * isn't supported or the request is refused (e.g. inside a sandboxed iframe
 * without the permission). The browser drops the lock when the page is
 * hidden, so while "held" we re-acquire on visibilitychange → visible.
 */

interface SentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", fn: () => void): void;
}

interface WakeLockApi {
  request(type: "screen"): Promise<SentinelLike>;
}

function api(): WakeLockApi | null {
  try {
    const wl = (typeof navigator !== "undefined" ? (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock : undefined) ?? null;
    return wl && typeof wl.request === "function" ? wl : null;
  } catch {
    return null;
  }
}

export function wakeLockSupported(): boolean {
  return !!api();
}

/**
 * What actually happened, for Me → Capabilities (the API existing doesn't mean
 * the frame may use it: a sandboxed iframe needs the screen-wake-lock policy).
 */
export type WakeLockStatus = "unsupported" | "untested" | "on" | "blocked";

export function initialWakeLockStatus(): WakeLockStatus {
  return wakeLockSupported() ? "untested" : "unsupported";
}

export function createWakeLock(onStatus: (s: WakeLockStatus) => void = () => {}): { acquire(): Promise<void>; release(): Promise<void> } {
  let held = false;
  let sentinel: SentinelLike | null = null;
  let listening = false;

  const request = async () => {
    const wl = api();
    if (!wl || sentinel) return;
    try {
      const s = await wl.request("screen");
      if (!held) {
        // released while the request was pending
        void s.release().catch(() => {});
        return;
      }
      sentinel = s;
      onStatus("on");
      s.addEventListener?.("release", () => {
        if (sentinel === s) sentinel = null;
      });
    } catch (e) {
      // Hidden pages can't hold a lock (that's retried on visible); anything else is a refusal.
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (!hidden) onStatus("blocked");
      void e; /* the workout works the same, the screen may dim */
    }
  };

  const onVisible = () => {
    try {
      if (held && document.visibilityState === "visible") void request();
    } catch {
      /* ignore */
    }
  };

  return {
    async acquire() {
      held = true;
      if (!listening && typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisible);
        listening = true;
      }
      await request();
    },
    async release() {
      held = false;
      if (listening && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
        listening = false;
      }
      const s = sentinel;
      sentinel = null;
      if (s) {
        try {
          await s.release();
        } catch {
          /* already released */
        }
      }
    },
  };
}
