// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXI_ROOT_ID } from '../../src/widget/breadcrumbs/click.js';
import { viewportFilter } from '../../src/widget/capture.js';

// jsdom has no layout: every box is given here by id (viewport = jsdom's 1024x768 window).
const VISIBLE = { top: 10, bottom: 50, left: 0, right: 100, width: 100, height: 40 };
const ABOVE = { top: -500, bottom: -460, left: 0, right: 100, width: 100, height: 40 };
let boxes: Record<string, typeof VISIBLE> = {};

beforeEach(() => {
  boxes = {};
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = boxes[this.id] ?? ABOVE; // anything not listed is off-screen
    return { ...box, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
  };
});

function setup(markup: string, layout: Record<string, typeof VISIBLE>) {
  document.body.innerHTML = markup;
  boxes = layout;
  return viewportFilter(document);
}
const $ = (id: string) => document.getElementById(id)!;

describe('viewportFilter', () => {
  it('keeps visible elements with their content', () => {
    const keep = setup('<div id="v" style="padding:4px"><span id="t">texte</span></div>', { v: VISIBLE, t: VISIBLE });
    expect(keep($('v'))).toBe(true);
    expect(keep($('t'))).toBe(true);
    expect(keep($('t').firstChild!)).toBe(true);
  });

  it('keeps an off-screen row as an empty shell: the row stays, its cells are not cloned', () => {
    const keep = setup(
      '<table id="tb"><tbody id="body"><tr id="off"><td id="cell">8h</td></tr><tr id="on"><td id="vcell">9h</td></tr></tbody></table>',
      { tb: VISIBLE, body: VISIBLE, on: VISIBLE, vcell: VISIBLE },
    );
    expect(keep($('off'))).toBe(true); // shell: keeps its size, so the visible rows do not move
    expect(keep($('cell'))).toBe(false);
    expect(keep($('vcell'))).toBe(true);
  });

  it('keeps a visible element whose ancestors are off-screen (fixed toast, absolute menu)', () => {
    const keep = setup(
      '<div id="wrap" style="padding:2px"><div id="mid" style="padding:2px"><div id="toast">Toast</div></div><div id="other" style="padding:2px"><b id="deep">x</b></div></div>',
      { toast: VISIBLE },
    );
    expect(keep($('wrap'))).toBe(true);
    expect(keep($('mid'))).toBe(true);
    expect(keep($('toast'))).toBe(true);
    expect(keep($('other'))).toBe(true); // shell next to a needed sibling
    expect(keep($('deep'))).toBe(false);
  });

  it('never empties inline elements nor plain blocks whose child margins collapse through them', () => {
    const keep = setup(
      '<p id="p"><span id="s"><b id="b">mot</b></span></p>' +
        '<div id="plain"><div id="child" style="margin:8px 0"><i id="leaf">x</i></div></div>' +
        '<div id="boxed" style="padding:4px 0"><div id="inner">y</div></div>',
      { p: VISIBLE },
    );
    expect(keep($('s'))).toBe(true);
    expect(keep($('b'))).toBe(true); // the span is inline: its content is kept
    expect(keep($('plain'))).toBe(true);
    expect(keep($('child'))).toBe(true); // plain block: opened, its child becomes the shell
    expect(keep($('leaf'))).toBe(true); // `child` is itself a plain block (no padding/border) → opened too
    expect(keep($('boxed'))).toBe(true);
    expect(keep($('inner'))).toBe(false); // padding on both edges: safe shell
  });

  it('always excludes the Fixi UI, even when visible', () => {
    const keep = setup(`<div id="${FIXI_ROOT_ID}"><button id="btn">x</button></div>`, {
      [FIXI_ROOT_ID]: VISIBLE,
      btn: VISIBLE,
    });
    expect(keep($(FIXI_ROOT_ID))).toBe(false);
  });
});
