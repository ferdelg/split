import { useId, useState } from "preact/hooks";
import { searchExercises } from "../../coach/library";

/**
 * Text input "Exercise name" with library suggestions underneath. Free text
 * is always fine: suggestions only help her type less.
 */
export function ExercisePicker(props: { value: string; onChange: (v: string) => void; autofocus?: boolean; onSubmit?: () => void }) {
  const id = useId();
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const q = props.value.trim();
  const hits = q.length > 0 ? searchExercises(q, 6).filter((e) => e.name.toLowerCase() !== q.toLowerCase()) : [];
  const show = focused && hits.length > 0;
  return (
    <div class="field picker">
      <label class="field-label" for={id}>
        Exercise name
      </label>
      <input
        id={id}
        class="input"
        type="text"
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={60}
        value={props.value}
        data-autofocus={props.autofocus ? "" : undefined}
        aria-controls={show ? listId : undefined}
        onInput={(e) => props.onChange((e.currentTarget as HTMLInputElement).value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setFocused(false);
            props.onSubmit?.();
          }
        }}
      />
      {show && (
        <ul id={listId} class="picker-list" aria-label="Suggestions">
          {hits.map((h) => (
            <li key={h.name}>
              <button
                type="button"
                class="picker-opt"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  props.onChange(h.name);
                  setFocused(false);
                }}
              >
                <span>{h.name}</span>
                <span class="picker-group">{h.group}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
