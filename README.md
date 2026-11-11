# Split

Your gym split, your sets and weights, and every day you showed up.

Split is a gym planner and log for one person. It replaces a Notion page: the
weekly split (what she does each day), the sets, reps and weights she adjusts
at the gym, a record of the days she went, and an optional AI coach. It runs
as a full-screen [Flinsh](../Flinch) app on her iPhone, and standalone in a
desktop browser for development.

- **Today**: the gym screen. Each exercise is a large row with
  its target (`4 × 5 · 135 lb`) and last time's sets. Tap a set chip to complete
  it, long-press or **Adjust** for reps and weight steppers, **Mark all** for the
  whole exercise. Swap, skip or add an exercise for today only. Do another day's
  workout, or log an extra one on a rest day. **Finish workout**: confetti, a
  summary (exercises, sets, volume, personal bests) and a finish line that never
  repeats within a week. Optional photo and a one-line note. The in-progress
  workout survives closing the app, and the screen stays awake while it runs
  (when the browser allows it).
- **Split**: seven days, each a named workout or rest. Add, edit, reorder (drag or
  up/down), duplicate and delete exercises, copy a day, rename days. Several
  saved splits: one active, the others archived and viewable; duplicate one to
  start the next. Exercise names come from a built-in library of ~170 common
  exercises, or free text.
- **Calendar**: month view with done, rest and missed days (missed is a hollow
  ring, never red), streak, gym days this month; tap a day for what she did, the
  photo and the note; per-exercise history with a top-weight line.
- **Coach** (optional): a chat that knows her split and the last 14 days. "Plan
  today" proposes an adjusted workout as a card with **Use for today** / **Keep
  my plan** (and **Save to my split** after applying). It also suggests exercises,
  finds swaps when equipment is taken, and gives rough calorie estimates.
- **Me**: profile, per-day reminders, units, weight step, theme (dark by
  default), text size, motion, what the coach sees, capabilities, export, delete
  everything.

## Run it

```bash
npm install
npm run dev               # http://localhost:5173, standalone (localStorage)
npm test                  # vitest: 208 tests incl. the smoke flow
npm run build             # typecheck + one self-contained dist/index.html + size/URL check
npm run verify:harness    # Playwright, Chromium + WebKit, real sandbox + CSP + mock bridge
```

Standalone mode keeps data in this browser's `localStorage` (keys prefixed
`split/`). To use the coach there, add an Anthropic API key in **Me → Settings**.
It stays in this browser's `localStorage` only (`split.apiKey`), is sent only to
`api.anthropic.com`, and never goes into the store or the export.

## How it runs in Flinsh

`flinsh.json` declares a v2 `app` whose entrypoint is `dist/index.html` (built and
committed, since Flinsh serves the entrypoint straight from the repo). Flinsh puts
it in an `<iframe sandbox="allow-scripts allow-forms allow-downloads">` (the last because the manifest declares `downloads`) with `connect-src 'none'`,
injects `window.flinsh`, and the app:

1. listens for the shell's `{__flinsh: "insets"}` message;
2. waits for `window.flinsh` (or `flinsh:ready`), falling back to standalone after 400 ms;
3. preloads its keys from `flinsh.store`, renders, and calls `flinsh.ready()`.

### Bridge methods

| Method | Status today | Used for | Without it |
|---|---|---|---|
| `flinsh.store.get/set/delete/list` | exists | all data (`store:user`) | `localStorage`, then memory |
| `flinsh.ready()` | exists | mount signal | — |
| `flinsh.ai.chat(request)` → Anthropic Messages body; rejects with `err.code` | exists | the coach | Coach shows why it's off; everything else works |
| `--flinsh-inset-*` + `{__flinsh: "insets"}` | exists | safe areas | `env()`, then a minimum padding |
| `flinsh.files.put(blob, {name, mime})` → `{id}`, `.get(id)` → signed URL (~10 min), `.delete(id)` | exists (`files:user`) | full-size photos (1600 px) | inline photos in the store (below) |
| `flinsh.files.save(blob, filename)` | exists (`downloads`) | Export: `split-<date>.json` (a download on the web, the share sheet in the phone app) | clipboard, then a select-all box |
| `flinsh.notifications.schedule([{id, title, body, time: "HH:MM", weekday?}])`, `.cancel(ids)` | proposed | workout-day reminders | in-app banners while Split is open |
| manifest `statusBar: "dark"` | proposed | status-bar style | — |
| `navigator.wakeLock` | browser API; the frame's `allow` list grants only `fullscreen` today | screen stays on during a workout | the screen may sleep |

