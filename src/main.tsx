import { render } from "preact";
import "./ui/styles/tokens.css";
import "./ui/styles/base.css";
import "./ui/styles/components.css";
import { installInsetListener } from "./adapters/insets";
import { LoadError, initApp, resetApp } from "./data/state";
import { App, Loading, applyInitialSettings } from "./ui/App";

// Listen before anything else so an early inset message from the shell isn't lost.
installInsetListener();

function BootError({ error }: { error: unknown }) {
  const loading = error instanceof LoadError;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div class="app app--center">
      <div class="card boot-error" role="alert">
        <h1 class="card-title">{loading ? "Couldn't load your data" : "Split couldn't start"}</h1>
        <p>
          {loading
            ? "Your workouts are safe; Split just couldn't read them right now. Nothing was changed."
            : "Something went wrong while loading. Your saved workouts are untouched."}
        </p>
        <button
          type="button"
          class="btn btn--primary btn--block"
          onClick={() => {
            resetApp();
            void boot();
          }}
        >
          Try again
        </button>
        <p class="muted">If it keeps happening, this detail helps: {message}</p>
      </div>
    </div>
  );
}

let readySent = false;

async function boot() {
  const root = document.getElementById("app")!;
  render(<Loading />, root);
  try {
    await initApp();
    applyInitialSettings();
    render(<App />, root);
  } catch (err) {
    render(<BootError error={err} />, root);
  }
  if (readySent) return;
  readySent = true;
  try {
    window.flinsh?.ready?.();
  } catch {
    /* the shell's ready hook is optional */
  }
}

void boot();
