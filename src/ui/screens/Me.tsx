import { useEffect, useRef, useState } from "preact/hooks";
import { getState, useApp } from "../../data/state";
import { actions } from "../../data/actions";
import { activeSplit } from "../../data/split";
import { buildCoachContext } from "../../coach/context";
import { buildSystemPrompt } from "../../coach/prompt";
import { getApiKey } from "../../adapters/ai";
import { saveApiKey } from "../../data/actions";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, WEEK_ORDER, formatTime } from "../../lib/date";
import { defaultStep, fromDisplay, roundDisplay, toDisplay } from "../../lib/units";
import type { Capabilities, Goal, MotionPref, ThemePref, WeightUnit } from "../../types";
import { Sheet } from "../components/Sheet";
import { Segmented, Switch, Toggle } from "../components/controls";

function num(s: string): number | undefined {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A text input that saves on blur / Enter. */
function BlurInput(props: {
  id: string;
  value: string;
  onSave: (v: string) => void;
  inputMode?: "text" | "decimal" | "numeric";
  ariaLabel?: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  class?: string;
}) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <input
      id={props.id}
      class={`input ${props.class ?? ""}`}
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      aria-label={props.ariaLabel}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      enterKeyHint="done"
      value={v}
      onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)}
      onBlur={() => v !== props.value && props.onSave(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSection() {
  const profile = useApp((s) => s.profile)!;
  const unit = profile.units;
  const ftIn = profile.heightCm ? Math.round(profile.heightCm / 2.54) : 0;
  return (
    <section class="section" aria-labelledby="me-profile">
      <h2 id="me-profile" class="section-label">
        Profile
      </h2>
      <div class="field">
        <label class="field-label" for="me-name">
          Name
        </label>
        <BlurInput id="me-name" value={profile.name} maxLength={40} onSave={(v) => v.trim() && actions.updateProfile({ name: v.trim() })} />
      </div>
      <div class="field-row">
        {unit === "kg" ? (
          <div class="field">
            <label class="field-label" for="me-h">
              Height, cm
            </label>
            <BlurInput id="me-h" class="num" inputMode="decimal" value={profile.heightCm ? String(profile.heightCm) : ""} onSave={(v) => actions.updateProfile({ heightCm: num(v) })} />
          </div>
        ) : (
          <div class="field">
            <span class="field-label" id="me-h-l">
              Height
            </span>
            <div class="pair" role="group" aria-labelledby="me-h-l">
              <label class="pair-item">
                <BlurInput
                  id="me-h-ft"
                  class="num"
                  inputMode="numeric"
                  ariaLabel="Height, feet"
                  value={ftIn ? String(Math.floor(ftIn / 12)) : ""}
                  onSave={(v) => {
                    const ft = num(v) ?? 0;
                    const total = ft * 12 + (ftIn % 12);
                    actions.updateProfile({ heightCm: total > 0 ? Math.round(total * 2.54) : undefined });
                  }}
                />
                <span class="pair-unit">ft</span>
              </label>
              <label class="pair-item">
                <BlurInput
                  id="me-h-in"
                  class="num"
                  inputMode="numeric"
                  ariaLabel="Height, inches"
                  value={ftIn ? String(ftIn % 12) : ""}
                  onSave={(v) => {
                    const total = Math.floor(ftIn / 12) * 12 + (num(v) ?? 0);
                    actions.updateProfile({ heightCm: total > 0 ? Math.round(total * 2.54) : undefined });
                  }}
                />
                <span class="pair-unit">in</span>
              </label>
            </div>
          </div>
        )}
        <div class="field">
          <label class="field-label" for="me-bw">
            Body weight, {unit}
          </label>
          <BlurInput
            id="me-bw"
            class="num"
            inputMode="decimal"
            value={profile.bodyWeightKg ? String(roundDisplay(toDisplay(profile.bodyWeightKg, unit))) : ""}
            onSave={(v) => {
              const n = num(v);
              actions.updateProfile({ bodyWeightKg: n != null ? fromDisplay(n, unit) : undefined });
            }}
          />
        </div>
      </div>
      <Segmented<Goal | "none">
        label="Goal"
        value={profile.goal ?? "none"}
        options={[
          { value: "muscle", label: "Muscle" },
          { value: "fat", label: "Fat loss" },
          { value: "consistent", label: "Consistency" },
        ]}
        onChange={(g) => actions.updateProfile({ goal: g === "none" ? undefined : g })}
      />
    </section>
  );
}

// ── Reminders ──────────────────────────────────────────────────────────────

function RemindersSection() {
  const reminders = useApp((s) => s.settings.reminders);
  const splits = useApp((s) => s.splits);
  const mode = useApp((s) => s.caps.notifications);
  const split = activeSplit(splits);
  const days = WEEK_ORDER.filter((wd) => split?.days[wd].kind === "workout");
  return (
    <section class="section" aria-labelledby="me-rem">
      <h2 id="me-rem" class="section-label">
        Reminders
      </h2>
      <Toggle
        label="Workout reminders"
        hint={reminders.enabled ? "On for the days switched on below." : "Off. Nothing will remind you."}
        checked={reminders.enabled}
        onChange={(v) => actions.updateSettings({ reminders: { ...reminders, enabled: v } })}
      />
      {mode === "in-app" && <p class="note-line">Notifications aren't available here, so reminders show as banners while Split is open.</p>}
      {days.length === 0 ? (
        <p class="empty">No workout days in your split yet.</p>
      ) : (
        <ul class={`rem-list${reminders.enabled ? "" : " is-off"}`}>
          {days.map((wd) => {
            const r = reminders.byWeekday[wd] ?? { on: false, time: "17:30" };
            return (
              <li key={wd} class="rem-row">
                <span class="rem-label">
                  <span class="rem-name">{split!.days[wd].name}</span>
                  <span class="rem-day">
                    {WEEKDAY_SHORT[wd]}
                    {r.on ? ` · ${formatTime(r.time)}` : ""}
                  </span>
                </span>
                <input
                  class="input input--time num"
                  type="time"
                  aria-label={`Reminder time, ${WEEKDAY_NAMES[wd]}`}
                  value={r.time}
                  disabled={!reminders.enabled}
                  onChange={(e) => {
                    const t = (e.currentTarget as HTMLInputElement).value;
                    if (t) actions.setReminder(wd, { time: t, on: true });
                  }}
                />
                <Switch label={`Remind me on ${WEEKDAY_NAMES[wd]}`} checked={r.on} disabled={!reminders.enabled} onChange={(v) => actions.setReminder(wd, { on: v })} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

function ApiKeyField() {
  const [has, setHas] = useState(() => !!getApiKey());
  const [v, setV] = useState("");
  return (
    <div class="field">
      <label class="field-label" for="me-key">
        Anthropic API key
      </label>
      {has ? (
        <div class="key-row">
          <p class="muted">Saved in this browser only. It never goes into your Split data or exports.</p>
          <button
            type="button"
            class="btn btn--secondary"
            onClick={() => {
              saveApiKey(null);
              setHas(false);
              actions.toast("Key removed", "info");
            }}
          >
            Remove key
          </button>
        </div>
      ) : (
        <form
          class="composer"
          onSubmit={(e) => {
            e.preventDefault();
            const k = v.trim();
            if (!k) return;
            saveApiKey(k);
            setV("");
            setHas(true);
            actions.toast("Key saved in this browser", "success");
          }}
        >
          <input id="me-key" class="input" type="password" autoComplete="off" placeholder="sk-ant-…" value={v} onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)} />
          <button type="submit" class="btn btn--secondary">
            Save key
          </button>
        </form>
      )}
    </div>
  );
}

function SettingsSection({ onPrompt }: { onPrompt: () => void }) {
  const settings = useApp((s) => s.settings);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const inFlinsh = useApp((s) => s.caps.inFlinsh);
  return (
    <section class="section" aria-labelledby="me-set">
      <h2 id="me-set" class="section-label">
        Settings
      </h2>
      <Segmented<WeightUnit>
        label="Units"
        value={unit}
        options={[
          { value: "lb", label: "lb" },
          { value: "kg", label: "kg" },
        ]}
        onChange={(u) => {
          actions.updateProfile({ units: u });
          actions.updateSettings({ weightStep: defaultStep(u) });
        }}
      />
      <Segmented<number>
        label="Weight step"
        value={settings.weightStep}
        options={[
          { value: 2.5, label: `2.5 ${unit}` },
          { value: 5, label: `5 ${unit}` },
        ]}
        onChange={(v) => actions.updateSettings({ weightStep: v })}
      />
      <Segmented<ThemePref>
        label="Theme"
        value={settings.theme}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System" },
        ]}
        onChange={(v) => actions.updateSettings({ theme: v })}
      />
      <Segmented<number>
        label="Text size"
        value={settings.textScale}
        options={[
          { value: 1, label: "Default" },
          { value: 1.15, label: "Large" },
          { value: 1.3, label: "Larger" },
        ]}
        onChange={(v) => actions.updateSettings({ textScale: v })}
      />
      <Segmented<MotionPref>
        label="Motion"
        value={settings.reduceMotion}
        options={[
          { value: "system", label: "System" },
          { value: "reduce", label: "Reduced" },
          { value: "full", label: "Full" },
        ]}
        onChange={(v) => actions.updateSettings({ reduceMotion: v })}
      />
      {!inFlinsh && (
        <>
          <div class="field">
            <label class="field-label" for="me-model">
              Coach model
            </label>
            <BlurInput id="me-model" value={settings.model} onSave={(v) => v.trim() && actions.updateSettings({ model: v.trim() })} />
          </div>
          <ApiKeyField />
        </>
      )}
      <button type="button" class="btn btn--secondary btn--block" onClick={onPrompt}>
        What the coach sees
      </button>
    </section>
  );
}

// ── Capabilities ───────────────────────────────────────────────────────────

function capRows(c: Capabilities): { name: string; mode: string; why: string }[] {
  return [
    {
      name: "Storage",
      mode: c.store === "flinsh" ? "Flinsh store" : c.store === "local" ? "This browser" : "Memory only",
      why:
        c.store === "flinsh"
          ? "Saved to your Flinsh account, so it follows you."
          : c.store === "local"
            ? "Flinsh store isn't here, so data stays in this browser's local storage."
            : "No storage is available here. Workouts last until Split closes; export before you go.",
    },
    {
      name: "Coach",
      mode: c.ai === "flinsh" ? "Flinsh AI" : c.ai === "direct" ? "Direct to Anthropic" : "Off",
      why:
        c.ai === "flinsh"
          ? "Uses the Anthropic key in your Flinsh Settings."
          : c.ai === "direct"
            ? "Calls Anthropic with the key saved in this browser."
            : "No AI here. Add a key to turn it on; nothing else depends on it.",
    },
    {
      name: "Reminders",
      mode: c.notifications === "live" ? "System notifications" : "In-app banners",
      why: c.notifications === "live" ? "Flinsh schedules them, even with Split closed." : "Notifications aren't available here, so reminders show as banners while Split is open.",
    },
    {
      name: "Photos",
      mode: c.photos === "files" ? "Flinsh files" : "Small photos in your data",
      why:
        c.photos === "files"
          ? "Full-size photos are stored as files."
          : "Resized to 640 px and kept under 40 KB; the 20 newest are kept, older days keep a small thumbnail.",
    },
    {
      name: "Screen awake",
      mode: { on: "On during a workout", untested: "Tried at your next workout", blocked: "Not allowed here", unsupported: "Not available" }[c.wakeLock],
      why: {
        on: "The screen stays on while a workout is in progress.",
        untested: "Split asks to keep the screen on when a workout starts; this shows what happened.",
        blocked: "Split asked to keep the screen on and was refused, so the phone may sleep between sets. Raise auto-lock in iPhone Settings if that's annoying.",
        unsupported: "This browser can't keep the screen on, so it may sleep between sets.",
      }[c.wakeLock],
    },
  ];
}

function CapabilitiesSection() {
  const caps = useApp((s) => s.caps);
  return (
    <section class="section" aria-labelledby="me-caps">
      <h2 id="me-caps" class="section-label">
        Capabilities
      </h2>
      <p class="muted">{caps.inFlinsh ? "Running inside Flinsh." : "Running on its own, outside Flinsh."} Nothing here is faked: this is what's working right now.</p>
      <dl class="caps">
        {capRows(caps).map((r) => (
          <div key={r.name} class="cap">
            <dt class="cap-name">{r.name}</dt>
            <dd class="cap-mode">{r.mode}</dd>
            <dd class="cap-why">{r.why}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────

function DataSection({ onShowExport }: { onShowExport: (json: string) => void }) {
  const inFlinsh = useApp((s) => s.caps.inFlinsh);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  const doExport = async () => {
    setBusy(true);
    try {
      const json = await actions.exportData();
      if (!inFlinsh) {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `split-${getState().today}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        actions.toast("Exported your data", "success");
      } else {
        // Downloads are blocked in the Flinsh sandbox: clipboard, else a select-all box.
        try {
          await navigator.clipboard.writeText(json);
          actions.toast("Copied your data. Paste it somewhere safe.", "success");
        } catch {
          onShowExport(json);
        }
      }
    } catch {
      actions.toast("Couldn't export right now. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="section" aria-labelledby="me-data">
      <h2 id="me-data" class="section-label">
        Your data
      </h2>
      <button type="button" class="btn btn--secondary btn--block" aria-busy={busy ? "true" : undefined} onClick={() => void doExport()}>
        Export my data
      </button>
      {!confirm ? (
        <button type="button" class="btn btn--quiet btn--block btn--danger-text" onClick={() => setConfirm(true)}>
          Delete everything
        </button>
      ) : (
        <div class="card card--danger" role="group" aria-label="Confirm delete">
          <p>This deletes your splits, every logged workout, photos and chats. There's no undo.</p>
          <div class="row-actions">
            <button ref={cancelRef} type="button" class="btn btn--secondary" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn--danger btn--grow"
              onClick={async () => {
                setBusy(true);
                try {
                  await actions.deleteEverything();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Yes, delete everything
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function MeScreen() {
  const name = useApp((s) => s.profile?.name ?? "");
  const [sheet, setSheet] = useState<{ kind: "prompt"; text: string } | { kind: "export"; json: string } | null>(null);
  return (
    <section class="screen" aria-labelledby="me-title">
      <header class="screen-head">
        <p class="eyebrow">Me</p>
        <h1 id="me-title" class="display">
          {name || "You"}
        </h1>
      </header>
      <ProfileSection />
      <RemindersSection />
      <SettingsSection onPrompt={() => setSheet({ kind: "prompt", text: buildSystemPrompt(buildCoachContext(getState())) })} />
      <CapabilitiesSection />
      <DataSection onShowExport={(json) => setSheet({ kind: "export", json })} />
      <p class="colophon">Split keeps everything in your own storage. No accounts, no tracking.</p>

      {sheet?.kind === "prompt" && (
        <Sheet title="What the coach sees" onClose={() => setSheet(null)} full>
          <p class="muted">This exact text goes to the coach with each message. Photos and your API key never do.</p>
          <pre class="prompt">{sheet.text}</pre>
        </Sheet>
      )}
      {sheet?.kind === "export" && (
        <Sheet title="Export my data" onClose={() => setSheet(null)} full>
          <p class="muted">Downloads are blocked here. Select all, copy, and paste it somewhere safe.</p>
          <textarea
            class="input export-box"
            readOnly
            aria-label="Exported data"
            value={sheet.json}
            data-autofocus
            onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
          />
          <button
            type="button"
            class="btn btn--secondary btn--block"
            onClick={(e) => {
              const ta = (e.currentTarget as HTMLElement).parentElement?.querySelector("textarea");
              ta?.focus();
              ta?.select();
            }}
          >
            Select all
          </button>
        </Sheet>
      )}
    </section>
  );
}
