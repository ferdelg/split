#!/usr/bin/env node
// Real-sandbox verification for dist/index.html.
//
// Loads the built app the way Flinsh does (scripts/harness/sandboxDoc.mjs:
// sandbox="allow-scripts allow-forms", CSP meta first, theme, insets, the
// platform's own window.flinsh bridge compiled from
// ../Flinch/web/src/lib/miniAppSandbox.ts, then our HTML), answers the bridge
// from Node with the backend's store semantics and canned Claude replies
// (scripts/harness/canned.mjs), and in Chromium and WebKit:
//   sandbox  the frame's sandbox attribute and CSP are exactly Flinsh's
//   flow     onboarding → split edit → today (weight change) → finish →
//            calendar → coach proposal applied, asserting the store
//   noai     the same app with ai.chat rejecting {code:"no_ai_key"}
//   layout   screenshots (390×844, 430×932 × dark/light) of every tab, an
//            active workout and the summary, plus a layout probe
// Each section also checks: zero console errors, CSP violations, page errors
// and network requests. Exit code 1 on any failure.
//
// The app clock is pinned with Playwright's clock to Tue 2026-11-10 18:00
// America/New_York (a workout day in "4-day upper/lower"); time then flows.
//
//   npx vite build && node scripts/harness.mjs [--only=chromium|webkit] [--no-layout] [--no-flow] [--headed]
import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createBackend, cannedAi, CANNED_PROPOSAL } from "./harness/canned.mjs";
import { EXPECTED_CSP, buildParentPage, buildSrcdoc, loadPlatform } from "./harness/sandboxDoc.mjs";
import { probeLayout } from "./harness/layout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const argVal = (name) => [...args].find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const ONLY = argVal("only");
const HEADED = args.has("--headed");
const INSETS = { top: 47, right: 0, bottom: 34, left: 0 };
const TABS = ["Today", "Split", "Calendar", "Coach", "Me"];
const SHOTS = resolve(root, "test-results/harness");
const API_KEY_MARKER = "sk-ant-";
const TZ = "America/New_York";
const CLOCK = new Date("2026-11-10T18:00:00-05:00");
// Layout runs start from the flow's store, which ends mid-workout on the 11th.
const LAYOUT_CLOCK = new Date("2026-11-11T18:00:00-05:00");
const TODAY = "2026-11-10";
// The coach step runs the next day: a proposal can't replace a workout that is already logged.
const TOMORROW = "2026-11-11";
const NO_AI_TEXT = "Add your Anthropic key in Flinsh Settings to turn on the coach";

