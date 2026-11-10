import { useEffect, useRef, useState } from "preact/hooks";
import { actions } from "../../data/actions";
import { TEMPLATES } from "../../data/templates";
import { fromDisplay } from "../../lib/units";
import type { Goal, TemplateId, WeightUnit } from "../../types";

const GOALS: { value: Goal; label: string }[] = [
  { value: "muscle", label: "Build muscle" },
  { value: "fat", label: "Lose fat" },
  { value: "consistent", label: "Stay consistent" },
];

function num(s: string): number | undefined {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Three short full-screen steps, no tab bar. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [units, setUnits] = useState<WeightUnit>("lb");
  const [heightA, setHeightA] = useState(""); // cm, or feet
  const [heightB, setHeightB] = useState(""); // inches
  const [body, setBody] = useState("");
  const [goal, setGoal] = useState<Goal | undefined>(undefined);
  const [template, setTemplate] = useState<TemplateId>("upper-lower-4");
  const [error, setError] = useState("");
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step > 0) headRef.current?.focus();
    setError("");
  }, [step]);

  const heightCm = (): number | undefined => {
    if (units === "kg") return num(heightA);
    const ft = num(heightA) ?? 0;
    const inch = num(heightB) ?? 0;
    const total = ft * 12 + inch;
    return total > 0 ? Math.round(total * 2.54) : undefined;
  };

  const next = (e: Event) => {
    e.preventDefault();
    if (step === 0) {
      if (!name.trim()) {
        setError("Add a name so the app can greet you.");
        return;
      }
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else {
      const bw = num(body);
      actions.completeOnboarding({
        name: name.trim(),
        units,
        template,
        heightCm: heightCm(),
        bodyWeightKg: bw != null ? fromDisplay(bw, units) : undefined,
        goal,
      });
    }
  };

  return (
    <div class="app onb">
      <form class="onb-form" onSubmit={next} noValidate>
        <main class="main onb-main">
          <div class="wrap">
            <p class="eyebrow">Split · step {step + 1} of 3</p>
            <div class="onb-steps" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} class={i <= step ? "is-on" : ""} />
              ))}
            </div>

            {step === 0 && (
              <section class="onb-step">
                <h1 class="display" ref={headRef} tabIndex={-1}>
                  What should we call you?
                </h1>
                <p class="lead">Split keeps your week of training in one place: the plan, the sets you actually did, and the days you showed up.</p>
                <div class="field">
                  <label class="field-label" for="onb-name">
                    Your name
                  </label>
                  <input
                    id="onb-name"
                    class="input input--big"
                    type="text"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    maxLength={40}
                    value={name}
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? "onb-err" : undefined}
                    onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                  />
                  {error && (
                    <p id="onb-err" class="field-error">
                      {error}
                    </p>
                  )}
                </div>
              </section>
            )}

            {step === 1 && (
              <section class="onb-step">
                <h1 class="display" ref={headRef} tabIndex={-1}>
                  Pounds or kilos?
                </h1>
                <p class="lead">You can change this later in Me. The rest is optional and only helps the coach.</p>
                <fieldset class="field">
                  <legend class="field-label">Units</legend>
                  <div class="choices choices--row">
                    {(["lb", "kg"] as WeightUnit[]).map((u) => (
                      <label key={u} class={`choice choice--big${units === u ? " is-on" : ""}`}>
                        <input type="radio" name="units" class="radio-cover" checked={units === u} onChange={() => setUnits(u)} />
                        <span class="choice-name num">{u}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {units === "kg" ? (
                  <div class="field">
                    <label class="field-label" for="onb-h">
                      Height <span class="field-opt">cm, optional</span>
                    </label>
                    <input id="onb-h" class="input num" type="text" inputMode="decimal" value={heightA} onInput={(e) => setHeightA((e.currentTarget as HTMLInputElement).value)} />
                  </div>
                ) : (
                  <fieldset class="field">
                    <legend class="field-label">
                      Height <span class="field-opt">optional</span>
                    </legend>
                    <div class="pair">
                      <label class="pair-item">
                        <input class="input num" type="text" inputMode="numeric" aria-label="Height, feet" value={heightA} onInput={(e) => setHeightA((e.currentTarget as HTMLInputElement).value)} />
                        <span class="pair-unit">ft</span>
                      </label>
                      <label class="pair-item">
                        <input class="input num" type="text" inputMode="numeric" aria-label="Height, inches" value={heightB} onInput={(e) => setHeightB((e.currentTarget as HTMLInputElement).value)} />
                        <span class="pair-unit">in</span>
                      </label>
                    </div>
                  </fieldset>
                )}
                <div class="field">
                  <label class="field-label" for="onb-bw">
                    Body weight <span class="field-opt">{units}, optional</span>
                  </label>
                  <input id="onb-bw" class="input num" type="text" inputMode="decimal" value={body} onInput={(e) => setBody((e.currentTarget as HTMLInputElement).value)} />
                </div>
                <fieldset class="field">
                  <legend class="field-label">
                    Goal <span class="field-opt">optional</span>
                  </legend>
                  <div class="choices">
                    {GOALS.map((g) => (
                      <label key={g.value} class={`choice${goal === g.value ? " is-on" : ""}`}>
                        <input type="radio" name="goal" class="radio-cover" checked={goal === g.value} onChange={() => setGoal(g.value)} />
                        <span class="choice-name">{g.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>
            )}

            {step === 2 && (
              <section class="onb-step">
                <h1 class="display" ref={headRef} tabIndex={-1}>
                  Start your split
                </h1>
                <p class="lead">Pick a starting week. Every day, exercise and weight is yours to edit.</p>
                <fieldset class="field">
                  <legend class="sr">Starting split</legend>
                  <div class="choices">
                    {TEMPLATES.map((t) => (
                      <label key={t.id} class={`choice choice--tall${template === t.id ? " is-on" : ""}`}>
                        <input
                          type="radio"
                          name="template"
                          class="radio-cover"
                          aria-label={t.name}
                          aria-describedby={`tpl-${t.id}`}
                          checked={template === t.id}
                          onChange={() => setTemplate(t.id)}
                        />
                        <span class="choice-name">{t.name}</span>
                        <span class="choice-blurb" id={`tpl-${t.id}`}>
                          {t.blurb}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </section>
            )}
          </div>
        </main>
        <div class="onb-foot">
          <div class="wrap onb-actions">
            {step > 0 && (
              <button type="button" class="btn btn--quiet" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button type="submit" class="btn btn--primary btn--grow">
              {step === 2 ? "Start training" : "Continue"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
