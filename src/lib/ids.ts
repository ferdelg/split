/** Short random ids (not security-sensitive). Only store-key-safe characters. */
export function uid(prefix?: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const len = 10;
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return prefix ? `${prefix}_${out}` : out;
}
