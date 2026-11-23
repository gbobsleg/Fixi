// Web fonts for the screenshot.
//
// modern-screenshot embeds the fonts it finds itself, but it misses two common cases:
//  - a stylesheet from another origin (bootstrap-icons from cdn.jsdelivr.net): the browser forbids
//    reading its rules, so its @font-face are ignored;
//  - a font used only by ::before / ::after (every icon font): the library detects the families used by
//    the ELEMENTS, not by their pseudo-elements, so `font-family: bootstrap-icons` on `.bi::before` is never
//    seen.
// Result: every icon became an empty square. Here we build the @font-face CSS ourselves, with the font
// files inlined as data: URLs (an SVG rendered as an image cannot load anything from the network), and
// hand it to the library through `font.cssText`.
//
// Which fonts? Exactly those the browser has LOADED (`document.fonts`): a browser only downloads a web font
// when some text on the page uses it, so this is the list of fonts the page really needs.

import { debug, nativeFetch } from './native.js';

const FETCH_TIMEOUT_MS = 3000;

export interface FontFaceDescriptor {
  family: string;
  src: string;
  weight: string;
  style: string;
  stretch: string;
  unicodeRange: string;
  /** URL the relative URLs of `src` are resolved against (the stylesheet's own URL). */
  base: string;
}

/** Key shared by a CSS @font-face rule and the FontFace the browser created from it. */
export function faceKey(f: { family: string; weight: string; style: string; unicodeRange: string }): string {
  const family = f.family.replace(/["']/g, '').trim().toLowerCase();
  const weight = ({ normal: '400', bold: '700' } as Record<string, string>)[f.weight.trim()] ?? f.weight.trim();
  const style = f.style.trim() || 'normal';
  const range = (f.unicodeRange || 'U+0-10FFFF').replace(/\s+/g, '').toLowerCase();
  return `${family}|${weight || '400'}|${style}|${range}`;
}

/**
 * Picks the best source of a `src` descriptor: woff2, then woff, then the first url(). `local()` is
 * skipped (a font installed on the user's machine cannot be read). Returns an absolute URL and its format.
 * Example: `url("fonts/bi.woff2?x") format("woff2"), url("fonts/bi.woff") format("woff")`
 *          → { url: 'https://cdn…/font/fonts/bi.woff2?x', format: 'woff2' }
 */
export function pickFontSource(src: string, base: string): { url: string; format: string } | null {
  const sources: { url: string; format: string }[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    try {
      sources.push({ url: new URL(m[2], base).href, format: (m[3] ?? '').toLowerCase() });
    } catch {
      /* invalid URL: ignore this source */
    }
  }
  return (
    sources.find((s) => s.format === 'woff2') ?? sources.find((s) => s.format === 'woff') ?? sources[0] ?? null
  );
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  // The page's fetch is wrapped by the breadcrumbs: Fixi's own downloads must not show up in the timeline.
  if (!nativeFetch) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await nativeFetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
    return res.ok ? res : null;
  } catch (err) {
    debug('font fetch failed', url, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Kept for the whole page life: the second capture does not download anything again.
const fontCache = new Map<string, Promise<string | null>>();
const sheetCache = new Map<string, Promise<CSSRuleList | null>>();

function fontAsDataUrl(url: string): Promise<string | null> {
  let p = fontCache.get(url);
  if (!p) {
    p = (async () => {
      if (url.startsWith('data:')) return url;
      const res = await fetchWithTimeout(url);
      return res ? blobToDataUrl(await res.blob()) : null;
    })().catch(() => null);
    fontCache.set(url, p);
  }
  return p;
}

/** Rules of a stylesheet the page cannot read (other origin): downloaded again, with CORS, and parsed. */
function fetchSheetRules(href: string): Promise<CSSRuleList | null> {
  let p = sheetCache.get(href);
  if (!p) {
    p = (async () => {
      if (typeof CSSStyleSheet === 'undefined' || !('replaceSync' in CSSStyleSheet.prototype)) return null;
      const res = await fetchWithTimeout(href);
      if (!res) return null;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await res.text()); // @import rules are ignored, which is fine for @font-face
      return sheet.cssRules;
    })().catch(() => null);
    sheetCache.set(href, p);
  }
  return p;
}

function readRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null; // other origin without CORS headers
  }
}

/** Every @font-face of the page, including nested ones (@import, @media, @supports, @layer). */
async function collectFontFaces(doc: Document): Promise<FontFaceDescriptor[]> {
  const faces: FontFaceDescriptor[] = [];
  const walk = async (rules: CSSRuleList | null, base: string): Promise<void> => {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        const s = rule.style;
        faces.push({
          family: s.getPropertyValue('font-family'),
          src: s.getPropertyValue('src'),
          weight: s.getPropertyValue('font-weight') || 'normal',
          style: s.getPropertyValue('font-style') || 'normal',
          stretch: s.getPropertyValue('font-stretch'),
          unicodeRange: s.getPropertyValue('unicode-range'),
          base,
        });
      } else if (rule instanceof CSSImportRule && rule.styleSheet) {
        const href = rule.styleSheet.href ?? base;
        await walk(readRules(rule.styleSheet) ?? (await fetchSheetRules(href)), href);
      } else if ('cssRules' in rule) {
        await walk((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    const base = sheet.href ?? doc.baseURI;
    const rules = readRules(sheet) ?? (sheet.href ? await fetchSheetRules(sheet.href) : null);
    await walk(rules, base);
  }
  return faces;
}

/**
 * @font-face CSS of every web font loaded by the page, files inlined. Empty string when the page uses no
 * web font, or when nothing could be read (the library then falls back to its own detection).
 * Never throws; a font that cannot be downloaded is simply left out (its glyphs fall back to a system font).
 */
export async function embeddedFontCss(doc: Document = document): Promise<string> {
  try {
    const loaded = new Set<string>();
    doc.fonts?.forEach((face) => {
      if (face.status === 'loaded') loaded.add(faceKey(face));
    });
    if (!loaded.size) return '';

    const all = await collectFontFaces(doc);
    const faces = all.filter((f) => loaded.has(faceKey(f)));
    // A loaded face whose descriptors are written differently in the CSS (no exact key match): keep every
    // rule of its family rather than lose it.
    const matched = new Set(faces.map(faceKey));
    const unmatchedFamilies = new Set([...loaded].filter((k) => !matched.has(k)).map((k) => k.split('|')[0]));
    for (const f of all) {
      if (!matched.has(faceKey(f)) && unmatchedFamilies.has(faceKey(f).split('|')[0])) faces.push(f);
    }
    const blocks = await Promise.all(
      faces.map(async (f) => {
        const source = pickFontSource(f.src, f.base);
        const data = source && (await fontAsDataUrl(source.url));
        if (!source || !data) return '';
        const format = source.format ? ` format("${source.format}")` : '';
        return [
          `@font-face {`,
          `font-family: ${f.family};`,
          `src: url("${data}")${format};`,
          `font-weight: ${f.weight};`,
          `font-style: ${f.style};`,
          f.stretch ? `font-stretch: ${f.stretch};` : '',
          f.unicodeRange ? `unicode-range: ${f.unicodeRange};` : '',
          `}`,
        ].join(' ');
      }),
    );
    return blocks.filter(Boolean).join('\n');
  } catch (err) {
    debug('font embedding failed', err);
    return '';
  }
}
