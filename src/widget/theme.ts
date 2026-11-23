// Widget color, set per application in Fixi's settings (default: the teal of Shifti and Flowi).
// One color is enough: the hover, soft background, focus ring and text-on-color are derived from it.

import { DEFAULT_WIDGET_COLOR, WIDGET_COLOR_RE } from '../shared/types.js';
import { debug, quietFetch } from './native.js';

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, weightOfB: number): Rgb =>
  a.map((c, i) => c + (b[i] - c) * weightOfB) as Rgb;

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const DARK_TEXT = '#1f2a30';

/** The color darkened until it reaches 4.5:1 on white (WCAG, normal text): for colored text. */
function readableOnWhite(rgb: Rgb): string {
  for (let w = 0.2; w < 1; w += 0.1) {
    const c = mix(rgb, [0, 0, 0], w);
    if (contrast(luminance(c), 1) >= 4.5) return toHex(c);
  }
  return DARK_TEXT;
}

/**
 * CSS variables of the widget for one color. Example with the default teal:
 *   --fx-accent #318f9b, --fx-accent-hover #27727c (20 % black), --fx-accent-soft #eaf4f5 (90 % white),
 *   --fx-accent-ring rgba(49, 143, 155, 0.35), --fx-on-accent #ffffff, --fx-accent-text #27727c.
 * `--fx-on-accent` (text on the color) is white as long as it reaches 3:1, the WCAG minimum for bold
 * text (white on the teal, like Shifti and Flowi), dark otherwise: a yellow chosen in the settings keeps
 * readable buttons. An invalid value falls back to the default color.
 */
export function themeVars(color: string | null | undefined): Record<string, string> {
  const hex = color && WIDGET_COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_WIDGET_COLOR;
  const rgb = parseHex(hex);
  const lum = luminance(rgb);
  return {
    '--fx-accent': hex,
    '--fx-accent-hover': toHex(mix(rgb, [0, 0, 0], 0.2)),
    '--fx-accent-soft': toHex(mix(rgb, [255, 255, 255], 0.9)),
    '--fx-accent-ring': `rgba(${rgb.join(', ')}, 0.35)`,
    '--fx-on-accent': contrast(lum, 1) >= 3 ? '#ffffff' : DARK_TEXT,
    // Colored text on white / on the soft background (selected pill): the hover color, darker if needed.
    '--fx-accent-text': readableOnWhite(rgb),
  };
}

/** Applied through the CSSOM: a host page CSP without 'unsafe-inline' does not block it. */
export function applyTheme(host: HTMLElement, color: string | null | undefined): void {
  for (const [name, value] of Object.entries(themeVars(color))) host.style.setProperty(name, value);
}

const storageKey = (app: string) => `fixi:color:${app}`;

function remembered(app: string): string | null {
  try {
    return localStorage.getItem(storageKey(app));
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

function remember(app: string, color: string): void {
  try {
    localStorage.setItem(storageKey(app), color);
  } catch {
    /* nothing to do */
  }
}

/**
 * Colors the widget: at once with the color remembered from the previous page (no flash on every page
 * change), then with the one configured in Fixi. Never throws; on failure the current color stays.
 * The request goes through quietFetch: it never appears in the report's timeline.
 */
export async function loadTheme(host: HTMLElement, apiBase: string, app: string): Promise<void> {
  try {
    const known = remembered(app);
    if (known) applyTheme(host, known);
    const res = await quietFetch(`${apiBase}/api/widget/config?app=${encodeURIComponent(app)}`);
    const body = res ? ((await res.json()) as { color?: unknown }) : null;
    const color = typeof body?.color === 'string' && WIDGET_COLOR_RE.test(body.color) ? body.color : null;
    if (!color) return;
    applyTheme(host, color);
    remember(app, color);
  } catch (err) {
    debug('theme failed', err);
  }
}
