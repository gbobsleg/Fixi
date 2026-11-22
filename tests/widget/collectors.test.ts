// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { installClicks } from '../../src/widget/breadcrumbs/click.js';
import { createStore } from '../../src/widget/breadcrumbs/store.js';
import { buildSelector } from '../../src/widget/selector.js';
import type { NetEvent, TimelineEvent } from '../../src/shared/types.js';

function html(markup: string): void {
  document.body.innerHTML = markup;
}

describe('buildSelector', () => {
  it('produces tag#id.class[name] like the spec examples', () => {
    html('<button id="btn-save-shift" class="btn btn-primary">Valider</button><select name="agent_id"></select>');
    expect(buildSelector(document.querySelector('button')!)).toBe('button#btn-save-shift.btn.btn-primary');
    expect(buildSelector(document.querySelector('select')!)).toBe('select[name="agent_id"]');
  });

  it('keeps at most 2 classes and drops generated ones', () => {
    html('<div class="card css-1a2b3c shadow p-3 sc-bdVaJa jsx-123456 x1234567890"></div>');
    expect(buildSelector(document.querySelector('div')!)).toBe('div.card.shadow');
  });

  it('never includes a value', () => {
    html('<input type="password" name="pwd" value="hunter2">');
    const selector = buildSelector(document.querySelector('input')!);
    expect(selector).toBe('input[name="pwd"]');
    expect(selector).not.toContain('hunter2');
  });
});

describe('createStore', () => {
  const net = (status: number, i: number): NetEvent => ({
    t: i,
    type: 'net',
    method: 'GET',
    url: `/r/${i}`,
    status,
    durationMs: 1,
  });

  beforeEach(() => sessionStorage.clear());

  it('keeps at most 40 events', () => {
    const store = createStore('shifti');
    for (let i = 0; i < 60; i++) store.push({ t: i, type: 'click', selector: `b${i}` });
    const events = store.read();
    expect(events).toHaveLength(40);
    expect((events[0] as { selector: string }).selector).toBe('b20'); // oldest dropped first
  });

  it('drops old successful requests before clicks and errors', () => {
    const store = createStore('shifti');
    store.push({ t: 0, type: 'click', selector: 'button#important' });
    store.push({ t: 1, type: 'net', method: 'POST', url: '/fail', status: 500, durationMs: 5 });
    for (let i = 2; i < 80; i++) store.push(net(200, i)); // polling flood
    const events = store.read();
    expect(events).toHaveLength(40);
    expect(events.some((e) => e.type === 'click')).toBe(true);
    expect(events.some((e) => e.type === 'net' && e.status === 500)).toBe(true);
  });

  it('survives a page reload through sessionStorage, per application', () => {
    createStore('shifti').push({ t: 1, type: 'nav', url: '/a', kind: 'load' });
    expect(createStore('shifti').read()).toHaveLength(1); // "reloaded" page
    expect(createStore('flowi').read()).toHaveLength(0);
  });

  it('persists events completed after push (async response body)', () => {
    const store = createStore('shifti');
    const event = store.push(net(500, 1));
    event.responseBody = 'late body';
    store.persist();
    expect((createStore('shifti').read()[0] as NetEvent).responseBody).toBe('late body');
  });

  it('ignores corrupted storage content', () => {
    sessionStorage.setItem('fixi:tl:shifti', '{not json');
    expect(createStore('shifti').read()).toEqual([]);
    sessionStorage.setItem('fixi:tl:shifti', '"a string"');
    expect(createStore('shifti').read()).toEqual([]);
  });

  it('keeps working in memory when sessionStorage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const store = createStore('shifti', broken);
    expect(() => store.push({ t: 1, type: 'click', selector: 'a' })).not.toThrow();
    expect(store.read()).toHaveLength(1);
  });
});

describe('click collector', () => {
  let events: TimelineEvent[];

  beforeEach(() => {
    sessionStorage.clear();
    const store = createStore('click-test');
    installClicks(store);
    events = [];
    // Read through the store each time
    (events as unknown as { read: () => TimelineEvent[] }).read = () => store.read();
  });

  const clicks = () => (events as unknown as { read: () => TimelineEvent[] }).read();

  it('records the selector and the visible text (truncated to 50 chars) of a button', () => {
    html(`<button id="go" class="btn">${'Valider le planning '.repeat(5)}</button>`);
    document.getElementById('go')!.click();
    const e = clicks().at(-1) as { selector: string; text: string };
    expect(e.selector).toBe('button#go.btn');
    expect(e.text.length).toBeLessThanOrEqual(50);
    expect(e.text.startsWith('Valider le planning')).toBe(true);
  });

  it('resolves the click to the closest interactive element', () => {
    html('<button id="b"><span id="inner">Envoyer</span></button>');
    document.getElementById('inner')!.click();
    expect((clicks().at(-1) as { selector: string }).selector).toBe('button#b');
  });

  it('never records what the user typed or the options of a select', () => {
    html(`<input id="pwd" type="password" value="hunter2"><input id="txt" type="text" value="secret-note">
          <select id="s"><option>Agent A</option><option>Agent B</option></select>
          <input id="sub" type="submit" value="Enregistrer">`);
    for (const id of ['pwd', 'txt', 's', 'sub']) document.getElementById(id)!.click();
    const recorded = JSON.stringify(clicks());
    expect(recorded).not.toContain('hunter2');
    expect(recorded).not.toContain('secret-note');
    expect(recorded).not.toContain('Agent A');
    expect(recorded).toContain('Enregistrer'); // a submit button's value is its label
  });

  it('ignores clicks inside the Fixi widget', () => {
    html('<div id="fixi-root"></div><button id="other">Autre</button>');
    const host = document.getElementById('fixi-root')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const inside = document.createElement('button');
    shadow.append(inside);
    inside.click();
    expect(clicks()).toHaveLength(0);
    document.getElementById('other')!.click();
    expect(clicks()).toHaveLength(1);
  });
});
