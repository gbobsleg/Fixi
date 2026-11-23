// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, themeVars } from '../../src/widget/theme.js';

describe('themeVars', () => {
  it('derives hover, soft background and focus ring from one color', () => {
    expect(themeVars('#318f9b')).toEqual({
      '--fx-accent': '#318f9b',
      '--fx-accent-hover': '#27727c',
      '--fx-accent-soft': '#eaf4f5',
      '--fx-accent-ring': 'rgba(49, 143, 155, 0.35)',
      '--fx-on-accent': '#ffffff',
      '--fx-accent-text': '#27727c',
    });
  });

  it('puts dark text on a light color so the buttons stay readable', () => {
    expect(themeVars('#ffd400')['--fx-on-accent']).toBe('#1f2a30');
    expect(themeVars('#1f2a30')['--fx-on-accent']).toBe('#ffffff');
  });

  it('darkens the colored text until it is readable on white (4.5:1)', () => {
    const text = themeVars('#ffd400')['--fx-accent-text'];
    expect(text).not.toBe('#ccaa00'); // the plain 20 % darker yellow is not enough
    const lum = (h: string) =>
      [1, 3, 5]
        .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
        .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
    expect(1.05 / (lum(text) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to the default teal on an invalid value', () => {
    for (const bad of [null, undefined, '', 'red', '#fff', 'url(javascript:x)']) {
      expect(themeVars(bad)['--fx-accent']).toBe('#318f9b');
    }
    expect(themeVars('#ABCDEF')['--fx-accent']).toBe('#abcdef');
  });
});

describe('applyTheme', () => {
  it('sets the variables on the host element through the CSSOM', () => {
    const host = document.createElement('div');
    applyTheme(host, '#7c3aed');
    expect(host.style.getPropertyValue('--fx-accent')).toBe('#7c3aed');
    expect(host.getAttribute('style')).toContain('--fx-on-accent');
  });
});
