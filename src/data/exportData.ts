/** JSON export of every key in the store (Me → Export my data). */
import { getState, now, services } from "./state";

export async function buildExport(): Promise<string> {
  const { store } = services();
  await store.flush();
  const keys = await store.list("");
  const data = await store.loadMany<unknown>(keys);
  const p = getState().profile;
  return JSON.stringify({ app: "split", version: 1, exportedAt: now().toISOString(), name: p?.name ?? null, data }, null, 2);
}
