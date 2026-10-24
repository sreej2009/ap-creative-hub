/** localStorage helpers that never throw (private mode, blocked storage, SSR). */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep working in memory */
  }
}

const TOKENS_KEY = 'ap_order_tokens';

/** Guest tracking tokens, remembered so a guest can reopen their order on this device. */
export function rememberOrderToken(orderNumber: string, token: string) {
  const all = readJSON<Record<string, string>>(TOKENS_KEY, {});
  all[orderNumber] = token;
  const entries = Object.entries(all).slice(-20);
  writeJSON(TOKENS_KEY, Object.fromEntries(entries));
}

export function orderToken(orderNumber: string): string | undefined {
  return readJSON<Record<string, string>>(TOKENS_KEY, {})[orderNumber];
}
