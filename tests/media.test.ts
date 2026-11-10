/** Photos: the pure helpers and the inline (store) adapter with a fake canvas. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHOTO_KEEP, PHOTO_MAX_BYTES, createMediaAdapter, dataUrlBytes, fitJpeg, planEviction } from "../src/adapters/media";
import { createStoreAdapter, flinshRaw } from "../src/adapters/store";
import { createMockFlinsh } from "./helpers/mockFlinsh";
import type { StoredPhoto } from "../src/types";

/** A JPEG data URL whose base64 payload decodes to exactly `n` bytes. */
function jpegOf(n: number): string {
  const full = Math.floor(n / 3);
  const rem = n % 3;
  const b64 = "A".repeat(full * 4) + (rem === 1 ? "AA==" : rem === 2 ? "AAA=" : "");
  return `data:image/jpeg;base64,${b64}`;
}

describe("dataUrlBytes", () => {
  it("decodes the payload size, padding included", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,QUJD")).toBe(3);
    expect(dataUrlBytes("data:image/jpeg;base64,QUI=")).toBe(2);
    expect(dataUrlBytes("data:image/jpeg;base64,QQ==")).toBe(1);
    expect(dataUrlBytes("data:image/jpeg;base64,")).toBe(0);
    for (const n of [0, 1, 2, 3, 1234, 40_000]) expect(dataUrlBytes(jpegOf(n))).toBe(n);
  });
});

describe("fitJpeg", () => {
  // Payload ~ 100 KB × quality × scale².
  const fake = () => {
    const calls: [number, number][] = [];
    const encode = async (q: number, s: number) => {
      calls.push([q, s]);
      return jpegOf(Math.round(100_000 * q * s * s));
    };
    return { calls, encode };
  };

  it("starts at quality 0.8, full size; returns at once if it fits", async () => {
    const f = fake();
    const out = await fitJpeg(f.encode, 90_000);
    expect(f.calls).toEqual([[0.8, 1]]);
    expect(dataUrlBytes(out)).toBe(80_000);
  });

  it("lowers the quality first, then the size, until ≤ maxBytes", async () => {
    const f = fake();
    const out = await fitJpeg(f.encode, 40_000);
    expect(dataUrlBytes(out)).toBeLessThanOrEqual(40_000);
    expect(f.calls[0]).toEqual([0.8, 1]);
    const qs = f.calls.map((c) => c[0]);
    for (let i = 1; i < qs.length; i++) expect(qs[i]).toBeLessThanOrEqual(qs[i - 1]);
    // quality alone reaches 40 KB here (0.4 × 100 KB), so the size never shrinks
    expect(f.calls.every((c) => c[1] === 1)).toBe(true);

    const g = fake();
    const small = await fitJpeg(g.encode, 10_000);
    expect(dataUrlBytes(small)).toBeLessThanOrEqual(10_000);
    expect(g.calls.some((c) => c[1] < 1)).toBe(true);
    const firstScaled = g.calls.findIndex((c) => c[1] < 1);
    expect(g.calls.slice(0, firstScaled).every((c) => c[1] === 1)).toBe(true);
  });

  it("terminates even if nothing ever fits", async () => {
    let n = 0;
    const out = await fitJpeg(async () => (n++, jpegOf(1_000_000)), 10);
    expect(typeof out).toBe("string");
    expect(n).toBeLessThan(100);
  });
});

describe("planEviction", () => {
  it("keeps the newest `keep` ids (ids sort by date), oldest first", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}-x${i}`);
    const shuffled = [...ids].sort(() => 0.5 - Math.random());
    expect(planEviction(shuffled, 20)).toEqual(ids.slice(0, 5));
    expect(planEviction(ids.slice(0, 20), 20)).toEqual([]);
    expect(planEviction([], 20)).toEqual([]);
  });
});

describe("inline media adapter (fake canvas)", () => {
  const saved: Record<string, unknown> = {};
  const g = globalThis as unknown as Record<string, unknown>;
  beforeEach(() => {
    saved.cib = g.createImageBitmap;
    saved.getContext = HTMLCanvasElement.prototype.getContext;
    saved.toDataURL = HTMLCanvasElement.prototype.toDataURL;
    // A 4032×3024 phone photo.
    g.createImageBitmap = async () => ({ width: 4032, height: 3024, close() {} });
    HTMLCanvasElement.prototype.getContext = function () {
      return { fillRect() {}, drawImage() {}, fillStyle: "", imageSmoothingQuality: "low" };
    } as unknown as HTMLCanvasElement["getContext"];
    // JPEG size ≈ 0.25 byte per pixel at q 0.8, scaling with quality.
    HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, _t?: string, q = 0.92) {
      return jpegOf(Math.round(300 + this.width * this.height * 0.3 * q));
    };
  });
  afterEach(() => {
    g.createImageBitmap = saved.cib;
    HTMLCanvasElement.prototype.getContext = saved.getContext as HTMLCanvasElement["getContext"];
    HTMLCanvasElement.prototype.toDataURL = saved.toDataURL as HTMLCanvasElement["toDataURL"];
  });

  it("is inline without flinsh.files; 21st photo evicts the oldest; stays in budget", async () => {
    const m = createMockFlinsh();
    const store = createStoreAdapter(flinshRaw(m.bridge.store), "flinsh", { flushDelayMs: 0 });
    await store.init([]);
    const media = createMediaAdapter(m.bridge, store);
    expect(media.mode).toBe("inline");

    const ids: string[] = [];
    let lastEvicted: string[] = [];
    for (let d = 1; d <= 21; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const r = await media.savePhoto(date, new Blob(["fake"], { type: "image/jpeg" }));
      expect(r.photoId.startsWith(date)).toBe(true);
      expect(r.thumb).toMatch(/^data:image\/jpeg/);
      expect(dataUrlBytes(r.thumb)).toBeLessThan(2_500);
      ids.push(r.photoId);
      if (d <= 20) expect(r.evicted).toEqual([]);
      lastEvicted = r.evicted;
    }
    await store.flush();
    expect(lastEvicted).toEqual([ids[0]]);

    const keys = [...m.storeData.keys()].filter((k) => k.startsWith("photo/"));
    expect(keys).toHaveLength(PHOTO_KEEP);
    expect(keys).not.toContain(`photo/${ids[0]}`);
    let payload = 0;
    for (const k of keys) {
      const p = m.storeData.get(k) as StoredPhoto;
      expect(dataUrlBytes(p.dataUrl)).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
      expect(p.bytes).toBe(dataUrlBytes(p.dataUrl));
      payload += dataUrlBytes(p.dataUrl);
    }
    expect(payload).toBeLessThanOrEqual(PHOTO_KEEP * PHOTO_MAX_BYTES); // 20 × 30 KB decoded ≈ 800 KB as base64 in the store
    expect(m.backend.usedBytes()).toBeLessThan(PHOTO_KEEP * 54 * 1024);

    expect(await media.loadPhoto(ids[0])).toBeNull();
    expect(await media.loadPhoto(ids[20])).toMatch(/^data:image\/jpeg;base64,/);
    await media.deletePhoto(ids[20]);
    await store.flush();
    expect(m.storeData.has(`photo/${ids[20]}`)).toBe(false);
  });
});
