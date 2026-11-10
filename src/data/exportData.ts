/** JSON export of every key in the store (Me → Export my data). */
import { unpackMonthLog } from "./logCodec";
import { getState, now, services } from "./state";

export async function buildExport(): Promise<string> {
  const { store } = services();
  await store.flush();
  const keys = await store.list("");
  const data = await store.loadMany<unknown>(keys);
  // Logs are packed on disk (logCodec.ts); export them in the readable Session shape.
  for (const k of keys) if (k.startsWith("logs/")) data[k] = unpackMonthLog(data[k]);
  const p = getState().profile;
  return JSON.stringify({ app: "split", version: 1, exportedAt: now().toISOString(), name: p?.name ?? null, data }, null, 2);
}
