/**
 * Hand the export JSON to her, the best way this place allows:
 *
 * - Flinsh with "downloads": flinsh.files.save(blob, filename), a download on
 *   the web and the share sheet in the phone app.
 * - Standalone: an <a download> click.
 * - Otherwise (or if save() rejects): the clipboard, and if that's refused too,
 *   the caller shows the JSON in a select-all box.
 */
import type { FlinshBridge } from "../types";

export type ExportMode = "files" | "download" | "clipboard";
export type ExportResult = "saved" | "downloaded" | "copied" | "manual";

export function exportModeFor(bridge: FlinshBridge | null): ExportMode {
  if (!bridge) return "download";
  return typeof bridge.files?.save === "function" ? "files" : "clipboard";
}

export interface ExportDeps {
  writeClipboard?: (text: string) => Promise<void>;
  download?: (blob: Blob, filename: string) => void;
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportJson(json: string, filename: string, bridge: FlinshBridge | null, deps: ExportDeps = {}): Promise<ExportResult> {
  const blob = () => new Blob([json], { type: "application/json" });
  const mode = exportModeFor(bridge);
  if (mode === "download") {
    (deps.download ?? anchorDownload)(blob(), filename);
    return "downloaded";
  }
  if (mode === "files") {
    try {
      await bridge!.files!.save!(blob(), filename);
      return "saved";
    } catch (e) {
      console.warn("[split] files.save failed; falling back to the clipboard", (e as { code?: string })?.code ?? e);
    }
  }
  try {
    const write = deps.writeClipboard ?? ((t: string) => navigator.clipboard.writeText(t));
    await write(json);
    return "copied";
  } catch {
    return "manual";
  }
}
