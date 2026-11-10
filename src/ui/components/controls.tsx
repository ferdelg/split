/** Small form controls: Stepper, Segmented, Toggle, Field. */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { IconMinus, IconPlus } from "../icons";

/**
 * −/value/+ with 48 px buttons. `noun` builds the names: "Increase weight",
 * plus `suffix` (", set 2") when given.
 */
export function Stepper(props: {
  noun: string;
  suffix?: string;
  value: ComponentChildren;
  onStep: (dir: 1 | -1) => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
  /** Visible label above the control. */
  label?: string;
  compact?: boolean;
}) {
  const sfx = props.suffix ?? "";
  const down = props.canDecrease !== false;
  const up = props.canIncrease !== false;
  return (
    <div class={`stepper${props.compact ? " stepper--compact" : ""}`}>
      {props.label && <span class="stepper-label">{props.label}</span>}
      <div class="stepper-row">
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Decrease ${props.noun}${sfx}`}
          aria-disabled={down ? undefined : "true"}
          onClick={() => down && props.onStep(-1)}
        >
          <IconMinus />
        </button>
        <output class="stepper-value num" aria-live="polite">
          {props.value}
        </output>
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Increase ${props.noun}${sfx}`}
          aria-disabled={up ? undefined : "true"}
          onClick={() => up && props.onStep(1)}
        >
          <IconPlus />
        </button>
      </div>
    </div>
  );
}

/** A radio group drawn as a segmented control. */
export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div class="field">
      <span id={id} class={props.hideLabel ? "sr" : "field-label"}>
        {props.label}
      </span>
      <div class="segmented" role="radiogroup" aria-labelledby={id}>
        {props.options.map((o) => (
          <label key={String(o.value)} class={`segmented-opt${o.value === props.value ? " is-on" : ""}`}>
            <input
              type="radio"
              class="radio-cover"
              name={id}
              checked={o.value === props.value}
              onChange={() => props.onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** role=switch toggle. The visible text is the name unless `ariaLabel` is given. */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; ariaLabel?: string; hint?: string; disabled?: boolean }) {
  const hintId = useId();
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      class="toggle"
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.ariaLabel}
      aria-labelledby={props.ariaLabel ? undefined : labelId}
      aria-describedby={props.hint ? hintId : undefined}
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
    >
      <span class="toggle-text">
        <span id={labelId} class="toggle-label">
          {props.label}
        </span>
        {props.hint && (
          <span id={hintId} class="toggle-hint">
            {props.hint}
          </span>
        )}
      </span>
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
    </button>
  );
}

/** Label + control + optional hint. */
export function Field(props: { label: string; id: string; hint?: string; children: ComponentChildren }) {
  return (
    <div class="field">
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.hint && <p class="field-hint">{props.hint}</p>}
    </div>
  );
}

/** A bare role=switch (the row around it shows the text; `label` is its accessible name). */
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked={props.checked ? "true" : "false"}
      aria-label={props.label}
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
    >
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
    </button>
  );
}
