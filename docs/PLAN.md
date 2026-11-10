# Split: plan

Split is a gym planner and log for one person (Magdalena). It runs as a
full-screen Flinsh app (manifest v2, `type: "app"`) on her iPhone, and
standalone in a desktop browser for development. It replaces a Notion page:
her weekly split, the sets, reps and weights she adjusts at the gym, a record
of the days she went, and an optional AI coach.

## Architecture

```
index.html → src/main.tsx
  ├─ adapters/        the outside world, each with a fallback
  │   env.ts            window.flinsh guard (400 ms standalone fallback), safe localStorage
  │   store.ts          write-through cache over flinsh.store | localStorage | memory
  │   ai.ts             flinsh.ai.chat | direct Anthropic (standalone, key in localStorage) | none
  │   notifications.ts  flinsh.notifications.schedule | in-app banners
  │   media.ts          flinsh.files (files:user) | inline JPEG in the store, budgeted
  │   insets.ts         --flinsh-inset-* + {__flinsh:"insets"} listener
  │   wakeLock.ts       navigator.wakeLock during a workout, silent fallback
  ├─ lib/             pure helpers: date, units, ids, reminders, finishLines
  ├─ data/            the app's model
  │   keys.ts           store keys
  │   defaults.ts       default settings/profile, normalizers for stored values
  │   templates.ts      starter splits
  │   split.ts          PURE split editing (Split → Split)
  │   session.ts        PURE today resolution + session state machine
  │   history.ts        PURE records, streaks, calendar status, exercise history, volume
  │   state.ts          AppState store, initApp(), useApp(selector), clock
  │   actions.ts        `actions: AppActions`: state changes + persistence
  │   exportData.ts     JSON export
  ├─ coach/           the optional AI coach
  │   library.ts        ~150 exercises by muscle group, search
  │   context.ts        AppState → CoachContext
  │   prompt.ts         CoachContext → system prompt (also shown in Me → What the coach sees)
  │   tools.ts          proposeWorkout tool def + parser
  │   coach.ts          runCoachTurn (tool loop), chat trimming, history → messages
  └─ ui/              Preact screens, components, CSS (tokens.css, base.css, components.css)
```

Rules:

- `src/types.ts` is the contract. Only the main thread changes it.
- `data/split.ts`, `data/session.ts`, `data/history.ts`, `lib/*` and
  `coach/{prompt,tools,library}.ts` are **pure**: no store, no DOM, no clock
  (the time is a parameter). That's where the tests are.
- `data/actions.ts` is the only module that writes to the store.
- The UI reads state with `useApp(selector)` and changes it only through
  `actions`.
- Nothing fakes a capability. Each adapter reports its mode in
  `AppState.caps`, and **Me → Capabilities** shows the fallback in use.

### Boot

