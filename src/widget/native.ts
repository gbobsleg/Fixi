// Captured at load time, BEFORE network.ts wraps window.fetch: Fixi's own request to the server must
// never appear in the host app's breadcrumbs, and must not be affected by the host's fetch wrappers
// installed later.
export const nativeFetch: typeof fetch | undefined =
  typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined;

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
