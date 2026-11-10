/**
 * Motion: set pop, exercise spark, finish confetti. Everything checks
 * reducedMotion() (Settings override first, then the OS preference); under
 * reduced motion nothing scales or flies, and the summary only fades.
 */
import { getState } from "../data/state";

export function reducedMotion(): boolean {
  let pref: string | undefined;
  try {
    pref = getState().settings?.reduceMotion;
  } catch {
    pref = undefined;
  }
  if (pref === "reduce") return true;
  if (pref === "full") return false;
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function buzz(): void {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* silent no-op (iOS) */
  }
}

/** Chip pop: 1 → 1.12 → 1 over 180 ms with the pop easing. */
export function pop(el: Element | null | undefined): void {
  if (!el || reducedMotion() || typeof (el as HTMLElement).animate !== "function") return;
  const css = getComputedStyle(document.documentElement);
  const ease = css.getPropertyValue("--ease-pop").trim() || "ease-out";
  (el as HTMLElement).animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], {
    duration: 180,
    easing: ease,
  });
}

/** Brief accent-soft flash on a row (the CSS class carries the animation). */
export function flash(el: Element | null | undefined): void {
  if (!el || reducedMotion()) return;
  el.classList.remove("is-flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 300);
}

function tokenColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  const pick = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
  const accent = pick("--accent", "#ff7a45");
  // Accent twice so the burst reads as "the done color".
  return [accent, accent, pick("--ink", "#f3efe7"), pick("--muted", "#b0a99c"), pick("--surface-3", "#312e29"), pick("--accent-ink", accent)];
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  c: string;
}

export interface BurstOpts {
  count?: number;
  duration?: number;
  /** Spread in radians around straight up. */
  spread?: number;
  speed?: number;
  /** Small square sparks instead of paper strips. */
  spark?: boolean;
}

/** One canvas burst from `origin` (an element or a point); removed when done. */
export function burst(origin: Element | { x: number; y: number }, opts: BurstOpts = {}): void {
  if (reducedMotion()) return;
  const { count = 80, duration = 1200, spread = Math.PI * 1.1, speed = 9, spark = false } = opts;
  let cx: number;
  let cy: number;
  if (origin instanceof Element) {
    const r = origin.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
  } else {
    cx = origin.x;
    cy = origin.y;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  const colors = tokenColors();
  const parts: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const sp = speed * (0.45 + Math.random() * 0.75);
    const size = spark ? 3 + Math.random() * 2 : 0;
    parts.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      w: spark ? size : 6 + Math.random() * 4,
      h: spark ? size : 9 + Math.random() * 6,
      c: colors[i % colors.length],
    });
  }
  const gravity = spark ? 0.22 : 0.3;
  const start = performance.now();
  let last = start;
  const frame = (t: number) => {
    const elapsed = t - start;
    const k = Math.min(3, (t - last) / 16.67);
    last = t;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = elapsed > duration * 0.7 ? Math.max(0, 1 - (elapsed - duration * 0.7) / (duration * 0.3)) : 1;
    for (const p of parts) {
      p.vy += gravity * k;
      p.vx *= 0.985;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.r += p.vr * k;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
  setTimeout(() => canvas.remove(), duration + 600);
}

/** The finish burst from the lower middle of the screen, plus a second smaller one for a PB. */
export function finishConfetti(pb: boolean): void {
  if (reducedMotion()) return;
  const origin = { x: window.innerWidth / 2, y: window.innerHeight * 0.62 };
  burst(origin, { count: 80, duration: 1200, speed: 13 });
  if (pb) setTimeout(() => burst({ x: window.innerWidth / 2, y: window.innerHeight * 0.45 }, { count: 36, duration: 1000, speed: 9 }), 650);
}

/** Exercise done: an 8-piece spark from the last chip. */
export function spark(el: Element | null | undefined): void {
  if (!el) return;
  burst(el, { count: 8, duration: 520, spread: Math.PI * 1.6, speed: 4.5, spark: true });
}
