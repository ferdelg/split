import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { getState, useApp } from "../data/state";
import { actions } from "../data/actions";
import type { Settings, TabId, Toast } from "../types";
import { IconCalendar, IconClose, IconCoach, IconMe, IconSplit, IconToday } from "./icons";
import { finishConfetti, flash, spark } from "./motion";
import { Onboarding } from "./screens/Onboarding";
import { FinishBar, SummarySheet, Today } from "./screens/Today";
import { SplitScreen } from "./screens/Split";
import { CalendarScreen } from "./screens/Calendar";
import { CoachScreen } from "./screens/Coach";
import { MeScreen } from "./screens/Me";

const TABS: { id: TabId; label: string; icon: () => ComponentChildren }[] = [
  { id: "today", label: "Today", icon: () => <IconToday /> },
  { id: "split", label: "Split", icon: () => <IconSplit /> },
  { id: "calendar", label: "Calendar", icon: () => <IconCalendar /> },
  { id: "coach", label: "Coach", icon: () => <IconCoach /> },
  { id: "me", label: "Me", icon: () => <IconMe /> },
];

// ── Settings → <html> ──────────────────────────────────────────────────────

let systemQuery: MediaQueryList | null = null;
let systemListener: (() => void) | null = null;

function resolveTheme(pref: Settings["theme"]): "dark" | "light" {
  if (pref === "dark" || pref === "light") return pref;
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Reflect settings onto <html>: data-theme (system resolved and followed), data-motion, --text-scale. */
export function applySettings(s: Settings | undefined | null): void {
  if (!s) return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(s.theme));
  if (systemQuery && systemListener) {
    systemQuery.removeEventListener?.("change", systemListener);
    systemQuery = null;
    systemListener = null;
  }
  if (s.theme === "system" && typeof window.matchMedia === "function") {
    systemQuery = window.matchMedia("(prefers-color-scheme: light)");
    systemListener = () => root.setAttribute("data-theme", resolveTheme("system"));
    systemQuery.addEventListener?.("change", systemListener);
  }
  if (s.reduceMotion === "reduce" || s.reduceMotion === "full") root.setAttribute("data-motion", s.reduceMotion);
  else root.removeAttribute("data-motion");
  root.style.setProperty("--text-scale", String(s.textScale || 1));
}

export function applyInitialSettings(): void {
  try {
    applySettings(getState().settings);
  } catch {
    /* state not ready */
  }
}

// ── Pieces of the shell ────────────────────────────────────────────────────

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const id = setTimeout(() => actions.dismissToast(t.id), t.ttl ?? (t.action ? 7000 : 3500));
    return () => clearTimeout(id);
  }, [t.id]);
  return (
    <div class={`toast is-${t.kind}`}>
      <span class="toast-text">{t.text}</span>
      {t.action && (
        <button
          type="button"
          class="toast-action"
          onClick={() => {
            t.action!.run();
            actions.dismissToast(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

function Banners() {
  const banners = useApp((s) => s.banners);
  if (!banners || banners.length === 0) return null;
  return (
    <div class="banners">
      {banners.map((b) => (
        <div key={b.id} class="banner" role="status">
          <div class="banner-text">
            <p class="banner-title">{b.title}</p>
            {b.body && <p class="banner-body">{b.body}</p>}
          </div>
          <button type="button" class="icon-btn" aria-label={`Dismiss reminder: ${b.title}`} onClick={() => actions.dismissBanner(b.id)}>
            <IconClose />
          </button>
        </div>
      ))}
    </div>
  );
}

function Dock({ tab }: { tab: TabId }) {
  const toasts = useApp((s) => s.toasts);
  const storeStatus = useApp((s) => s.storeStatus);
  const floatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = floatRef.current;
    if (!el) return;
    const apply = () => el.closest<HTMLElement>(".app")?.style.setProperty("--dock-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div class="dock" ref={floatRef}>
      <div class="float">
        <div class="toasts" role="status" aria-live="polite">
          {storeStatus?.error && <div class="toast is-error">Couldn't save; will retry</div>}
          {toasts.map((t) => (
            <ToastItem key={t.id} t={t} />
          ))}
        </div>
      </div>
      {tab === "today" && <FinishBar />}
      <nav class="tabs" aria-label="Sections">
        <div class="tabs-inner" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              class="tab"
              aria-selected={tab === t.id ? "true" : "false"}
              aria-controls="panel"
              onClick={() => actions.setTab(t.id)}
            >
              {t.icon()}
              <span class="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Plays celebrations the data layer queues, then clears them. */
function useCelebrations() {
  const cel = useApp((s) => s.celebration);
  useEffect(() => {
    if (!cel) return;
    if (cel.kind === "finish") {
      setTimeout(() => finishConfetti(cel.pb), 140);
    } else if (cel.kind === "exercise") {
      const sel = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cel.exerciseId) : cel.exerciseId;
      const row = document.querySelector(`[data-ex="${sel}"]`);
      flash(row);
      const chips = row?.querySelectorAll(".chip");
      spark(chips && chips.length ? chips[chips.length - 1] : row);
    }
    actions.clearCelebration();
  }, [cel]);
}

function Shell() {
  const tab = useApp((s) => s.tab);
  const summary = useApp((s) => s.summary);
  const mainRef = useRef<HTMLElement>(null);
  useCelebrations();
  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [tab]);
  return (
    <div class={`app tab-${tab}`}>
      <main ref={mainRef} class="main" id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <div class="wrap">
          <Banners />
          {tab === "today" && <Today />}
          {tab === "split" && <SplitScreen />}
          {tab === "calendar" && <CalendarScreen />}
          {tab === "coach" && <CoachScreen />}
          {tab === "me" && <MeScreen />}
        </div>
      </main>
      <Dock tab={tab} />
      {summary && <SummarySheet />}
    </div>
  );
}

export function Loading() {
  return (
    <div class="app app--center">
      <p class="loading">Loading your split…</p>
    </div>
  );
}

export function App() {
  const ready = useApp((s) => s.ready);
  const profile = useApp((s) => s.profile);
  const settings = useApp((s) => s.settings);
  useEffect(() => applySettings(settings), [settings]);
  if (!ready) return <Loading />;
  if (!profile || !profile.onboardedAt) return <Onboarding />;
  return <Shell />;
}
