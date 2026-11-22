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

const baseOptions = {
  scale: 1,
  filter: keepNode,
  onCloneEachNode: maskClone,
  timeout: CAPTURE_TIMEOUT_MS,
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

  try {
    return await domToCanvas(document.body ?? html, {
      ...baseOptions,
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
