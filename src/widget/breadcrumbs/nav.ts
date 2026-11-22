import type { NavKind } from '../../shared/types.js';
import { guard } from '../native.js';
import { sanitizeUrl } from '../sanitize.js';
import type { TimelineStore } from './store.js';

/** Records page loads and URL changes (pushState, replaceState, back/forward, hash). */
export function installNav(store: TimelineStore): void {
  let lastUrl = '';
  let lastAt = 0;

  const record = (kind: NavKind) => {
    const url = sanitizeUrl(location.href);
    const now = Date.now();
    // `popstate` and `hashchange` often fire together for the same navigation.
    if (url === lastUrl && now - lastAt < 100) return;
    lastUrl = url;
    lastAt = now;
    store.push({ t: now, type: 'nav', url, kind });
  };

  record('load');

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    if (typeof original !== 'function') continue;
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      guard(() => record(method === 'pushState' ? 'push' : 'replace'))();
      return result;
    };
  }

  window.addEventListener('popstate', guard(() => record('pop')));
  window.addEventListener('hashchange', guard(() => record('hash')));
}
