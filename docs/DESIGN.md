# Split: design

## Direction

**A training notebook.** It should feel like the Notion page it replaces got
a pencil and a pulse: calm, paper-and-ink surfaces, ruled hairlines, bold day
headers, and big rounded numbers you can read at arm's length between sets.
One strong accent (vermilion) marks what's done and the single primary action
on a screen. Energy comes from type weight, the set "pop", and the finish
moment, not from gradients or neon.

Not: purple, stock gradients, glassmorphism, neon on black, emoji walls,
motivational-poster copy, a fitness-bro look, icons in every row.

## Tokens

All in `src/ui/styles/tokens.css`; nothing else defines a color.

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | #121110 | #f5f2ec (paper) | page |
| `--surface` | #1c1b19 | #fffdf9 | cards, sheets |
| `--surface-2` | #262420 | #ece7de | inputs, undone chips |
| `--surface-3` | #312e29 | #e2dccf | pressed states |
| `--hairline` | #3a3732 | #d9d1c3 | ruled lines, borders |
| `--ink` | #f3efe7 | #1b1a17 | text |
| `--muted` | #b0a99c | #5d584e | secondary text (≥ 5.7:1) |
| `--faint` | #7d776c | #8a8478 | decoration only (≈ 3.7:1) |
| `--accent` | #ff7a45 | #c2410c | done chips, primary button, today ring |
| `--accent-ink` | #ff8a5c | #b23b0a | accent text/icons on bg |
| `--on-accent` | #1a0f08 | #ffffff | text on accent |
| `--accent-soft` | 16 % accent | 10 % accent | selected rows, PB highlight |

"Missed" on the calendar is a hollow `--faint` ring: never red. Errors use
`--error-ink` text in a normal card, never a red fill.

Type: `--font-ui` (system UI) for text; `--font-num` (`ui-rounded`, SF Pro
Rounded on iPhone) with `font-variant-numeric: tabular-nums` for every weight,
rep count, set chip and stat. Body 17 px, nothing under 16 px, scaled by
`--text-scale` (1 / 1.15 / 1.3 from Settings → Text size). Day headers: 34 px,
weight 850, tight tracking. Section labels: 16 px, weight 560, small caps
spacing, `--muted`.

Spacing on a 4 px grid, 16 px side gutter. Radii 10/14/20. Cards are
`--surface` with a 1 px `--hairline` border and no heavy shadow; sheets get
`--shadow`.

## Layout

- Phone-first, one column, `max-width: 560px` centered on desktop.
- Top: `padding-top: calc(var(--inset-top) + 12px)`; nothing tappable sits
  inside the status-bar band (`--inset-top`).
- Bottom tab bar fixed above the home indicator:
  `padding-bottom: var(--inset-bottom)`, 60 px tall, five tabs with a
  simple line icon and a label each. Active tab: `--ink` label + accent bar
  above the icon. Content scrolls inside `main` with bottom padding for the
  tab bar (and the sticky Finish bar when present).
- Primary actions live in the bottom half: "Finish workout" sticks above
  the tab bar during a session; sheets open from the bottom with their
  buttons at the bottom.
- Targets: ≥ 48 px everywhere, set chips 52 px. Steppers are 48 × 48 `−`/`+`
  with the value between them in `--fs-number`, so she rarely types.

## Today, the gym screen

```
 TUESDAY · NOV 10                         ▲ streak 6
 Legs                                                  (34 px, 850)
 ─────────────────────────────────────────────────────
 Squat                                         Adjust ⋯
 4 × 5 · 135 lb          Last: 135 × 5, 5, 5, 4
 [ 5 ] [ 5 ] [ ✓5 ] [ 5 ]          Mark all
 ─────────────────────────────────────────────────────
 Romanian deadlift …
 ...
 [ Add exercise for today ]
 Note for today  ______________________   [Add photo]
 ┌───────────────────────────────────────────────────┐
 │                Finish workout                     │  sticky, accent
 └───────────────────────────────────────────────────┘
 Today  Split  Calendar  Coach  Me
```

- A set chip shows the reps in big rounded numerals; when the set's weight
  differs from the exercise's planned weight, the weight shows small below.
  Done = accent fill, `--on-accent` text and a check mark. Tap toggles done;
  long-press (450 ms) or "Adjust" opens the steppers.
- Ruled hairlines between exercises (the notebook), not boxed cards.
- When an exercise is complete, its name gets a quiet strike-through-free
  "done" treatment: the row's numbers go `--muted`, a small accent check
  sits before the name.

## Motion

All ≤ 250 ms (`--dur-*`), zero under reduced motion.

- **Set pop**: chip scales 1 → 1.12 → 1 over 180 ms with `--ease-pop`, fill
  fades in.
- **Exercise done**: the row's background flashes `--accent-soft` for 240 ms
  and the check scales in; a tiny 8-piece spark burst from the last chip.
- **Finish**: a confetti burst (≈ 80 pieces, accent + ink + muted + paper
  colors, canvas, ≈ 1.2 s fall, no loop) behind the summary sheet. Under
  reduced motion: no confetti, the summary fades in (opacity only).
- **Personal best**: a second, smaller burst when the summary lists a PB.
- Sheets slide up 240 ms; tabs switch with no animation.
- `navigator.vibrate(10)` on set completion where available (silent no-op
  on iOS).

## Copy

Short, upbeat, specific, like a friend who lifts. Sentence case. No
exclamation pile-ups (one at most), no emoji. Numbers over adjectives
("4 sets, 3,240 lb" beats "Great volume!").

- Finish lines: a pool of ≥ 40 (`src/lib/finishLines.ts`), never the same
  one twice in 7 days.
- Rest day: "Rest day. Recovery is part of the plan." with "Log an extra
  workout".
- Missed (calendar sheet): "No workout logged." (no guilt).
- Empty split day: "Nothing here yet. Add the first exercise."
- Errors: say what happened and what to do; never blame.

## Accessibility

- Set chips: `aria-label="Squat, set 2 of 4, not done"` /
  `"Squat, set 2 of 4, done, 5 reps at 135 lb"`, `aria-pressed`.
- Every icon button has an accessible name; every sheet is a `dialog` with
  a name, focus moves into it and back.
- Text size setting; `prefers-reduced-motion` and a motion override.
- Contrast ≥ 4.5:1 for all text in both themes (see tokens.css header).
- `lang="en"`, logical heading order (one `h1` per screen).
