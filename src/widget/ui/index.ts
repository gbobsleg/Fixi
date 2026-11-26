import type { TimelineStore } from '../breadcrumbs/store.js';
import { FIXI_ROOT_ID } from '../breadcrumbs/click.js';
import { captureViewport } from '../capture.js';
import type { WidgetConfig } from '../config.js';
import { debug } from '../native.js';
import { loadTheme } from '../theme.js';
import { h, icon, ICON_ALERT } from './dom.js';
import { openModal } from './modal.js';
import { STYLES } from './styles.js';

export interface FixiUI {
  mount(): void;
  open(): Promise<void>;
}

/** Events that must not leak out of the widget to the host app (shortcuts, focus traps...). */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'keypress', 'focusin'];

/**
 * Applies the widget styles. A constructed stylesheet is built in JS, so a strict host CSP
 * (`style-src 'self'`) does not block it; a <style> tag would be. Old browsers fall back to <style>.
 */
function applyStyles(root: ShadowRoot): void {
  if ('adoptedStyleSheets' in ShadowRoot.prototype && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    root.adoptedStyleSheets = [sheet];
  } else {
    root.append(h('style', { textContent: STYLES }));
  }
}

export function createUI(getConfig: () => WidgetConfig, store: TimelineStore): FixiUI {
  let root: ShadowRoot | null = null;
  let tab: HTMLButtonElement | null = null;
  let busy = false;

  /** Creates the Shadow DOM host. Everything the widget displays lives inside it. */
  function mount(): void {
    if (root || document.getElementById(FIXI_ROOT_ID)) return;
    const host = h('div', { id: FIXI_ROOT_ID });
    root = host.attachShadow({ mode: 'open' });
    applyStyles(root);

    tab = h(
      'button',
      {
        class: 'tab',
        type: 'button',
        attrs: { 'aria-label': 'Signaler un problème' },
        on: { click: () => void open() },
      },
      icon(ICON_ALERT, 18),
      h('span', {}, 'Signaler un problème'),
    );
    root.append(tab);

    // A host-side focus trap (e.g. a Bootstrap modal) would steal the focus from our textarea.
    for (const type of ISOLATED_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());

    // On <html>, not <body>: apps that swap the whole body (Turbo, htmx boost) must not remove it.
    document.documentElement.append(host);

    // Color configured for this app in Fixi (remembered color applied at once, then refreshed).
    const { apiBase, app } = getConfig();
    void loadTheme(host, apiBase, app);
  }

  async function open(): Promise<void> {
    mount();
    if (busy || !root || !tab) return;
    busy = true;
    tab.hidden = true;

    // Click 1: the capture is taken BEFORE the modal exists, so the modal can never appear on it.
    const loading = h(
      'div',
      { class: 'loading', attrs: { role: 'status' } },
      h('span', { class: 'spinner' }),
      'Préparation du signalement…',
    );
    root.append(loading);
    let capture = null;
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); // let the spinner paint
      capture = await captureViewport();
    } catch (err) {
      debug(err);
    } finally {
      loading.remove();
    }

    openModal({
      container: root,
      capture,
      getConfig,
      store,
      onClose: () => {
        busy = false;
        if (tab) tab.hidden = false;
      },
    });
  }

  return { mount, open };
}
