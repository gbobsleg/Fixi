type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  on?: Record<string, EventListener>;
  attrs?: Record<string, string>;
};

/** Tiny hyperscript helper: h('button', { class: 'x', on: { click } }, 'Label'). Text is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: className, on, attrs, ...rest } = props;
  if (className) el.className = className;
  for (const [key, value] of Object.entries(rest)) {
    // DOM properties (type, checked, value, disabled, hidden...)
    (el as unknown as Record<string, unknown>)[key] = value;
  }
  for (const [key, value] of Object.entries(attrs ?? {})) el.setAttribute(key, value);
  for (const [type, listener] of Object.entries(on ?? {})) el.addEventListener(type, listener);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an inline SVG icon from a list of path definitions (24x24 viewBox, stroke icons). */
export function icon(paths: string[], size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Exclamation mark in a circle: understandable by non-technical users (no bug icon). */
export const ICON_ALERT = ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v5', 'M12 16.5h.01'];
export const ICON_CLOSE = ['M18 6 6 18', 'M6 6l12 12'];
export const ICON_PAPERCLIP = [
  'm21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
];
