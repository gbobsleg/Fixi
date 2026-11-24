import { guard } from '../native.js';
import { clip } from '../sanitize.js';
import { buildSelector } from '../selector.js';
import type { TimelineStore } from './store.js';

const INTERACTIVE =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]';
const FORM_FIELDS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const MASK = '[data-fixi-mask]';

export const FIXI_ROOT_ID = 'fixi-root';

/** The visible label of the control. Never the *value* typed by a user, never a select's options. */
function visibleText(el: Element): string | undefined {
  let raw = '';
  if (el instanceof HTMLInputElement) {
    // The `value` of a button-like input IS its label; for any other input it is user data.
    if (BUTTON_INPUT_TYPES.has(el.type)) raw = el.value;
  } else if (!FORM_FIELDS.has(el.tagName)) {
    // innerText follows what is really displayed; textContent is the fallback (e.g. SVG, jsdom).
    raw = (el instanceof HTMLElement ? el.innerText : undefined) ?? el.textContent ?? '';
  }
  raw = raw || el.getAttribute('aria-label') || el.getAttribute('title') || '';
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? clip(text, 50) : undefined;
}

/**
 * Records clicks as `{ selector, text }`. Clicks inside the Fixi UI are ignored. Inside a
 * `data-fixi-mask` zone only the selector is kept.
 */
export function installClicks(store: TimelineStore): void {
  document.addEventListener(
    'click',
    guard((event: MouseEvent) => {
      if (event.composedPath().some((n) => n instanceof Element && n.id === FIXI_ROOT_ID)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const interactive = target.closest(INTERACTIVE);
      const el = interactive ?? target;
      // A masked zone hides its text in the timeline too: the click is inside one, or the control
      // contains one (e.g. a button whose label is a masked name).
      const masked =
        target.closest(MASK) !== null ||
        (interactive !== null && (interactive.closest(MASK) !== null || interactive.querySelector(MASK) !== null));
      store.push({
        t: Date.now(),
        type: 'click',
        selector: clip(buildSelector(el), 200),
        // Text is only read on interactive controls: reading a big container would be slow and noisy.
        text: interactive && !masked ? visibleText(interactive) : undefined,
      });
    }),
    true,
  );
}
