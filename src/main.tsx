import { render } from "preact";
import "./ui/styles/tokens.css";
import "./ui/styles/base.css";
import "./ui/styles/components.css";
import { installInsetListener } from "./adapters/insets";
import { initApp } from "./data/state";
import { App, Loading, applyInitialSettings } from "./ui/App";

// Listen before anything else so an early inset message from the shell isn't lost.
installInsetListener();

function BootError({ message }: { message: string }) {
  return (
    <div class="app app--center">
      <div class="card boot-error" role="alert">
        <h1 class="card-title">Split couldn't start</h1>
        <p>Something went wrong while loading. Your saved workouts are untouched.</p>
        <p class="muted">Close Split and open it again. If it keeps happening, this detail helps: {message}</p>
      </div>
    </div>
  );
}

async function boot() {
  const root = document.getElementById("app")!;
  render(<Loading />, root);
  try {
    await initApp();
    applyInitialSettings();
    render(<App />, root);
  } catch (err) {
    render(<BootError message={err instanceof Error ? err.message : String(err)} />, root);
  }
  try {
    window.flinsh?.ready?.();
  } catch {
    /* the shell's ready hook is optional */
  }
}

void boot();
