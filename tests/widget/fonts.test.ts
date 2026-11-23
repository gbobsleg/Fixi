// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { faceKey, pickFontSource } from '../../src/widget/fonts.js';

const CDN = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css';

describe('pickFontSource', () => {
  it('prefers woff2 and resolves the URL against the stylesheet, not the page', () => {
    const src = 'url("fonts/bootstrap-icons.woff2?dd67") format("woff2"), url("fonts/bootstrap-icons.woff?dd67") format("woff")';
    expect(pickFontSource(src, CDN)).toEqual({
      url: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2?dd67',
      format: 'woff2',
    });
  });

  it('falls back to woff, then to the first url(), and skips local()', () => {
    expect(pickFontSource('local("Raleway"), url(a.ttf) format("truetype"), url(b.woff) format("woff")', CDN)?.url).toMatch(
      /\/b\.woff$/,
    );
    expect(pickFontSource("local(Arial), url('../font/x.ttf')", 'http://localhost/shifti/css/fonts.css')).toEqual({
      url: 'http://localhost/shifti/font/x.ttf',
      format: '',
    });
    expect(pickFontSource('local(Arial)', CDN)).toBeNull();
  });
});

describe('faceKey', () => {
  it('matches a CSS rule with the FontFace the browser built from it', () => {
    const rule = { family: "'Raleway'", weight: 'normal', style: 'normal', unicodeRange: 'U+0000-00FF, U+0131' };
    const face = { family: 'Raleway', weight: '400', style: 'normal', unicodeRange: 'U+0-FF, U+131' };
    // the browser may rewrite the range (U+0000 → U+0): only family/weight/style must then match exactly
    expect(faceKey(rule).split('|').slice(0, 3)).toEqual(faceKey(face).split('|').slice(0, 3));
    expect(faceKey({ family: '"bootstrap-icons"', weight: '', style: '', unicodeRange: '' })).toBe(
      faceKey({ family: 'bootstrap-icons', weight: 'normal', style: 'normal', unicodeRange: 'U+0-10FFFF' }),
    );
  });

  it('distinguishes weights and subsets', () => {
    const base = { family: 'Raleway', style: 'normal', unicodeRange: 'U+0-FF' };
    expect(faceKey({ ...base, weight: '400' })).not.toBe(faceKey({ ...base, weight: 'bold' }));
    expect(faceKey({ ...base, weight: '400' })).not.toBe(faceKey({ ...base, weight: '400', unicodeRange: 'U+400-45F' }));
  });
});