// ── the build + the platform ─────────────────────────────────────────────────
const distPath = resolve(root, argVal("dist") || "dist/index.html");
if (!existsSync(distPath)) {
  console.error("harness: dist/index.html is missing. Run `npx vite build` first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(resolve(root, "flinsh.json"), "utf8"));
const PERMS = manifest.permissions || [];
const platform = await loadPlatform();
const SANDBOX = platform.miniAppSandbox ? platform.miniAppSandbox(PERMS) : platform.MINI_APP_SANDBOX;
const CSP = platform.buildMiniAppCsp ? platform.buildMiniAppCsp(PERMS) : EXPECTED_CSP;
const distHtml = readFileSync(distPath, "utf8");
const SRCDOC = buildSrcdoc(platform, distHtml, { permissions: PERMS });
console.log(`harness: bridge from ${platform.source}`);
console.log(`harness: sandbox="${SANDBOX}"\nharness: CSP ${CSP}`);
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith(".png")) rmSync(resolve(SHOTS, f));

// ── results ──────────────────────────────────────────────────────────────────
const results = []; // { browser, section, name, ok, detail }
const record = (browser, section, name, ok, detail = "") => {
  results.push({ browser, section, name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} [${browser}] ${section}: ${name}${detail ? ` — ${detail}` : ""}`);
};
record("-", "sandbox", `sandbox attribute is "allow-scripts allow-forms"`, SANDBOX === "allow-scripts allow-forms", SANDBOX);
record("-", "sandbox", "CSP is the Flinsh CSP", CSP === EXPECTED_CSP, CSP === EXPECTED_CSP ? "" : CSP);
record("-", "sandbox", "srcdoc starts with the CSP meta", SRCDOC.startsWith(`<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP}">`));
record("-", "sandbox", "bridge exposes flinsh.ai.chat (manifest declares ai)", SRCDOC.includes("window.flinsh.ai={chat:"));
record("-", "sandbox", "no flinsh.files / flinsh.notifications in the frame", !/flinsh\.(files|notifications)\s*=/.test(SRCDOC));

// ── one sandboxed session ────────────────────────────────────────────────────
const AI_FIELDS = ["model", "system", "messages", "tools", "tool_choice", "max_tokens", "temperature", "thinking"];

async function openSession(browserType, ctxOpts, seed, { aiCode = null, clock = CLOCK } = {}) {
  const browser = await browserType.launch({ headless: !HEADED, ...(LAUNCH[browserType.name()] || {}) });
  const context = await browser.newContext({ timezoneId: TZ, locale: "en-US", ...ctxOpts });
  const page = await context.newPage();
  await page.clock.install({ time: clock });
  const backend = createBackend({}, new Map(Object.entries(seed ? structuredClone(seed) : {})));
  const problems = { console: [], csp: [], pageErrors: [], network: [], foreign: 0 };
  const aiCalls = [];
  const aiFail = { code: aiCode };

  await page.exposeFunction("__hStore", async (d) => {
    // == Flinsh handleStoreRequest, permitted = ["user"]
    const ops = ["get", "set", "list", "delete"];
    const scope = d.scope ?? "user";
    const p = d.payload && typeof d.payload === "object" ? d.payload : {};
    if (!ops.includes(d.op)) return { error: "unsupported store operation" };
    if (!["user", "app", "office"].includes(scope)) return { error: "unknown store scope" };
    if (scope !== "user") return { error: `this app's flinsh.json does not declare "store:${scope}"` };
    try {
      const key = String(p.key ?? "");
      const result =
        d.op === "get" ? backend.get(key)
        : d.op === "set" ? backend.set(key, p.value)
        : d.op === "list" ? backend.list(String(p.prefix ?? ""))
        : backend.delete(key);
      return { result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "store call failed" };
    }
  });
  await page.exposeFunction("__hAi", async (d) => {
    // == Flinsh handleAiRequest (allowed: the manifest declares "ai")
    if (!PERMS.includes("ai")) return { error: `this app's flinsh.json does not declare "ai"`, code: "permission_denied" };
    if (d.op !== "chat") return { error: "unsupported ai operation", code: "invalid_request" };
    const p = d.payload && typeof d.payload === "object" ? d.payload : {};
    const req = {};
    for (const f of AI_FIELDS) if (p[f] !== undefined) req[f] = p[f];
    aiCalls.push(req);
    if (aiFail.code) return { error: `AI request failed (${aiFail.code})`, code: aiFail.code };
    try {
      return { result: cannedAi(req) };
    } catch (err) {
      return { error: String(err), code: "ai_error" };
    }
  });
  await page.exposeFunction("__hEvent", async (e) => {
    if (e.kind === "csp") problems.csp.push(JSON.stringify(e.detail));
    else if (e.kind === "error") problems.pageErrors.push(String(e.detail));
    else if (e.kind === "foreign-message") problems.foreign++;
  });
  page.on("console", (m) => {
    if (m.type() === "error") problems.console.push(m.text());
  });
  page.on("pageerror", (e) => problems.pageErrors.push(String(e)));
  page.on("request", (r) => {
    const u = r.url();
    if (!/^(data|blob|about):/.test(u)) problems.network.push(`${r.method()} ${u}`);
  });

  await page.setContent(buildParentPage(SRCDOC, { sandbox: SANDBOX, insets: INSETS }));
  const frameEl = await page.waitForSelector("iframe");
  const frame = await frameEl.contentFrame();
  const fl = page.frameLocator("iframe");
  return { browser, context, page, frame, fl, backend, problems, aiCalls, aiFail, aborted: false };
}

function reportProblems(name, s, section) {
  const { console: c, csp, pageErrors, network } = s.problems;
  record(name, section, "no console errors", c.length === 0, c.slice(0, 5).join(" | "));
  record(name, section, "no CSP violations", csp.length === 0, csp.slice(0, 5).join(" | "));
  record(name, section, "no page errors", pageErrors.length === 0, pageErrors.slice(0, 5).join(" | "));
  record(name, section, "no network requests", network.length === 0, network.slice(0, 5).join(" | "));
}

// ── helpers ──────────────────────────────────────────────────────────────────
const T = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Exact (case-sensitive) name for strings; regex as given.
const nameAttr = (name) => (typeof name === "string" ? `${JSON.stringify(name)}s` : `/${name.source}/${name.flags}`);
const byName = (scope, name, roles = ["button", "tab", "link", "radio"]) =>
  roles.map((r) => scope.locator(`role=${r}[name=${nameAttr(name)}]`)).reduce((a, b) => a.or(b)).first();

async function click(scope, name, roles) {
  const loc = byName(scope, name, roles);
  await loc.waitFor({ state: "visible", timeout: T });
  await loc.click();
}

/** A radio may be a visually hidden input inside its label: click the label then. */
async function pick(fl, name) {
  const radio = fl.locator(`role=radio[name=${nameAttr(name)}]`).first();
  await radio.waitFor({ state: "attached", timeout: T });
  try {
    await radio.click({ timeout: 2000 });
  } catch {
    await fl.locator("label").filter({ hasText: name }).first().click();
  }
}

async function textbox(fl, name) {
  const loc = fl.locator(`role=textbox[name=${nameAttr(name)}]`).first();
  await loc.waitFor({ state: "visible", timeout: T });
  return loc;
}

async function waitStore(backend, pred, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try {
      ok = !!pred(backend.data);
    } catch {
      ok = false;
    }
    if (ok) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
}

async function step(name, s, section, label, fn) {
  if (s.aborted) {
    record(name, section, label, false, "skipped (earlier step failed)");
    return false;
  }
  try {
    const detail = await fn();
    record(name, section, label, true, typeof detail === "string" ? detail : "");
    return true;
  } catch (err) {
    const full = err && err.message ? err.message : String(err);
    const hint = full.split("\n").filter((l) => /intercepts pointer|not stable|outside of the viewport|not visible|waiting for/.test(l)).slice(-2).map((l) => l.trim());
    record(name, section, label, false, [full.split("\n")[0].slice(0, 300), ...hint].join(" | "));
    if (label === "onboarding") s.aborted = true;
    try {
      await s.page.screenshot({ path: resolve(SHOTS, `${name}-${section}-FAIL-${label.replace(/\W+/g, "_")}.png`) });
    } catch {}
    await closeSheets(s.fl).catch(() => {});
    return false;
  }
}

// Close open sheets with their own Close button (Escape from Playwright's
// keyboard doesn't reliably reach a sandboxed frame in WebKit).
async function closeSheets(fl) {
  for (let i = 0; i < 3; i++) {
    const dlg = fl.getByRole("dialog");
    if ((await dlg.count()) === 0) return;
    await dlg.last().getByRole("button", { name: "Close", exact: true }).click({ timeout: 3000 }).catch(() => {});
    await sleep(300);
  }
}

// logs/* are packed on disk (src/data/logCodec.ts): {v, m, d: {date: {z, e: [{n, s: [[reps, kg, count?, 0 if not done]]}]}}}.
const logDay = (data, date) => {
  const p = data.get(`logs/${date.slice(0, 7)}`)?.d?.[date];
  if (!p) return null;
  const sets = (s) => (s || []).flatMap(([reps, weightKg, count = 1, done]) => Array.from({ length: count }, () => ({ reps, weightKg, done: done !== 0 })));
  return { finishedAt: p.z, exercises: (p.e || []).map((e) => ({ name: e.n, sets: sets(e.s) })) };
};

const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const activeSplitOf = (doc) => doc && doc.splits.find((x) => x.id === doc.activeId);
const KG_PER_LB = 0.45359237;
const lbText = (kg) => `${Math.round((kg / KG_PER_LB) * 10) / 10} lb`;

async function onboarding(fl, backend) {
  const name = await textbox(fl, "Your name");
  await name.fill("Magdalena");
  await click(fl, "Continue", ["button"]);
  await pick(fl, "lb");
  await click(fl, "Continue", ["button"]);
  await pick(fl, "4-day upper/lower");
  await click(fl, "Start training", ["button"]);
  await byName(fl, "Today", ["tab"]).waitFor({ timeout: T });
  must(await waitStore(backend, (d) => d.get("profile")?.name === "Magdalena" && activeSplitOf(d.get("splits"))?.days?.[2]?.kind === "workout"), `profile/splits not stored: ${JSON.stringify(backend.data.get("profile"))}`);
}

async function renameTuesday(fl, backend, to) {
  await click(fl, "Split", ["tab"]);
  await click(fl, "Edit Tuesday", ["button"]);
  const dlg = fl.getByRole("dialog").last();
  await dlg.waitFor({ timeout: T });
  const box = dlg.locator(`role=textbox[name="Day name"s]`).first();
  await box.fill(to);
  // WebKit occasionally drops the first fill while the sheet is still animating in.
  if ((await box.inputValue()) !== to || !(await waitStore(backend, (d) => activeSplitOf(d.get("splits")).days[2].name === to))) {
    await box.fill("");
    await box.pressSequentially(to);
  }
  await closeSheets(fl);
  must(await waitStore(backend, (d) => activeSplitOf(d.get("splits")).days[2].name === to), `split day 2 name = ${JSON.stringify(activeSplitOf(backend.data.get("splits"))?.days[2]?.name)}`);
}

async function tapFirstChip(fl, exName) {
  const re = exName ? new RegExp(`^${esc(exName)}, set 1 of \\d+, not done$`) : /, set 1 of \d+, not done$/;
  const chip = fl.locator(`role=button[name=${nameAttr(re)}]`).first();
  await chip.waitFor({ state: "visible", timeout: T });
  await chip.click();
}

// ── the main flow ────────────────────────────────────────────────────────────
async function runFlow(name, browserType) {
  const section = "flow";
  console.log(`\n[${name}] flow at 390×844`);
  const s = await openSession(browserType, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const { fl, backend, page } = s;
  let snapshot = null;
  let plan = null;
  let newKg = null;
  let splitsBefore = null;
  try {
    await step(name, s, section, "onboarding", async () => {
      await onboarding(fl, backend);
      plan = activeSplitOf(backend.data.get("splits")).days[2];
      return `Tuesday = ${plan.name}, first exercise ${plan.exercises[0].name}`;
    });

    await step(name, s, section, "shell insets message updates --flinsh-inset-*", async () => {
      const read = () =>
        s.frame.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          return ["top", "right", "bottom", "left"].map((k) => cs.getPropertyValue(`--flinsh-inset-${k}`).trim());
        });
      must((await read()).join(",") === "47px,0px,34px,0px", `on load: ${(await read()).join(",")}`);
      await page.evaluate(() => window.__hPostInsets({ top: 0, right: 47, bottom: 21, left: 47 }));
      await sleep(100);
      const rotated = await read();
      must(rotated.join(",") === "0px,47px,21px,47px", `after rotation: ${rotated.join(",")}`);
      await page.evaluate((i) => window.__hPostInsets(i), INSETS);
      await sleep(100);
    });

    await step(name, s, section, "split: rename Tuesday", () => renameTuesday(fl, backend, "Leg day"));

    await step(name, s, section, "today: set chip + Adjust → Increase weight, set 1", async () => {
      await click(fl, "Today", ["tab"]);
      const ex = plan.exercises[0];
      await tapFirstChip(fl, ex.name);
      await byName(fl, new RegExp(`^${esc(ex.name)}, set 1 of \\d+, done, \\d+ reps at `), ["button"]).waitFor({ timeout: T });
      await click(fl, `Adjust ${ex.name}`, ["button"]);
      const dlg = fl.getByRole("dialog").last();
      await click(dlg, "Increase weight, set 1", ["button"]);
      await click(dlg, "Done", ["button"]);
      must(
        await waitStore(backend, (d) => {
          const a = d.get("active");
          const e = a && a.exercises.find((x) => x.name === ex.name);
          if (!e || !e.sets[0].done || e.sets[0].weightKg == null) return false;
          newKg = e.sets[0].weightKg;
          return lbText(newKg) === lbText(ex.weightKg + 5 * KG_PER_LB);
        }),
        `active = ${JSON.stringify(backend.data.get("active"))?.slice(0, 300)}`,
      );
      return `${lbText(ex.weightKg)} → ${lbText(newKg)}`;
    });

    await step(name, s, section, "finish → summary → Done", async () => {
      await click(fl, "Finish workout", ["button"]);
      const dlg = fl.locator(`role=dialog[name="Workout summary"s]`);
      await dlg.waitFor({ timeout: T });
      await click(dlg, "Done", ["button"]);
      await dlg.waitFor({ state: "detached", timeout: T });
      must(await waitStore(backend, (d) => !d.has("active") && logDay(d, TODAY)?.finishedAt), `logs/2026-11 = ${JSON.stringify(backend.data.get("logs/2026-11"))?.slice(0, 200)}, active=${backend.data.has("active")}`);
      const saved = logDay(backend.data, TODAY).exercises.find((x) => x.name === plan.exercises[0].name);
      must(Math.abs(saved.sets[0].weightKg - newKg) < 1e-3 && saved.sets[0].done, `logged set 1 ${JSON.stringify(saved.sets[0])}, expected ${newKg}`);
      must(backend.data.has("bests"), "bests not stored");
    });

    await step(name, s, section, 'calendar: "November 10, done"', async () => {
      await click(fl, "Calendar", ["tab"]);
      await byName(fl, "November 10, done", ["button"]).waitFor({ timeout: T });
    });

    await step(name, s, section, "next day: coach proposal → Use for today (split unchanged)", async () => {
      splitsBefore = structuredClone(backend.data.get("splits"));
      // 18:00 → 01:00: the app's midnight timer rolls today over.
      await s.page.clock.fastForward("07:00:00");
      await click(fl, "Coach", ["tab"]);
      await (await textbox(fl, "Message the coach")).fill("I only have 30 minutes today");
      await click(fl, "Send", ["button"]);
      await click(fl, "Use for today", ["button"]);
      must(
        await waitStore(backend, (d) => d.get("active")?.coachAdjusted === true),
        `active = ${JSON.stringify(backend.data.get("active"))?.slice(0, 200)}`,
      );
      const names = backend.data.get("active").exercises.map((e) => e.name);
      must(JSON.stringify(names) === JSON.stringify(CANNED_PROPOSAL.exercises.map((e) => e.name)), `active exercises ${names.join(", ")}`);
      await sleep(400);
      must(JSON.stringify(backend.data.get("splits")) === JSON.stringify(splitsBefore), "splits changed by Use for today");
      must(backend.data.get("active").date === TOMORROW, `active.date = ${backend.data.get("active").date}`);
      must(await waitStore(backend, (d) => (d.get(`chat/${TOMORROW}`) || []).some((m) => m.role === "assistant")), "chat not stored");
      await byName(fl, "Save to my split", ["button"]).waitFor({ timeout: T });
    });

    await step(name, s, section, "store keys", async () => {
      const keys = [...backend.data.keys()];
      for (const k of ["profile", "splits", "active", "bests", "logs/2026-11", `chat/${TOMORROW}`]) must(keys.includes(k), `missing ${k} (have ${keys.join(", ")})`);
      const colon = keys.filter((k) => k.includes(":"));
      must(colon.length === 0, `keys with ':' ${colon.join(", ")}`);
      const leak = keys.filter((k) => JSON.stringify(backend.data.get(k)).includes(API_KEY_MARKER));
      must(leak.length === 0, `API key in ${leak.join(", ")}`);
      snapshot = Object.fromEntries(backend.data);
      return `${keys.length} keys, ${backend.usedBytes()} bytes: ${keys.join(", ")}`;
    });

    record(name, section, "AI calls", s.aiCalls.length >= 1, `${s.aiCalls.length} call(s)`);
    reportProblems(name, s, section);
  } finally {
    await s.browser.close();
  }
  return snapshot;
}

// ── the same app without AI (no_ai_key) ──────────────────────────────────────
async function runNoAi(name, browserType) {
  const section = "noai";
  console.log(`\n[${name}] no_ai_key at 390×844`);
  const s = await openSession(browserType, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, null, { aiCode: "no_ai_key" });
  const { fl, backend } = s;
  try {
    await step(name, s, section, "onboarding", () => onboarding(fl, backend));
    await step(name, s, section, "today: tap a set", async () => {
      await click(fl, "Today", ["tab"]);
      await tapFirstChip(fl, null);
      must(await waitStore(backend, (d) => d.get("active")?.exercises?.some((e) => e.sets.some((x) => x.done))), "active not stored");
    });
    await step(name, s, section, "split: rename Tuesday", () => renameTuesday(fl, backend, "Legs"));
    await step(name, s, section, "calendar: month navigation", async () => {
      await click(fl, "Calendar", ["tab"]);
      await click(fl, "Previous month", ["button"]);
      await click(fl, "Next month", ["button"]);
      await byName(fl, /^November 10, /, ["button"]).waitFor({ timeout: T });
    });
    await step(name, s, section, "me: theme → Light", async () => {
      await click(fl, "Me", ["tab"]);
      await pick(fl, "Light");
      must(await waitStore(backend, (d) => d.get("settings")?.theme === "light"), `settings = ${JSON.stringify(backend.data.get("settings"))}`);
    });
    await step(name, s, section, `coach: "${NO_AI_TEXT}"`, async () => {
      await click(fl, "Coach", ["tab"]);
      const box = await textbox(fl, "Message the coach");
      await box.fill("hi");
      await click(fl, "Send", ["button"]);
      await fl.getByText(NO_AI_TEXT).first().waitFor({ timeout: T });
      must(s.aiCalls.length >= 1, "ai never called");
    });
    await step(name, s, section, "today still works after the AI error", async () => {
      await click(fl, "Today", ["tab"]);
      await fl.locator(`role=button[name=/, set \\d+ of \\d+, /]`).first().waitFor({ timeout: T });
    });
    reportProblems(name, s, section);
  } finally {
    await s.browser.close();
  }
}

// ── screenshots + layout ─────────────────────────────────────────────────────
async function runLayout(name, browserType, w, h, theme, seed) {
  const label = `${w}x${h}-${theme}`;
  const section = `layout ${label}`;
  console.log(`\n[${name}] ${section}`);
  const data = structuredClone(seed);
  data.settings = { ...(data.settings || {}), theme };
  const s = await openSession(browserType, { viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: theme }, data, { clock: LAYOUT_CLOCK });
  const { fl, frame, page } = s;
  const all = [];
  const shot = async (what) => {
    // Wait for the insets to arrive and the theme to apply.
    await frame.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--flinsh-inset-top").trim() === "47px", null, { timeout: T }).catch(() => {});
    await page.waitForTimeout(350);
    const res = await frame.evaluate(probeLayout, { insetTop: INSETS.top, insetBottom: INSETS.bottom, minTap: 44, minChip: 48, minFont: 16 });
    const file = `${name}-${label}-${what}.png`;
    await page.screenshot({ path: resolve(SHOTS, file) });
    for (const v of res.violations) all.push({ tab: what, ...v });
    record(name, section, what, res.violations.length === 0, res.violations.length ? `${res.violations.length} violation(s)` : file);
  };
  try {
    await step(name, s, section, "boot", async () => {
      await byName(fl, "Today", ["tab"]).waitFor({ timeout: 10000 });
      const t = await frame.evaluate(() => document.documentElement.getAttribute("data-theme"));
      must(t === theme, `html[data-theme]=${t}`);
    });
    for (const tab of TABS) {
      await step(name, s, section, `tab ${tab}`, async () => {
        await click(fl, tab, ["tab"]);
        await shot(tab.toLowerCase());
      });
    }
    await step(name, s, section, "active workout", async () => {
      await click(fl, "Today", ["tab"]);
      await tapFirstChip(fl, null);
      await shot("today-active");
    });
    await step(name, s, section, "workout summary", async () => {
      await click(fl, "Finish workout", ["button"]);
      await fl.locator(`role=dialog[name="Workout summary"s]`).waitFor({ timeout: T });
      await shot("summary");
    });
    reportProblems(name, s, section);
  } finally {
    await s.browser.close();
  }
  for (const v of all) console.log(`      ${v.tab.padEnd(12)} ${v.check.padEnd(14)} ${v.el}  ${v.detail}`);
  return all.map((v) => ({ browser: name, viewport: label, ...v }));
}

// ── main ─────────────────────────────────────────────────────────────────────
const LAUNCH = {};
async function canLaunch(bt, opts = {}) {
  try {
    const b = await bt.launch(opts);
    await b.close();
    return true;
  } catch (e) {
    return String(e.message || e).split("\n")[0];
  }
}

// If the pinned WebKit revision isn't downloaded, try any other cached one.
function cachedWebkits() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || resolve(homedir(), "Library/Caches/ms-playwright");
  try {
    return readdirSync(dir)
      .filter((d) => /^webkit-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      .map((d) => resolve(dir, d, "pw_run.sh"))
      .filter((p) => existsSync(p));
  } catch {
    return [];
  }
}

const engines = [];
for (const [n, bt] of [["chromium", chromium], ["webkit", webkit]]) {
  if (ONLY && ONLY !== n) continue;
  let ok = await canLaunch(bt);
  if (ok !== true && n === "webkit") {
    for (const exe of cachedWebkits()) {
      if ((await canLaunch(bt, { executablePath: exe })) === true) {
        console.warn(`harness: WARNING pinned webkit missing; using cached ${exe}`);
        LAUNCH.webkit = { executablePath: exe };
        ok = true;
        break;
      }
    }
  }
  if (ok === true) engines.push([n, bt]);
  else {
    console.warn(`harness: ${n} could not launch (${ok}).`);
    record(n, "launch", "browser launches", false, ok);
  }
}
if (!engines.length) {
  console.error("harness: no browser could launch. Run `npx playwright install chromium webkit`.");
  process.exit(1);
}

const layoutViolations = [];
let seed = null;
if (!args.has("--no-flow")) {
  for (const [n, bt] of engines) {
    const snap = await runFlow(n, bt);
    if (snap && !seed) seed = snap;
    await runNoAi(n, bt);
  }
}
if (!args.has("--no-layout")) {
  if (!seed) {
    // Build a seed by running onboarding + coach in the first engine without asserting.
    console.warn("harness: no flow snapshot; running a quick flow in the first engine for the layout seed.");
    seed = await runFlow(engines[0][0], engines[0][1]);
  }
  if (!seed) record("-", "layout", "seed from the flow", false, "the flow produced no store snapshot");
  else
    for (const [n, bt] of engines)
      for (const [w, h] of [[390, 844], [430, 932]])
        for (const theme of ["dark", "light"]) layoutViolations.push(...(await runLayout(n, bt, w, h, theme, seed)));
}

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log("\n══ Summary ══");
const groups = new Map();
for (const r of results) {
  const k = `${r.browser.padEnd(9)} ${r.section}`;
  const g = groups.get(k) || { pass: 0, fail: 0 };
  r.ok ? g.pass++ : g.fail++;
  groups.set(k, g);
}
for (const [k, g] of groups) console.log(`  ${k.padEnd(36)} ${String(g.pass).padStart(3)} pass ${String(g.fail).padStart(3)} fail`);
if (layoutViolations.length) {
  console.log(`\nLayout violations (${layoutViolations.length}), grouped:`);
  const byKey = new Map();
  for (const v of layoutViolations) {
    const k = `${v.check} ${v.el} ${v.detail}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(`${v.browser} ${v.viewport} ${v.tab}`);
  }
  for (const [k, where] of byKey) console.log(`  ${k}\n      in: ${where.join("; ")}`);
}
if (failed.length) {
  console.log(`\nFailures (${failed.length}):`);
  for (const f of failed) console.log(`  [${f.browser}] ${f.section}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
console.log(`\nScreenshots: ${SHOTS}`);
console.log(failed.length ? `\nharness: FAILED (${failed.length} check(s))` : "\nharness: OK");
process.exit(failed.length ? 1 : 0);
