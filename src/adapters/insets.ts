/**
 * Safe-area insets from the Flinsh shell.
 *
 * Inside the sandboxed iframe env(safe-area-inset-*) is 0, so the shell
 * provides --flinsh-inset-{top,right,bottom,left} in the frame's stylesheet and
 * posts {__flinsh: "insets", top, right, bottom, left} when they change (e.g.
 * on rotation). The CSS reads --flinsh-inset-* first, then env(), then a
 * minimum padding (see styles/tokens.css and base.css).
 */

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

/** A side's value as a CSS length, or null if it isn't a sane number of px. */
function toPx(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 400) return null;
  return `${Math.round(n * 100) / 100}px`;
}

/** Apply an insets message to :root. Returns the sides it set. */
export function applyInsets(data: unknown, root: HTMLElement = document.documentElement): Side[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (d.__flinsh !== "insets") return [];
  const src = d.insets && typeof d.insets === "object" ? (d.insets as Record<string, unknown>) : d;
  const set: Side[] = [];
  for (const side of SIDES) {
    const px = toPx(src[side]);
    if (px === null) continue;
    root.style.setProperty(`--flinsh-inset-${side}`, px);
    set.push(side);
  }
  return set;
}

/** Listen for inset updates from the parent frame (the shell). Returns a cleanup. */
export function installInsetListener(win: Window = window): () => void {
  const onMessage = (e: MessageEvent) => {
    // Only the shell (our parent) may move the layout.
    if (e.source !== win.parent || win.parent === win) return;
    applyInsets(e.data, win.document.documentElement);
  };
  win.addEventListener("message", onMessage);
  return () => win.removeEventListener("message", onMessage);
}