`notifications` is in the manifest's permissions so the shell can grant it when
it ships; the platform accepts it today and it does nothing. Nothing is faked:
**Me → Capabilities** shows which path each feature is using and what the
fallback means. Wake lock shows *not supported*, *not tried yet* (it's requested
when a workout starts), *on*, or *blocked*.

With `store:user`, Flinsh also shims `localStorage` inside the frame onto the
store (`ls/` keys). Split doesn't rely on it: data goes through `flinsh.store`
directly, and the standalone API key is never read inside Flinsh.

## Data model

Everything is in `flinsh.store`, user scope. Keys use `/`, because the store rejects `:`. Weights are stored in kg and converted for display.

| Key | Value |
|---|---|
| `profile` | name, units, optional height / body weight / goal (coach only), start date |
| `settings` | theme, text size, motion, weight step, coach model, reminders, dismissed banners |
| `splits` | every split (active + archived) and which was active from when |
| `active` | the workout in progress (deleted when finished or discarded) |
| `logs/YYYY-MM` | finished sessions of that month, packed (`src/data/logCodec.ts`) |
| `bests` | per-exercise records and last sets; derived from the logs, rebuilt if missing |
| `chat/YYYY-MM-DD` | that day's coach chat, ≤ 30 messages / 8 KB; deleted after 30 days |
| `photo/<id>` | one inline photo per day (only when `flinsh.files` is missing) |

**A failed read is not empty data.** If any key fails to load at start, Split shows
"Couldn't load your data" with **Try again** and writes nothing, so a network blip
never sends her back to onboarding or overwrites a month. A finished workout's
`active` key is deleted only after its log write is confirmed.

A session copies the plan when she starts, so editing the split never rewrites
a log. Today-only swaps, skips, additions and coach proposals change only the
session.

**Fits the quota.** `tests/storeSize.test.ts` generates three years of five-day
weeks (782 sessions, 6 exercises × 4 sets, notes, a thumbnail on every third day),
three splits, 60 exercise records, 20 photos at the size cap and 30 full chat days.
That's 1.80 MB of the 2 MB quota and 91 of 1,000 keys, and the largest value is 40 KB
(the limit is 256 KB). Logs are about 1.2 KB per session packed, against ~3 KB as
plain JSON. Once logs pass 650 KB, thumbnails in months older than a year are dropped. If a write
still hits the quota, the store frees the oldest chat day, then the oldest
photo. It never frees logs, the split or settings.

## Photos

Photos go through `src/adapters/media.ts`. One photo per day; a new one replaces it.

- **Inside Flinsh** (`flinsh.files`, `files:user`): a 1600 px JPEG (quality 0.85,
  re-encoded through a canvas, which strips EXIF) saved with
  `files.put(blob, {name: "split/photo/<date>-<id>.jpg", mime: "image/jpeg"})`. The log keeps
  the returned id; `files.get(id)` gives a signed URL valid about 10 minutes, so
  it's fetched fresh each time and never stored. Photos don't count against the
  store quota. Delete everything deletes them too.
- **Fallback** (standalone, or without the files grant): resized to a 640 px max edge, re-encoded through a canvas
  (which strips EXIF), and squeezed to a JPEG of at most 30 KB, about 40 KB as stored base64. It goes under
  `photo/<id>`, one per day. The newest 20 are kept (about 800 KB) and the oldest
  are dropped. The day's log keeps a 48 px thumbnail, so the calendar still shows
  something and says "Full photo removed to save space".

## Coach: contracts and privacy

**When anything is sent.** Only when she sends a coach message or taps a quick
prompt. Nothing runs in the background, and nothing is sent if she never opens
the Coach.

**What is sent.** The exact system prompt is shown under **Me → What the coach
sees**. It contains:

- her name, units, and optional height, body weight and goal;
- the active split (all seven days);
- today's plan or in-progress session;
- finished sessions from the last 14 days: exercises, sets, weights and the day's one-line note.

The request also carries the last 12 chat messages of the day. Photos, thumbnails,
older history, settings and the API key are never sent.

**Where it goes.** Inside Flinsh: `flinsh.ai.chat`, under her own Anthropic key.
Flinsh logs token counts and cost, never content. Standalone: straight to
`api.anthropic.com` with the key from `localStorage`.

