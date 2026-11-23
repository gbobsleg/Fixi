// Captured at load time, BEFORE network.ts wraps window.fetch: Fixi's own request to the server must
// never appear in the host app's breadcrumbs, and must not be affected by the host's fetch wrappers
// installed later.
export const nativeFetch: typeof fetch | undefined =
  typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;

/** Max time for one resource downloaded by the capture (a font, an image). */
export const RESOURCE_TIMEOUT_MS = 3000;

/**
 * Download made by Fixi itself (fonts, images of the screenshot): through `nativeFetch`, so it never
 * shows up in the host's timeline, and cut after RESOURCE_TIMEOUT_MS so that one slow server cannot eat
 * the whole capture budget. Resolves to null on any failure (never throws).
 */
export async function quietFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  if (!nativeFetch) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESOURCE_TIMEOUT_MS);
  try {
    const res = await nativeFetch(url, { ...init, signal: ctrl.signal });
    return res.ok ? res : null;
  } catch (err) {
    debug('resource fetch failed', url, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Internal diagnostics only: the widget must never use console.error (it would be recorded). */
export function debug(...args: unknown[]): void {
  try {
    console.debug('[fixi]', ...args);
  } catch {
    /* nothing to do */
  }
}

/** Wraps a callback so that an exception inside Fixi can never reach the host application. */
export function guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      debug(err);
    }
  };
}
