import { domToCanvas } from 'modern-screenshot';
import { LIMITS } from '../shared/types.js';
import { FIXI_ROOT_ID } from './breadcrumbs/click.js';
import { debug } from './native.js';

export interface Capture {
  blob: Blob;
  width: number;
  height: number;
}

const CAPTURE_TIMEOUT_MS = 8000;
const MASK_COLOR = '#9ca3af';

/** Excludes the Fixi UI from the capture (the modal must never appear on it). */
function keepNode(node: Node): boolean {
  return !(node instanceof Element && node.id === FIXI_ROOT_ID);
}

/** Above this many elements, the capture prunes what is off-screen (see `viewportFilter`). */
export const PRUNE_MIN_ELEMENTS = 3000;

/**
 * Filter for very large pages (a one-week planning grid is ~20 000 elements, i.e. > 8 s to clone).
 *
 * An element is NEEDED if its box crosses the viewport, or if one of its descendants does (so a fixed
 * toast inside an off-screen wrapper is kept). An off-screen element whose parent is needed is kept as an
 * empty SHELL: its computed width/height are copied, so the layout around it does not move, but its
 * children are neither cloned nor styled. Example: in a 200-row table scrolled to row 50, rows 1-49 stay
 * as empty rows of the right height, and only the ~30 visible rows are cloned in full.
 *
 * `inline` and `display: contents` elements have no size of their own: emptying them would reflow the text
 * around, so they are never shells — their children are evaluated with the same rule.
 * Measured on a 19 735-element grid: 6.9 s -> 1.1 s, pixel-identical image.
 */
export function viewportFilter(doc: Document = document): (node: Node) => boolean {
  const win = doc.defaultView ?? window;
  const vw = doc.documentElement.clientWidth || win.innerWidth;
  const vh = doc.documentElement.clientHeight || win.innerHeight;
  const needed = new Set<Element>();
  for (const el of Array.from(doc.body?.getElementsByTagName('*') ?? [])) {
    if (needed.has(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.width || r.height) && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
      for (let a: Element | null = el; a && !needed.has(a); a = a.parentElement) needed.add(a);
    }
  }

  /** Elements that cannot be emptied without moving what surrounds them: their children are evaluated instead. */
  const passThrough = (el: Element) => {
    const s = win.getComputedStyle(el);
    if (s.display === 'inline' || s.display === 'contents') return true;
    // A plain block lets the margins of its first/last child "collapse" through it (they end up outside
    // its height). Emptied, those margins vanish and everything below shifts up. Flex/grid items, table
    // parts, inline-blocks, blocks with overflow or with padding/border on both edges are safe.
    if (s.display !== 'block' && s.display !== 'list-item') return false;
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return false;
    const parent = el.parentElement ? win.getComputedStyle(el.parentElement).display : '';
    if (/flex|grid/.test(parent)) return false;
    const edge = (side: 'Top' | 'Bottom') => parseFloat(s[`padding${side}`]) + parseFloat(s[`border${side}Width`]);
    return !(edge('Top') > 0 && edge('Bottom') > 0);
  };
  /** Whether the children of `el` go into the clone (memoized: the filter is called top-down). */
  const opened = new Map<Element, boolean>();
  const opens = (el: Element | null): boolean => {
    if (!el || el === doc.documentElement || el === doc.body) return true;
    let open = opened.get(el);
    if (open === undefined) {
      open = needed.has(el) || (opens(el.parentElement) && passThrough(el));
      opened.set(el, open);
    }
    return open;
  };

  return (node: Node): boolean => {
    if (!keepNode(node)) return false;
    return !(node instanceof Element) || opens(node.parentElement);
  };
}

/** Applied to the CLONE only: hides `data-fixi-mask` blocks and password values. */
function maskClone(cloned: Node): void {
  if (!(cloned instanceof HTMLElement)) return;
  if (cloned.hasAttribute('data-fixi-mask')) {
    cloned.replaceChildren();
    cloned.style.setProperty('background', MASK_COLOR, 'important');
    cloned.style.setProperty('color', 'transparent', 'important');
    cloned.style.setProperty('border-color', MASK_COLOR, 'important');
    cloned.style.setProperty('box-shadow', 'none', 'important');
    return;
  }
  if (cloned instanceof HTMLInputElement && cloned.type === 'password') {
    cloned.value = '';
    cloned.setAttribute('value', '');
  }
}

/** Page background as the browser paints it: body, else <html>, else white. */
function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const color = el ? getComputedStyle(el).backgroundColor : '';
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return '#ffffff';
}