**What the coach can do.** One client-side tool, `proposeWorkout({exercises:
[{name, sets, reps, weight?}], reason, title?})`. Weight is in her unit and reps
is `"8"` or `"8-12"`. The app validates and clamps it and shows a card. The coach
never changes anything itself:

- **Use for today** replaces today's session only.
- **Keep my plan** changes nothing.
- **Save to my split** writes that weekday in the active split.

Once today's workout is logged, a proposal can only be kept or saved to the split.

**Tone and limits.** An encouraging friend who lifts, at most 80 words unless
asked for more. No medical or injury advice: for pain, injury or dizziness it says
to stop and see a professional. No extreme dieting advice. Calorie estimates are
always labelled "rough estimate".

**Errors.** Handled by `err.code`:

- `no_ai_key`: "Add your Anthropic key in Flinsh Settings to turn on the coach".
- `rate_limited` / `ai_budget_exceeded`: try again in a bit.
- Anything else: a short message plus the code.

The rest of the app never depends on AI. The harness runs a full pass with `ai`
rejecting `no_ai_key`.

**Models.**

- Default: `claude-sonnet-5-5`; editable in standalone settings.
- Direct (standalone) requests send `thinking: {type: "between_tools"}` and
  `output_config: {effort: "low"}`, plus server-side `fallbacks: "default"` with
  the `server-side-fallback-2026-07-01` beta.
- Requests through `flinsh.ai` send only the fields the bridge accepts.

## Verification

- `npm run build`:
  - `dist/index.html` is ~199 KB (limit 400 KB) and includes the exercise library.
  - `scripts/check-dist.mjs` allows only `https://api.anthropic.com` (standalone path)
    plus Preact's XML namespace strings.
- `npm run verify:harness`:
  - Loads the built file exactly as Flinsh does: CSP first, real bridge source imported
    from `../Flinch/web/src/lib/miniAppSandbox.ts`, the sandbox the manifest gets (`allow-scripts allow-forms allow-downloads`).
  - `flinsh.files` requests (photos, Export's `save`) go through the platform's own
    `handleFilesRequest` with an in-memory client; a second pass makes `save` fail and
    checks the fallback.
  - Runs in Chromium and WebKit: the main flow, a no-AI pass, and layout probes at
    390×844 and 430×932 in both themes:
    - tap targets ≥ 44 px, set chips ≥ 48 px, text ≥ 16 px;
    - nothing tappable in the status band;
    - no horizontal overflow.
  - Requires zero console errors, CSP violations or network requests.
  - Screenshots go to `test-results/harness/`.

## Known limits

- **Reminders** are in-app banners (shown while Split is open) until the shell ships
  `flinsh.notifications`. Nothing arrives when the app is closed.
- **Photos** in the standalone fallback are small (640 px, ≤ 30 KB), and only the last 20 are
  kept in full. In Flinsh they're 1600 px in `flinsh.files`.
- **Wake lock** is refused inside the Flinsh frame today (its `allow` list grants only
  `fullscreen`), so the screen may sleep mid-workout. It works standalone in browsers
  that support it. Capabilities shows *blocked* once it's been tried.
- **Writes aren't transactional.** Values over 120 KB are split across chunk keys, and a
  crash mid-write could leave a mix. Split keeps every value ≤ 40 KB, so in practice
  nothing is chunked.
- **Past calendar days** are marked missed or rest according to the *current* split, not
  the split that was active then (logged days always show what she did).
- **Workouts past midnight** stay "today's" for 6 hours after the last set, then Today
  offers to finish them on their own date.
- **Export** inside Flinsh uses `flinsh.files.save` (Me → Capabilities shows "Save a file").
  If that fails, it copies the JSON to the clipboard; if the frame refuses the clipboard too,
  it shows the JSON in a select-all box. The export never includes the API key.
- **One session per day.** Finishing a second workout on the same date merges it
  into that day's log.
- **Streak rules.** Rest days neither add nor break a streak, and an extra workout on a rest day
  doesn't add to it either. Doing Tuesday's workout on Wednesday counts Tuesday as missed.
- **Personal bests** need history: an exercise's first session sets the baseline
  and never shows a PB.
- **Calendar cells** are ~41 px wide on a 320 px screen (7 columns). They're ≥ 49 px on
  current iPhones.

## Project layout

See [docs/PLAN.md](docs/PLAN.md) (architecture, data model, screen map, coach
contracts), [docs/API.md](docs/API.md) (module exports) and
[docs/DESIGN.md](docs/DESIGN.md) (tokens, layout, motion, copy).
