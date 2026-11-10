import { useRef } from "preact/hooks";
import type { SetLog, WeightUnit } from "../../types";
import { IconCheck } from "../icons";
import { w, wn } from "../format";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

/**
 * One set. Tap toggles done; long-press (450 ms) opens the adjust sheet.
 * Keyboard: Enter/Space toggles (click), the row's Adjust button is the
 * accessible path to the steppers.
 */
export function SetChip(props: {
  exercise: string;
  index: number;
  total: number;
  set: SetLog;
  unit: WeightUnit;
  /** The exercise's headline weight; the chip shows its own weight when it differs. */
  plannedKg: number | null;
  onToggle: (el: HTMLElement) => void;
  onLongPress: () => void;
  disabled?: boolean;
}) {
  const { set, unit } = props;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const label = set.done
    ? `${props.exercise}, set ${props.index + 1} of ${props.total}, done, ${set.reps} reps at ${w(set.weightKg, unit)}`
    : `${props.exercise}, set ${props.index + 1} of ${props.total}, not done`;

  const differs =
    (set.weightKg == null) !== (props.plannedKg == null) ||
    (set.weightKg != null && props.plannedKg != null && Math.abs(set.weightKg - props.plannedKg) > 0.01);

  return (
    <button
      type="button"
      class={`chip${set.done ? " is-done" : ""}`}
      aria-pressed={set.done ? "true" : "false"}
      aria-label={label}
      aria-disabled={props.disabled ? "true" : undefined}
      onPointerDown={(e) => {
        if (props.disabled) return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          timer.current = null;
          props.onLongPress();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE)) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (fired.current) {
          fired.current = false;
          e.preventDefault();
          return;
        }
        if (props.disabled) return;
        props.onToggle(e.currentTarget as HTMLElement);
      }}
    >
      {set.done && (
        <span class="chip-check" aria-hidden="true">
          <IconCheck size={14} />
        </span>
      )}
      <span class="chip-reps num">{set.reps}</span>
      {differs && <span class="chip-weight num">{wn(set.weightKg, unit) === "bodyweight" ? "bw" : wn(set.weightKg, unit)}</span>}
    </button>
  );
}
