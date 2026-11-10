/**
 * Photos (PLAN "Photos").
 *
 * - `files` mode, when window.flinsh.files exists (files:user): resize to a
 *   1600 px max edge, JPEG 0.85, files.put("split/photo/<id>.jpg").
 * - `inline` mode (standalone fallback): resize to a 640 px max edge and re-encode through
 *   a canvas (which strips EXIF), lowering JPEG quality and then size until
 *   the JPEG is ≤ 30 KB (~40 KB base64); stored as StoredPhoto under photo/<id>; only the
 *   20 newest are kept. Every session also keeps a 48 px thumb in its log.
 *
 * Works in an opaque-origin sandbox: no localStorage, every browser API is
 * guarded. fitJpeg, dataUrlBytes and planEviction are pure (tested with a
 * fake encoder; jsdom has no canvas).
 */
import type { FlinshBridge, ISODate, MediaAdapter, SavedPhoto, StoreAdapter, StoredPhoto } from "../types";
import { photoKey } from "../data/keys";
import { uid } from "../lib/ids";

export const PHOTO_MAX_EDGE = 640;
/**
 * Decoded JPEG bytes per photo. The store keeps it as a base64 data URL
 * (×4/3), so 30 KB → ~40 KB stored, and 20 photos ≈ 800 KB of the 2 MB quota.
 */
export const PHOTO_MAX_BYTES = 30_000;
export const PHOTO_KEEP = 20;
export const THUMB_EDGE = 48;
export const FILES_MAX_EDGE = 1600;

const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];
const SCALE_STEP = 0.85;
const MAX_SCALE_STEPS = 25; // 0.85^25 ≈ 0.017: far past any useful size

// ── pure helpers ───────────────────────────────────────────────────────────

/** Decoded payload bytes of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = (comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl).replace(/\s/g, "");
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/**
 * Encode until it fits: quality 0.8 → 0.4 at full scale, then shrink the
 * size by 0.85 per step at the lowest quality. Returns the first data URL ≤
 * maxBytes, or the last (smallest) attempt if nothing fits.
 */
export async function fitJpeg(encode: (quality: number, scale: number) => Promise<string>, maxBytes: number): Promise<string> {
  let last = "";
  for (const q of QUALITIES) {
    last = await encode(q, 1);
    if (dataUrlBytes(last) <= maxBytes) return last;
  }
  const q = QUALITIES[QUALITIES.length - 1];
  let scale = 1;
  for (let i = 0; i < MAX_SCALE_STEPS; i++) {
    scale *= SCALE_STEP;
    last = await encode(q, scale);
    if (dataUrlBytes(last) <= maxBytes) return last;
  }
  return last;
}

/** Ids to delete so only the `keep` newest remain. Ids sort by date; oldest first. */
export function planEviction(ids: string[], keep: number): string[] {
  const sorted = [...new Set(ids)].sort();
  return sorted.slice(0, Math.max(0, sorted.length - Math.max(0, keep)));
}

// ── canvas plumbing (browser only) ─────────────────────────────────────────

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the EXIF orientation before the EXIF is dropped.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch {
      /* fall through to <img> */
    }
  }
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("This browser can't read that photo.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't a photo we can read."));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    // The image is decoded once loaded; revoking now is safe.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 0);
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("No canvas available.");
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draw `img` so its longer edge is maxEdge × scale (never upscaled). */
function draw(img: Decoded, maxEdge: number, scale: number): HTMLCanvasElement {
  const fit = Math.min(1, maxEdge / Math.max(img.width, img.height, 1)) * scale;
  const c = makeCanvas(img.width * fit, img.height * fit);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No canvas available.");
  ctx.fillStyle = "#fff"; // JPEG has no alpha
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img.source, 0, 0, c.width, c.height);
  return c;
}

function jpegDataUrl(c: HTMLCanvasElement, quality: number): string {
  const url = c.toDataURL("image/jpeg", quality);
  if (!url.startsWith("data:image/jpeg")) throw new Error("This browser can't encode JPEG.");
  return url;
}

function jpegBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the photo."))), "image/jpeg", quality);
    } catch (e) {
      reject(e);
    }
  });
}

async function thumbOf(img: Decoded): Promise<string> {
  return fitJpeg(async (q, s) => jpegDataUrl(draw(img, THUMB_EDGE, s), q), 2_000);
}

/** id = `${date}-${rand}`, so ids sort by date. */
function newPhotoId(date: ISODate): string {
  return `${date}-${uid()}`;
}

// ── adapter ────────────────────────────────────────────────────────────────

export function createMediaAdapter(bridge: FlinshBridge | null, store: StoreAdapter): MediaAdapter {
  const files = bridge?.files;
  if (files && typeof files.put === "function" && typeof files.get === "function") {
    return {
      mode: "files",
      async savePhoto(date, file) {
        const img = await decode(file);
        try {
          const blob = await jpegBlob(draw(img, FILES_MAX_EDGE, 1), 0.85);
          // flinsh.files.put(blob, {name, mime}) → {id, size, name, mime}. Names may hold "/".
          const r = await files.put(blob, { name: `split/photo/${newPhotoId(date)}.jpg`, mime: "image/jpeg" });
          const photoId = r && typeof r.id === "string" ? r.id : null;
          if (!photoId) throw new Error("Couldn't save the photo.");
          return { photoId, thumb: await thumbOf(img), evicted: [] };
        } finally {
          img.close();
        }
      },
      async loadPhoto(photoId) {
        // A signed URL valid ~10 minutes: fetch a fresh one every time, never store it.
        try {
          return (await files.get(photoId)) ?? null;
        } catch {
          return null;
        }
      },
      async deletePhoto(photoId) {
        try {
          await files.delete(photoId);
        } catch {
          /* already gone */
        }
      },
    };
  }

  return {
    mode: "inline",
    async savePhoto(date, file): Promise<SavedPhoto> {
      const img = await decode(file);
      let dataUrl: string;
      let thumb: string;
      try {
        dataUrl = await fitJpeg(async (q, s) => jpegDataUrl(draw(img, PHOTO_MAX_EDGE, s), q), PHOTO_MAX_BYTES);
        thumb = await thumbOf(img);
      } finally {
        img.close();
      }
      const bytes = dataUrlBytes(dataUrl);
      if (bytes > PHOTO_MAX_BYTES) throw new Error("That photo is too large to keep.");
      const id = newPhotoId(date);
      const photo: StoredPhoto = { id, date, dataUrl, bytes };
      store.set(photoKey(id), photo);
      // Keep the 20 newest full photos; the logs keep their thumbs.
      const ids = (await store.list("photo/")).map((k) => k.slice("photo/".length));
      if (!ids.includes(id)) ids.push(id);
      const evicted = planEviction(ids, PHOTO_KEEP).filter((x) => x !== id);
      await Promise.all(evicted.map((x) => store.delete(photoKey(x))));
      return { photoId: id, thumb, evicted };
    },
    async loadPhoto(photoId) {
      try {
        const p = await store.load<StoredPhoto>(photoKey(photoId));
        return p && typeof p.dataUrl === "string" ? p.dataUrl : null;
      } catch {
        return null;
      }
    },
    async deletePhoto(photoId) {
      await store.delete(photoKey(photoId));
    },
  };
}