1. `installInsetListener()` (before anything, so an early message isn't lost).
2. `waitForBridge(400)`: `window.flinsh` now, on `flinsh:ready`, or standalone.
3. Store: `flinsh.store` → else `localStorage` (prefix `split/`) → else memory.
4. Preload `profile`, `settings`, `splits`, `active`, `bests`,
   `logs/<this month>`, `logs/<last month>`, `chat/<today>`.
5. Housekeeping (async, after first paint): prune `chat/*` older than 30
   days; if `bests.version` is stale or missing, rebuild from all `logs/*`;
   if `active.date` is before today, keep it: Today offers "Finish
   <weekday>'s workout" or "Discard".
6. Render; call `flinsh.ready()`.
7. `installBackgroundFlush` (visibilitychange → hidden, pagehide).

## Data model (flinsh.store, user scope)

Keys use `/` (`:` is rejected). Everything is JSON, weights in kg.

| Key | Value | Size (typical) |
|---|---|---|
| `profile` | `Profile` | < 1 KB |
| `settings` | `Settings` | < 1 KB |
| `splits` | `SplitsDoc`: all splits (active + archived) and the active history | 2–6 KB per split |
| `active` | `Session` in progress, or deleted | < 4 KB |
| `logs/YYYY-MM` | `MonthLog`, packed on disk (`logCodec.ts`): finished sessions of that month | ~ 1.2 KB per session packed |
| `bests` | `BestsDoc`: per-exercise records, derived, cached | ~ 300 B per exercise |
| `chat/YYYY-MM-DD` | `ChatMessage[]`, trimmed to 30 messages / 8 KB; deleted after 30 days | ≤ 8 KB |
| `photo/<id>` | `StoredPhoto` (inline mode only), ≤ 30 KB JPEG, at most 20 kept | ≤ 40 KB each (base64) |

Budget: 2 MB and 1,000 keys. Three years of five-day weeks is 36 `logs/*`
keys of ~ 22 sessions each; the size test (`tests/storeSize.test.ts`)
generates that with realistic sessions (6 exercises × 4 sets, notes, a
thumb on a third of days) and asserts the total plus 20 photos plus 30 chat
days stays under 2 MB and 1,000 keys, and that every month value is under
256 KB. Logs are packed on disk (`src/data/logCodec.ts`: short keys, kg to
4 decimals, run-length sets, no per-set doneAt), ~1.2 KB per session. Thumbs
(48 px JPEG data URLs, ~1.2 KB) are dropped from months older than a year once
the packed logs pass 650 KB (`compactOldThumbs`). Measured worst case (every
cap full): 1.80 MB. On a quota error the store frees the oldest chat day, then
the oldest photo; never logs.

### Splits

- `days[weekday]`, 0 = Sunday; the UI lists Monday first (`WEEK_ORDER`).
- One split is active (`activeId`); others have `archivedAt` and are
  read-only (view, duplicate, activate, delete).
- `history` records which split was active from which date, so the
  calendar can tell a past "missed" from a past rest day after she changes
  splits. `activateSplit` appends `{splitId, from: today}` (replacing an
  entry with the same `from`).

### Sessions

- One per date. Today's session lives in `active` until finished, then moves
  into `logs/<month>.days[date]` and `active` is deleted. Writes are
  write-through (memory first, coalesced 250 ms, flushed on hide), so an
  in-progress workout survives closing the app.
- A session is a **copy** of the plan at the time she starts: editing the
  split never rewrites a session or a log. Today-only changes (swap, add,
  skip, coach proposal) touch only the session.
- Before a session exists, Today renders the plan directly; the first set
  tap (or "Start") creates the session (`sessionFromPlan`).
- Set prefill: `reps = plan.reps.max ?? plan.reps.min` if she hit the top
  of the range last time at that weight, else `plan.reps.min`; keep it
  simple: **`reps.min`** for the first version, `weightKg = plan.weightKg`.
- Extra workout on a rest day: `from = null`, title "Extra workout", empty
  exercise list she fills with "Add exercise".
- A different day's workout: `pickWeekday(wd)` before starting; the session
  records `from.weekday = wd`.
- Finishing requires ≥ 1 completed set; otherwise "Finish" turns into
  "Discard". Exercises with zero completed sets are kept as `skipped` in the
  log (so the record shows what was planned).

### Records (personal bests)

- Keyed by `normalizeName(name)`: lowercased, trimmed, inner whitespace
  collapsed, trailing "s" not stripped (names are her own).
- At finish, for each completed set (bodyweight sets compare reps only):
  - **heaviest**: weight > record.heaviest.weightKg (+0.01 tolerance).
  - **reps**: reps > record.repsAt[weight].reps at the same weight.
  - One PB per exercise per kind (the best set); `heaviest` wins over
    `reps` for the same set.
  - **No PBs for an exercise's first session** (there's nothing to beat).
- `foldSession(bests, session)` updates records, `last`, `sessions`.
  `rebuildBests(allSessions)` derives it from scratch (used after delete
  or when `version` changes).

### Streak and calendar

- `plannedOn(date, splitsDoc)`: the DayPlan of the split active on that
  date (`history`), or null before tracking began.
- `dayStatus(date, today, …)`: `before-start` (before `profile.startedOn`),
  `done` (a finished session with ≥ 1 completed set), `today`, `planned`
  (future workout day), `rest` (planned rest, no session), `missed` (past
  workout day without a session).
- **Streak**: walk back from today. Today counts if done; if it's not done
  yet, it doesn't break the streak. A planned workout day with a session
  adds 1; a rest day neither adds nor breaks (an extra workout on a rest day
  also doesn't add, it's a bonus); a missed workout day ends it; stop at
  `startedOn`. Doing Tuesday's workout on Wednesday: Tuesday is missed
  (breaks), Wednesday is done.
- "Gym days this month": dates in the month with a finished session.

### Units

`KG_PER_LB = 0.45359237`. Stored kg, never rounded on write. Display:
lb → rounded to 0.1 and trailing zeros dropped (135, 132.5); kg → same.
Steppers move by `settings.weightStep` in display units and snap to that
grid (`stepWeight(kg, unit, step, ±1)`), so 135 lb + 5 = 140 lb exactly
on display. Volume = Σ reps × kg over completed loaded sets, displayed in
her unit, rounded to an integer with thousands separators.

## Screen map

