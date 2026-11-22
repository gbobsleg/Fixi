// Fixi widget entry point. Bundled by esbuild into a single self-contained widget.js.
// Rule #1: nothing in here may ever throw into the host application.

import { installClicks } from './breadcrumbs/click.js';
import { installErrors } from './breadcrumbs/errors.js';
import { installNav } from './breadcrumbs/nav.js';
import { installNetwork } from './breadcrumbs/network.js';
import { createStore } from './breadcrumbs/store.js';
import { createConfigReader } from './config.js';
import { debug } from './native.js';
import { createUI } from './ui/index.js';

declare global {
  interface Window {
    Fixi?: { open: () => Promise<void> };
    __fixiLoaded?: boolean;
  }
}

function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    debug(`${label} failed`, err);
  }
}

function main(): void {
  if (window.__fixiLoaded) return; // script included twice

  const readConfig = createConfigReader();
  if (!readConfig) return debug('script tag with data-app / data-api-key not found');
  const config = readConfig();
  if (!config.app || !config.apiKey) return debug('data-app and data-api-key are required');
  window.__fixiLoaded = true;

  const store = createStore(config.app);
  // Each collector is isolated: if one cannot be installed, the others still work.
  safely('navigation', () => installNav(store));
  safely('clicks', () => installClicks(store));
  safely('network', () => installNetwork(store, config.apiBase));
  safely('errors', () => installErrors(store));

  const ui = createUI(readConfig, store);
  window.Fixi = { open: () => ui.open() };

  const mount = () => safely('ui', () => ui.mount());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}

try {
  main();
} catch (err) {
  debug('init failed', err);
}
