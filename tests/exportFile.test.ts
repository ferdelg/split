/** Export: files.save inside Flinsh, a download standalone, the clipboard as the fallback. */
import { describe, expect, it, vi } from "vitest";
import { exportJson, exportModeFor } from "../src/adapters/exportFile";
import { createMockFlinsh } from "./helpers/mockFlinsh";
import type { FlinshBridge, FlinshFilesApi } from "../src/types";

const JSON_TEXT = JSON.stringify({ app: "split", v: 1 });

function bridgeWith(save?: FlinshFilesApi["save"]): FlinshBridge {
  const b = createMockFlinsh().bridge;
  b.files = { put: vi.fn(), get: vi.fn(), delete: vi.fn(), ...(save ? { save } : {}) } as unknown as FlinshFilesApi;
  return b;
}

describe("export", () => {
  it("picks the mode from the bridge", () => {
    expect(exportModeFor(null)).toBe("download");
    expect(exportModeFor(createMockFlinsh().bridge)).toBe("clipboard");
    expect(exportModeFor(bridgeWith())).toBe("clipboard");
    expect(exportModeFor(bridgeWith(async () => true))).toBe("files");
  });

  it("uses flinsh.files.save(blob, filename) with the JSON file", async () => {
    const save = vi.fn(async (_b: Blob, _n: string) => true);
    const writeClipboard = vi.fn(async () => {});
    const r = await exportJson(JSON_TEXT, "split-2026-11-10.json", bridgeWith(save), { writeClipboard });
    expect(r).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe("split-2026-11-10.json");
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(JSON_TEXT);
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when save() rejects, then to the manual box", async () => {
    const denied = Object.assign(new Error("no downloads"), { code: "permission_denied" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeClipboard = vi.fn(async () => {});
    expect(await exportJson(JSON_TEXT, "x.json", bridgeWith(async () => Promise.reject(denied)), { writeClipboard })).toBe("copied");
    expect(writeClipboard).toHaveBeenCalledWith(JSON_TEXT);
    const refuse = vi.fn(async () => Promise.reject(new Error("NotAllowedError")));
    expect(await exportJson(JSON_TEXT, "x.json", bridgeWith(async () => Promise.reject(denied)), { writeClipboard: refuse })).toBe("manual");
    warn.mockRestore();
  });

  it("copies without files.save, and downloads standalone", async () => {
    const writeClipboard = vi.fn(async () => {});
    expect(await exportJson(JSON_TEXT, "x.json", createMockFlinsh().bridge, { writeClipboard })).toBe("copied");
    const download = vi.fn();
    expect(await exportJson(JSON_TEXT, "split.json", null, { download, writeClipboard })).toBe("downloaded");
    expect(download.mock.calls[0][1]).toBe("split.json");
  });
});