/**
 * CSS properties copied from each node to its clone. By default modern-screenshot copies EVERY computed
 * property (300+) of every node: on a 5 000-node planning grid that alone took 5.5 s of an 8.3 s capture.
 * Restricting the copy to what affects the rendering brings it to 1.5 s with an identical image.
 * Longhands only: `getComputedStyle().getPropertyValue()` is reliable on them, not on shorthands.
 * Missing property = visible difference in the screenshot: add it here.
 */
export const CAPTURED_STYLE_PROPERTIES = [
  // box & positioning
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow-x', 'overflow-y', 'visibility', 'opacity', 'transform', 'transform-origin',
  'clip-path', 'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
  // borders & outline
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'outline-width', 'outline-style', 'outline-color', 'outline-offset', 'box-shadow',
  // backgrounds
  'background-color', 'background-image', 'background-size', 'background-position-x', 'background-position-y',
  'background-repeat', 'background-clip', 'background-origin',
  // text
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-caps', 'font-stretch',
  'font-feature-settings', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent',
  'text-transform', 'text-overflow', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap',
  'vertical-align', 'direction', 'writing-mode', 'unicode-bidi',
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness',
  '-webkit-line-clamp', '-webkit-box-orient', '-webkit-text-fill-color', '-webkit-text-stroke-width',
  '-webkit-text-stroke-color',
  // flex & grid
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'justify-content', 'justify-items', 'justify-self', 'align-content', 'align-items', 'align-self',
  'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  // tables & lists
  'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells',
  'list-style-type', 'list-style-position', 'list-style-image',
  // form controls, images, SVG
  'appearance', 'accent-color', 'resize', 'object-fit', 'object-position',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin',
];

const baseOptions = {
  scale: 1,
  filter: keepNode,
  onCloneEachNode: maskClone,
  timeout: CAPTURE_TIMEOUT_MS,
  includeStyleProperties: CAPTURED_STYLE_PROPERTIES,
};

/**
 * Renders ONLY the visible area, so that a very long page does not produce a huge PNG.
 *
 * Measured in a real browser (Edge), the combination that works is:
 *  - capture <body>, not <html>. modern-screenshot's `restoreScrollPosition` shifts every child of a
 *    scrolled node with a CSS transform: on <html> this would apply the page scroll a second time and
 *    (a transform being a containing block) drag `position: fixed` elements away. On <body> it only
 *    restores the scroll of inner scrollable containers (a scrolled table), which is what we want;
 *  - shift the page by the scroll offset with `position: relative; top/left` (NOT a transform, for the
 *    same containing-block reason), in a canvas the size of the viewport.
 *
 * Fallback (if that render throws): render the whole page then crop the visible area.
 */
async function renderViewport(): Promise<HTMLCanvasElement> {
  const html = document.documentElement;
  const width = html.clientWidth; // excludes the scrollbar
  const height = html.clientHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const backgroundColor = pageBackground();

  const large = document.getElementsByTagName('*').length > PRUNE_MIN_ELEMENTS;

  try {
    return await domToCanvas(document.body ?? html, {
      ...baseOptions,
      filter: large ? viewportFilter() : keepNode,
      backgroundColor,
      width,
      height,
      features: { restoreScrollPosition: true },
      style: { position: 'relative', top: `${-sy}px`, left: `${-sx}px` },
    });
  } catch (err) {
    debug('viewport render failed, falling back to full page + crop', err);
    const full = await domToCanvas(html, { ...baseOptions, backgroundColor, features: { restoreScrollPosition: false } });
    const cropped = document.createElement('canvas');
    cropped.width = width;
    cropped.height = height;
    cropped.getContext('2d')?.drawImage(full, sx, sy, width, height, 0, 0, width, height);
    return cropped;
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** PNG of the canvas, shrunk step by step until it fits the 5 MB server limit (max 3 attempts). */
export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  let current = canvas;
  for (let attempt = 0; attempt < 4; attempt++) {
    const blob = await toBlob(current);
    if (!blob) return null;
    if (blob.size <= LIMITS.maxFileBytes * 0.95) return blob;
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(current.width * 0.75);
    smaller.height = Math.round(current.height * 0.75);
    smaller.getContext('2d')?.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  return null;
}

/** Captures the visible area. Resolves to null (never throws) if it fails or takes more than 8 s. */
export async function captureViewport(): Promise<Capture | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const canvas = await Promise.race([
      renderViewport(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('capture timeout')), CAPTURE_TIMEOUT_MS);
      }),
    ]);
    const blob = await canvasToPngBlob(canvas);
    return blob ? { blob, width: canvas.width, height: canvas.height } : null;
  } catch (err) {
    debug('capture failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
