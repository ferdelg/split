#!/usr/bin/env node
// Post-build guard for dist/index.html: Flinsh serves this one file into a
// sandboxed iframe with `connect-src 'none'` and `img-src data: blob:`, so it
// must be self-contained, small, and reference no external URLs.
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, process.argv[2] || "dist/index.html");
const MAX_KB = 400;

const ALLOWED_URLS = new Set([
  // The standalone (desktop dev) direct path; blocked by CSP inside Flinsh anyway.
  "https://api.anthropic.com",
  // XML namespace URIs Preact embeds as strings; never fetched.
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/XML/1998/namespace",
]);

const failures = [];
const fail = (m) => failures.push(m);

if (!existsSync(file)) {
  console.error(`check-dist: ${file} is missing. Run \`npx vite build\` first.`);
  process.exit(1);
}

const size = statSync(file).size;
const kb = (size / 1024).toFixed(1);
console.log(`check-dist: ${file} is ${kb} KB (limit ${MAX_KB} KB)`);
if (size >= MAX_KB * 1024) fail(`dist/index.html is ${kb} KB, must be < ${MAX_KB} KB`);

const html = readFileSync(file, "utf8");
const context = (i, len) => html.slice(Math.max(0, i - 60), i + len + 60).replace(/\s+/g, " ");

// 1) Every http(s) URL.
const urlRe = /https?:\/\/[^\s"'`<>)\\]*/g;
const seen = new Map();
for (const m of html.matchAll(urlRe)) {
  const url = m[0];
  if (!seen.has(url)) seen.set(url, { count: 0, at: m.index });
  seen.get(url).count++;
}
if (seen.size) console.log(`check-dist: ${seen.size} unique URL(s):`);
for (const [url, { count, at }] of seen) {
  // Allowed: exact namespace URIs; the Anthropic origin with any path.
  const base = url.replace(/\/+$/, "");
  const ok = ALLOWED_URLS.has(base) || /^https:\/\/api\.anthropic\.com(\/[\w./-]*)?$/.test(url);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${url}  (×${count})  …${context(at, url.length)}…`);
  if (!ok) fail(`external URL not allowed: ${url}`);
}

// 2) External resource patterns.
const patterns = [
  [/<script\b[^>]*\bsrc\s*=/gi, "<script src=…> (scripts must be inline)"],
  [/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi, "<link rel=stylesheet> (styles must be inline)"],
  [/@import\s+url\(/gi, "@import url( (styles must be inline)"],
  [/\bsrc\s*=\s*["']?https?:/gi, 'src="http… (no external media)'],
  [/sourceMappingURL\s*=|[\w-]\.(?:m?js|css)\.map\b/g, "source map reference"],
];
for (const [re, what] of patterns) {
  for (const m of html.matchAll(re)) {
    fail(`${what}: …${context(m.index, m[0].length)}…`);
  }
}

if (failures.length) {
  console.error(`\ncheck-dist: FAILED (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("check-dist: OK");
