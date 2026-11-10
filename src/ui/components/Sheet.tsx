import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { IconClose } from "../icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]") && el.offsetParent !== null);
}

/** Open sheets, innermost last: only the top one handles Esc / Tab. */
const stack: number[] = [];
let seq = 0;

/** Everything behind the top sheet is inert (the app and lower sheets). */
function syncInert(): void {
  const app = document.getElementById("app");
  const hosts = Array.from(document.querySelectorAll<HTMLElement>("body > .sheet-host"));
  const set = (el: HTMLElement | null, on: boolean) => {
    if (!el) return;
    if (on) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  };
  set(app, hosts.length > 0);
  hosts.forEach((h, i) => set(h, i < hosts.length - 1));
}

export interface SheetProps {
  /** Visible heading. */
  title: ComponentChildren;
  /** Accessible name when the visible title isn't the right one (e.g. "Workout summary"). */
  label?: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** Full-height (day editor). */
  full?: boolean;
  /** Opacity-only entrance (the summary under reduced motion). */
  fade?: boolean;
  class?: string;
}

/**
 * Bottom sheet dialog. Mount only while open. Focus moves in (to
 * `[data-autofocus]` or the panel), is trapped, Esc / scrim close, and focus
 * returns to the opener on unmount.
 */
export function Sheet(props: SheetProps) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "sheet-host";
    document.body.appendChild(el);
    return el;
  });
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

  useEffect(() => {
    const me = ++seq;
    stack.push(me);
    syncInert();
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current!;
    const auto = node.querySelector<HTMLElement>("[data-autofocus]");
    try {
      (auto ?? node).focus({ preventScroll: true });
    } catch {
      (auto ?? node).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me || !panel.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(panel.current);
      if (list.length === 0) {
        e.preventDefault();
        panel.current.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      // Let the portal unmount first, then restore inertness and focus.
      setTimeout(() => {
        host.remove();
        syncInert();
        if (opener && opener.isConnected && typeof opener.focus === "function") {
          try {
            opener.focus({ preventScroll: true });
          } catch {
            opener.focus();
          }
        }
      }, 0);
    };
  }, []);

  const cls = ["sheet", props.full ? "sheet--full" : "", props.fade ? "sheet--fade" : "", props.class ?? ""].filter(Boolean).join(" ");
  return createPortal(
    <div class="sheet-root">
      <div class="scrim" aria-hidden="true" onClick={() => closeRef.current()} />
      <div
        ref={panel}
        class={cls}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        aria-labelledby={props.label ? undefined : titleId}
        tabIndex={-1}
      >
        <div class="sheet-head">
          <h2 id={titleId} class="sheet-title">
            {props.title}
          </h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={() => closeRef.current()}>
            <IconClose />
          </button>
        </div>
        <div class="sheet-body">{props.children}</div>
        {props.footer && <div class="sheet-foot">{props.footer}</div>}
      </div>
    </div>,
    host,
  );
}
