/** WCAG contrast of the color tokens in both themes (src/ui/styles/tokens.css). */
import { describe, expect, it } from "vitest";

// vitest blanks CSS imports (even ?raw), and the project has no Node types:
// read the file through a variable specifier so tsc types it as any.
const fsName = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync(p: string, enc: string): string };
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const css = readFileSync(`${cwd}/src/ui/styles/tokens.css`, "utf8");

function block(selectorRe: RegExp): Record<string, string> {
  const m = selectorRe.exec(css);
  if (!m) throw new Error(`no block for ${selectorRe}`);
  const start = css.indexOf("{", m.index) + 1;
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const themes = {
  dark: block(/:root\s*,\s*:root\[data-theme="dark"\]\s*\{/),
  light: block(/:root\[data-theme="light"\]\s*\{/),
};

const PAIRS: [fg: string, bg: string][] = [
  ["ink", "bg"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["accent-ink", "bg"],
  ["accent-ink", "surface"],
  ["on-accent", "accent"],
];

describe("token contrast ≥ 4.5:1", () => {
  it("helper sanity: black on white is 21", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  for (const [theme, vars] of Object.entries(themes)) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: ${fg} on ${bg}`, () => {
        const a = vars[fg];
        const b = vars[bg];
        expect(a, `--${fg} missing in ${theme}`).toBeTruthy();
        expect(b, `--${bg} missing in ${theme}`).toBeTruthy();
        const r = contrast(a, b);
        expect(r, `${theme} --${fg} ${a} on --${bg} ${b} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