Bottom tabs: **Today · Split · Calendar · Coach · Me** (accessible names
exactly those words; `role="tab"` inside `role="tablist"`).

- **Today**
  - Header: weekday, date, workout name in big type; streak chip.
  - Workout day: one large row per exercise: name, `sets × reps` target,
    "Last: 135 lb × 8, 8, 7"; the set chips (≥ 48 px) in a row; an
    "Adjust" button (sheet with per-set reps/weight steppers); a "…" menu
    (Swap for today, Skip for today, Add a set, Remove a set). "Mark all"
    completes the rest of the exercise.
  - Bottom of the list: "Add exercise for today", note field ("One line
    about today"), "Add photo", and the primary **Finish workout** button
    (sticky above the tab bar once a session is active).
  - Rest day: a calm "Rest day" card with "Log an extra workout" and "Do
    another day's workout" (a sheet with the seven days).
  - Different day: "Not feeling Legs? Do another day's workout" link above
    the list (same sheet) when no session is active.
  - Stale active session (from an earlier date): a card "You didn't finish
    Tuesday's workout" with "Finish it" (saves it to its own date) and
    "Discard".
  - Summary sheet after finish: confetti, finish line, exercises done, total
    sets, total volume, PBs, "Use today's weights in my split" (if changed),
    "Done".
- **Split**
  - Split name (tap to rename) + "Splits" button (sheet: active + archived,
    view, duplicate, activate, delete, "New split from this one").
  - Seven day cards, Monday first: bold day name, workout name, exercise
    count. Tap → day editor.
  - Day editor (full-height sheet): name, workout/rest toggle, exercise
    list with up/down buttons (and drag handle), each exercise editable
    (name with library suggestions, sets stepper, reps "8" or "8–12" with
    steppers, weight stepper, note), duplicate, delete; "Add exercise";
    "Copy this day to…" (weekday picker).
- **Calendar**
  - Month grid with gentle status marks (filled accent dot = done, hollow
    ring = missed, small dash = rest, outline = today); prev/next month.
  - Streak and "gym days this month" stats.
  - Tap a day → sheet: title, exercises with sets, note, photo (or the
    thumb with "Full photo removed to save space"), edit note.
  - "Exercises" list → per-exercise history: SVG line of top weight over
    time, list of past sessions.
- **Coach**
  - If AI is unavailable: a calm card explaining why (`no_ai_key`: "Add your
    Anthropic key in Flinsh Settings to turn on the coach"; standalone: "Add
    an Anthropic API key in Me → Settings"), and the rest of the app is
    untouched.
  - Quick actions: "Plan today", "Suggest exercises", "Swap: equipment
    taken", "Calories for today".
  - Chat with today's history; proposal cards with "Use for today", "Keep my
    plan", and after applying, "Save to my split".
- **Me**
  - Profile (name, units, height, body weight, goal).
  - Reminders: master switch; one row per workout day ("Legs · Tue
    17:30"), each on/off with a time.
  - Settings: units, weight step (2.5 / 5), theme (Dark / Light / System),
    text size (Default / Large / Larger), motion, coach model (standalone),
    API key (standalone only).
  - What the coach sees (the exact system prompt).
  - Capabilities.
  - Export my data; Delete everything (two-step: "Delete everything" →
    type DELETE or press a second confirm button).

Onboarding (3 short screens, full-screen, no tab bar):
1. "What should we call you?": `Your name`. Continue.
2. Units: `lb` / `kg` radios. Optional: Height (cm or ft/in), Body
   weight, Goal (Build muscle / Lose fat / Stay consistent). Continue.
3. "Start your split": template radios `3-day full body`,
   `4-day upper/lower`, `5-day push/pull/legs`, `Start blank`. **Start
   training**.

## Accessible names (tests and the harness rely on these)

| Element | Name |
|---|---|
| tabs | `Today`, `Split`, `Calendar`, `Coach`, `Me` |
| onboarding | textbox `Your name`; buttons `Continue`, `Start training`; radios `lb`, `kg`, `3-day full body`, `4-day upper/lower`, `5-day push/pull/legs`, `Start blank` |
| set chip | `"<Exercise>, set <i> of <n>, not done"` / `"<Exercise>, set <i> of <n>, done, <reps> reps at <weight>"` (weight like `135 lb`, or `bodyweight`) |
| per exercise | `Adjust <Exercise>`, `Mark all sets of <Exercise> done`, `More for <Exercise>` |
| adjust sheet (per set i) | `Increase weight, set <i>`, `Decrease weight, set <i>`, `Increase reps, set <i>`, `Decrease reps, set <i>`; `Done` |
| today | `Finish workout`, `Add exercise for today`, `Do another day's workout`, `Log an extra workout`, textbox `Note for today`, `Add photo` |
| summary | dialog named `Workout summary`; `Done`; `Use today's weights in my split` |
| split | `Edit <Day name>` (e.g. `Edit Monday`); in the editor: `Move <Exercise> up`, `Move <Exercise> down`, `Duplicate <Exercise>`, `Delete <Exercise>`, `Add exercise`, `Copy this day to…`; textbox `Day name` |
| exercise form | textboxes `Exercise name`, `Reps`; steppers `Increase sets`/`Decrease sets`, `Increase weight`/`Decrease weight`; `Save exercise` |
| calendar | day buttons `"<Month> <d>, <status>"` (e.g. `November 10, done`); `Previous month`, `Next month` |
| coach | textbox `Message the coach`; `Send`; `Plan today`; proposal buttons `Use for today`, `Keep my plan`, `Save to my split` |
| sheets | `role="dialog"` with an accessible name and a `Close` button |

## Coach contracts

### What the coach sees

`buildCoachContext(state)` → `CoachContext`: profile (name, units, height,
body weight, goal; never the API key), the active split (all seven days),
today's plan (or the picked day's), the in-progress session, and finished
sessions from the last 14 days. `buildSystemPrompt(ctx, mode)` renders it as
compact text (weights in her unit). **Me → What the coach sees** shows that
exact string. Photos and the notes of days older than 14 days are never sent.

### Persona

An encouraging friend who lifts. Brief: ≤ 80 words unless asked for more.
Specific (names her exercises and numbers). No medical or injury advice: for
pain, injury, dizziness or anything medical, it says to stop and see a
professional, and nothing more on the topic. No extreme dieting advice (no
crash diets, no very-low-calorie targets, no "earn your food"). Calorie
estimates are always labelled "rough estimate".

### Tool: `proposeWorkout`

```json
{
  "name": "proposeWorkout",
  "description": "Propose an adjusted workout for TODAY ONLY. The app shows it as a preview card with 'Use for today' and 'Keep my plan'. Use it whenever she asks to change, shorten, lengthen or refocus today's workout.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": {"type": "string"},
      "exercises": {"type": "array", "minItems": 1, "maxItems": 12, "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "sets": {"type": "integer", "minimum": 1, "maximum": 10},
          "reps": {"type": "string", "description": "A number like \"8\" or a range like \"8-12\""},
          "weight": {"type": "number", "description": "In her unit (lb or kg). Omit to keep her usual weight."}
        },
        "required": ["name", "sets", "reps"]}},
      "reason": {"type": "string", "description": "One sentence, shown on the card."}
    },
    "required": ["exercises", "reason"]
  }
}
```

- `tool_choice` stays `auto` (forced tool choice is refused); the prompt
  says to call `proposeWorkout` in "Plan today" mode.
- `parseProposeWorkout(input, unit)` validates and clamps (sets 1–10, reps
  1–100, ≤ 12 exercises, names ≤ 60 chars, weight → kg), and returns null
  for unusable input (the turn then shows the text only).
- The proposal is never applied by the coach. The card shows it; she taps:
  - **Use for today** → `applyProposal`: builds today's session from the
    proposal (`coachAdjusted: true`), keeping completed sets of exercises
    with the same name if a session was already in progress; missing
    weights come from her records' last weight, else the split, else
    bodyweight. The saved split is untouched.
  - **Keep my plan** → status `kept`, nothing else changes.
  - **Save to my split** (shown after applying) → writes the proposal
    into the active split's day for today's weekday (new exercise ids);
    past logs are untouched.
- Tool loop: after a `proposeWorkout` call, the app does **not** call the
  model again (the card is the answer); the assistant message holds the
  text and the proposal. Any other tool name gets an `is_error` tool_result
  and one more call (max 3 calls per turn).

### History

`chat/<date>` keeps text only (`ChatMessage`); a proposal is replayed to the
model as text (`[Proposed for today: Squat 3×5 @ 135 lb, …; she chose: use
for today]`). Trimmed to the last 30 messages / 8 KB; the request includes
the last 12 messages. Chats older than 30 days are deleted at boot.

### Errors

`flinsh.ai.chat` rejects with `err.code`. `no_ai_key` → "Add your Anthropic
key in Flinsh Settings to turn on the coach". `rate_limited`,
`ai_budget_exceeded` → "The coach is catching its breath. Try again in a
bit." `ai_disabled_by_office` → "Your office has turned off AI for apps."
Anything else → "The coach couldn't answer. Try again." plus the code.
Errors appear as an inline assistant bubble (`error: true`) and in
`coachError`; nothing else in the app depends on AI.

### Standalone

`ai.ts` calls `https://api.anthropic.com/v1/messages` directly with a key
from `localStorage["split.apiKey"]` and
`anthropic-dangerous-direct-browser-access: true`. The key is never written
to the store and the field is hidden inside Flinsh. Model default
`claude-sonnet-5-5` (`thinking: {type: "between_tools"}`, effort `low`,
`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta).

## Reminders

`buildSchedule(split, reminders)` → one `ScheduledReminder` per workout day
whose reminder is on: `id: "workout-<weekday>"`, `title: "Legs at 5:30"`
(12-hour if her locale uses it, otherwise 24-hour, "Leg day" phrasing when
the name is a single body part is not attempted: it's "<Name> at <time>"),
`body` a short upbeat line, `time`, `weekday`. Re-synced whenever the split,
reminders or settings change. In-app mode: `dueBanners(now, schedule,
doneToday, dismissed)` returns today's reminder once its time has passed,
if no workout is done and it wasn't dismissed.

## Photos

`media.ts`:

- `files` mode (when `window.flinsh.files` exists): resize to a
  1600 px max edge, JPEG 0.85, `files.put(blob, {name: "split/photo/<id>.jpg", mime})`; `files.get(id)` returns a ~10 min signed URL, fetched fresh each time.
- `inline` mode (standalone, or no `files:user` grant): resize to a 640 px max edge, re-encode through a
  canvas (which strips EXIF), lower the JPEG quality from 0.8 in steps, and
  then the size, until the JPEG is ≤ 30 KB, ~40 KB as stored base64 (`fitJpeg`); store under
  `photo/<id>` (`id = <date>-<rand>`, so ids sort by date); keep the 20
  newest (`planEviction`) and delete the rest; the day's log keeps its
  48 px thumb (`photoId` stays; `loadPhoto` returns null for an evicted
  one, and the UI says "Full photo removed to save space").
- One photo per day: adding a new one replaces that day's photo.
- `fitJpeg(encode, maxBytes)` and `planEviction(ids, keep)` are pure and
  tested with a fake encoder (jsdom has no canvas).

## Testing

vitest (jsdom), `tests/` and colocated `*.test.ts`:

- `split.test.ts`: rename, reorder (move up/down, bounds), copy day,
  duplicate split (deep copy, new ids), activate (history), delete.
- `session.test.ts`: today resolution (weekday mapping incl. Sunday = 0,
  Monday-first order), picking another day, sessionFromPlan copies, complete
  /uncomplete/edit/markAll, swap/add/skip don't touch the split, finish moves
  to logs, survives reload (store round trip through the mock bridge).
- `history.test.ts`: PB detection (first session none; heaviest; reps at
  weight; bodyweight), streak with rest days and a missed day, day status,
  gym days, exercise history.
- `units.test.ts`: conversions, stepping on the display grid, formatting,
  reps parsing, volume.
- `coach.test.ts`: tool parsing (valid, strings, ranges, clamps, junk),
  runCoachTurn with a mocked AI (text-only; proposal; unknown tool; error
  codes), apply vs keep vs save behavior through actions.
- `reminders.test.ts`, `media.test.ts` (fitJpeg, eviction, budget),
  `storeSize.test.ts` (three-year projection).
- `smoke.test.tsx`: mock window.flinsh; onboarding with a template → edit the
  split → do today's workout with a weight change → finish → calendar shows
  it → next week shows last weights → coach proposes a shorter workout
  (mocked) → apply for today only (split unchanged).

Harness (`npm run verify:harness`, Playwright): the built file in an iframe
with `sandbox="allow-scripts allow-forms"` and the Flinsh CSP, a mock bridge
answered from Node, WebKit and Chromium: the main flow, zero console errors,
zero CSP violations, zero network requests; then again with `ai` rejecting
`no_ai_key` (everything except the coach works); screenshots at 390×844 and
430×932, both themes, every tab plus an active workout, with layout checks
(tap targets ≥ 44 px, set chips ≥ 48 px, text ≥ 16 px, nothing tappable in
the status band, no horizontal overflow).

## Module ownership (build phase)

| Area | Files |
|---|---|
| main thread | `src/types.ts`, `src/ui/styles/tokens.css`, docs, integration |
| UI | `src/main.tsx`, `src/ui/**` (except tokens.css) |
| data | `src/adapters/**`, `src/lib/{date,units,ids,reminders}.ts`, `src/data/**` |
| coach | `src/coach/**`, `src/lib/finishLines.ts` |
| tests | `tests/**`, `scripts/**` |
