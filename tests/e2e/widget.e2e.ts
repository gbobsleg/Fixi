// End-to-end test of the widget in a REAL browser (Microsoft Edge, already installed on Windows).
//   npm run test:e2e
// It starts Fixi (:3100) and the fake host application (:5174) in-process with a throw-away database,
// replays what a user does, then checks what really arrived in the database and on disk.
//
// Not part of `npm test` (it needs a browser). Uses playwright-core only as a driver: nothing is downloaded.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { getReportById, type ReportRow } from '../../src/server/repositories/reports.js';
import { buildTestHost } from '../../test-host/server.js';
import { makeApp, makeTestApp, PNG_BYTES } from '../helpers.js';

const FIXI_PORT = 3100;
const HOST_PORT = 5174;
const FIXI_URL = `http://localhost:${FIXI_PORT}`;
const HOST_URL = `http://localhost:${HOST_PORT}`;

execFileSync(process.execPath, ['scripts/build-widget.mjs'], { stdio: 'inherit' });

const env = await makeTestApp({ rateLimit: { loginPerMin: 5, reportsPerMin: 1000 } });
const app = makeApp(env.db, { allowed_origins: [HOST_URL] });
await env.app.listen({ port: FIXI_PORT, host: '127.0.0.1' });
const host = await buildTestHost({ port: HOST_PORT, fixiUrl: FIXI_URL, appSlug: app.slug, apiKey: app.api_key });
await host.listen({ port: HOST_PORT, host: '127.0.0.1' });

const browser: Browser = await chromium.launch({ channel: 'msedge', headless: true });

// ------------------------------------------------------------------ helpers
let failures = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}

async function newPage(): Promise<{ page: Page; context: BrowserContext; pageErrors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(HOST_URL);
  await page.waitForFunction(() => !!document.getElementById('fixi-root'));
  return { page, context, pageErrors };
}

const click = (page: Page, id: string) => page.evaluate((i) => document.getElementById(i)!.click(), id);
const lastReport = (): ReportRow => {
  const row = env.db.prepare('SELECT id FROM bug_reports ORDER BY id DESC LIMIT 1').get() as { id: number };
  return getReportById(env.db, row.id) as ReportRow;
};
const timelineOf = (r: ReportRow) => JSON.parse(r.timeline_json) as Record<string, any>[];
const pngSize = (file: string) => {
  const buf = readFileSync(join(env.storageDir, file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
};

/** Pixels of a stored PNG, read back through a canvas in the browser. */
async function pixelsOf(page: Page, file: string, points: { x: number; y: number }[]) {
  const base64 = readFileSync(join(env.storageDir, file)).toString('base64');
  return page.evaluate(
    async ({ base64, points }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const at = points.map((p) => Array.from(ctx.getImageData(p.x, p.y, 1, 1).data.slice(0, 3)));
      // count clearly red pixels (the brush)
      const all = ctx.getImageData(0, 0, c.width, c.height).data;
      let red = 0;
      for (let i = 0; i < all.length; i += 4) if (all[i] > 200 && all[i + 1] < 60 && all[i + 2] < 60) red++;
      return { at, red };
    },
    { base64, points },
  );
}

const modal = '#fixi-root .modal';

async function openFixi(page: Page): Promise<void> {
  await page.locator('#fixi-root .tab').click();
  await page.locator(modal).waitFor({ state: 'visible', timeout: 20_000 });
}

// -------------------------------------------------------------------- tests
try {
  console.log('\nScenario 1: full report (events, scroll, capture, annotation, paste, send)');
  {
    const { page, context, pageErrors } = await newPage();

    await step('the tab is displayed at the right edge, vertically centered', async () => {
      const box = (await page.locator('#fixi-root .tab').boundingBox())!;
      assert.ok(box.x + box.width >= 1279, `tab should touch the right edge (x=${box.x}, w=${box.width})`);
      assert.ok(Math.abs(box.y + box.height / 2 - 360) < 6, `tab should be centered (y=${box.y}, h=${box.height})`);
    });

    // provoke events
    for (const id of ['btn-ok', 'btn-fetch500', 'btn-xhr422', 'btn-typeerror', 'btn-rejection', 'btn-console', 'btn-secret', 'btn-push', 'btn-save-shift']) {
      await click(page, id);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(600);

    // Scroll so that the page header is out of view and the masked block is visible.
    // Bootstrap sets `scroll-behavior: smooth`: force an instant scroll, or positions are measured mid-animation.
    await page.evaluate(() => window.scrollTo({ top: 300, left: 0, behavior: 'instant' }));
    await page.waitForTimeout(150);
    const maskCenter = await page.evaluate(() => {
      const r = document.getElementById('bloc-masque')!.getBoundingClientRect();
      const s = document.getElementById('zone-scroll')!.getBoundingClientRect();
      return {
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        inView: r.top > 0 && r.bottom < innerHeight && s.top > 0 && s.bottom < innerHeight,
        scrollBox: { x: Math.round(s.x + 20), y: Math.round(s.y + 4) }, // just inside the border
      };
    });
    assert.ok(maskCenter.inView, `the masked block and the scroll box must be visible for the test (mask y=${maskCenter.y})`);

    await openFixi(page);

    await step('the modal does not appear on the capture, and the tab is hidden meanwhile', async () => {
      // checked below on the stored PNG; here: the tab is hidden while the modal is open
      assert.equal(await page.locator('#fixi-root .tab').isHidden(), true);
    });

    await step('"Bug" is preselected and the textarea has the focus', async () => {
      assert.equal(await page.locator('#fixi-root input[value="bug"]').isChecked(), true);
      const focused = await page.evaluate(() => document.getElementById('fixi-root')!.shadowRoot!.activeElement?.tagName);
      assert.equal(focused, 'TEXTAREA');
    });

    await step('a text paste is NOT intercepted (still reaches the textarea)', async () => {
      const notPrevented = await page.evaluate(() => {
        const ta = document.getElementById('fixi-root')!.shadowRoot!.querySelector('textarea')!;
        const dt = new DataTransfer();
        dt.setData('text/plain', 'du texte collé');
        return ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      assert.equal(notPrevented, true, 'paste of plain text must not be preventDefault-ed');
      assert.equal(await page.locator('#fixi-root .attached').count(), 0);
    });

    await step('"Bloquant" can be chosen and a comment typed', async () => {
      await page.locator('#fixi-root .pill.blocking').click();
      await page.locator('#fixi-root textarea').fill('Quand je clique sur valider, la roue tourne.');
      assert.equal(await page.locator('#fixi-root input[value="blocking"]').isChecked(), true);
    });

    let srcBefore = '';
    await step('the annotation overlay opens, a red stroke can be drawn and validated', async () => {
      srcBefore = (await page.locator('#fixi-root .shot-thumb img').getAttribute('src'))!;
      await page.locator('#fixi-root .shot-thumb').click();
      const canvas = page.locator('#fixi-root .annot canvas');
      await canvas.waitFor({ state: 'visible' });
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.55);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.65, { steps: 10 });
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.65, { steps: 10 });
      await page.mouse.up();
      await page.locator('#fixi-root .annot .btn.primary').click();
      await page.locator('#fixi-root .annot').waitFor({ state: 'detached' });
      const srcAfter = await page.locator('#fixi-root .shot-thumb img').getAttribute('src');
      assert.notEqual(srcAfter, srcBefore, 'the thumbnail must be replaced by the annotated image');
    });

    await step('"Annuler le dernier trait" and "Effacer" work', async () => {
      await page.locator('#fixi-root .shot-thumb').click();
      const canvas = page.locator('#fixi-root .annot canvas');
      await canvas.waitFor({ state: 'visible' });
      const box = (await canvas.boundingBox())!;
      const draw = async (dx: number) => {
        await page.mouse.move(box.x + box.width * dx, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * dx + 80, box.y + 160, { steps: 5 });
        await page.mouse.up();
      };
      const undo = page.locator('#fixi-root .annot .btn', { hasText: 'Annuler le dernier trait' });
      assert.equal(await undo.isDisabled(), true, 'nothing to undo yet');
      await draw(0.6);
      await draw(0.7);
      assert.equal(await undo.isDisabled(), false);
      await undo.click();
      await page.locator('#fixi-root .annot .btn', { hasText: 'Effacer' }).click();
      assert.equal(await undo.isDisabled(), true, 'everything cleared');
      await page.locator('#fixi-root .annot .btn', { hasText: /^Annuler$/ }).click(); // leave without changing
      await page.locator('#fixi-root .annot').waitFor({ state: 'detached' });
    });

    await step('Ctrl+V of an image attaches it with a preview and a remove button', async () => {
      await page.evaluate((b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], 'capture-externe.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, PNG_BYTES.toString('base64'));
      await page.locator('#fixi-root .attached').waitFor({ state: 'visible' });
      assert.match((await page.locator('#fixi-root .attached .name').textContent()) ?? '', /capture-externe\.png/);
      assert.equal(await page.locator('#fixi-root .attached img').count(), 1);
    });

    await step('Send: success message, then the dialog closes by itself', async () => {
      await page.locator('#fixi-root .btn.primary', { hasText: 'Envoyer' }).click();
      await page.locator('#fixi-root .success').waitFor({ state: 'visible', timeout: 15_000 });
      assert.match((await page.locator('#fixi-root .success').textContent()) ?? '', /Merci, votre signalement a bien été transmis\./);
      await page.locator(modal).waitFor({ state: 'detached', timeout: 5_000 });
      assert.equal(await page.locator('#fixi-root .tab').isVisible(), true, 'the tab comes back');
    });

    const report = lastReport();
    const timeline = timelineOf(report);

    // Debug aid: E2E_DUMP_DIR=<dir> keeps the stored screenshot and timeline of this scenario.
    if (process.env.E2E_DUMP_DIR) {
      const { copyFileSync, mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(process.env.E2E_DUMP_DIR, { recursive: true });
      copyFileSync(join(env.storageDir, report.screenshot_path!), join(process.env.E2E_DUMP_DIR, 'capture.png'));
      writeFileSync(join(process.env.E2E_DUMP_DIR, 'timeline.json'), JSON.stringify(timeline, null, 2));
    }

    await step('the report is stored with the right fields', async () => {
      assert.equal(report.category, 'blocking');
      assert.equal(report.comment, 'Quand je clique sur valider, la roue tourne.');
      assert.equal(report.user_info, 'j.dupont (superviseur)');
      assert.equal(report.user_email, 'j.dupont@domaine.fr');
      assert.equal(report.app_version, 'a3f9c12');
      assert.equal(report.viewport, '1280x720');
      assert.match(report.user_agent, /Edg\//);
      assert.equal(report.url, `${HOST_URL}/plannings/edit/42?week=47`);
      assert.ok(report.screenshot_path && report.attachment_path);
      assert.equal(report.attachment_original_name, 'capture-externe.png');
    });

    await step('timeline: NAV, CLICK (selector + text), NET 500 with body and X-Request-Id, JS_ERROR', async () => {
      const types = new Set(timeline.map((e) => e.type));
      for (const t of ['nav', 'click', 'net', 'js_error']) assert.ok(types.has(t), `missing event type ${t}`);
      assert.ok(timeline.some((e) => e.type === 'nav' && e.kind === 'load'));
      assert.ok(timeline.some((e) => e.type === 'nav' && e.kind === 'push' && e.url === '/plannings/edit/42?week=47'));
      const save = timeline.find((e) => e.type === 'click' && e.selector.startsWith('button#btn-save-shift'));
      assert.ok(save, 'click on the save button');
      assert.equal(save.selector, 'button#btn-save-shift.btn.btn-primary');
      assert.equal(save.text, 'Valider le planning');
      const net500 = timeline.find((e) => e.type === 'net' && e.status === 500 && e.url === '/api/fail500');
      assert.ok(net500, 'the 500 request');
      assert.equal(net500.method, 'POST');
      assert.equal(net500.requestId, 'req_98ab');
      assert.match(net500.responseBody, /Integrity constraint violation: Column 'shift_type_id' cannot be null/);
      assert.match(net500.requestBody, /"shift_type_id":null/);
      assert.ok(typeof net500.durationMs === 'number');
      assert.ok(timeline.some((e) => e.type === 'net' && e.status === 422 && /csrf_token/.test(e.requestBody ?? '')), 'XHR 422');
      assert.ok(timeline.some((e) => e.type === 'net' && e.status === 200 && e.url === '/api/ok'), 'successful request');
    });

    await step('JS errors: uncaught TypeError, unhandled rejection, console.error', async () => {
      const errors = timeline.filter((e) => e.type === 'js_error');
      const typeError = errors.find((e) => e.source === 'error');
      assert.ok(typeError);
      assert.match(typeError.message, /TypeError: Cannot read properties of undefined/);
      assert.match(typeError.file, /app\.js/);
      assert.ok(typeError.line > 0 && typeError.col > 0, 'line and column');
      assert.ok(errors.some((e) => e.source === 'unhandledrejection' && /Chargement du planning impossible/.test(e.message)));
      assert.ok(errors.some((e) => e.source === 'console' && /Erreur loguée par appli/.test(e.message)));
      assert.equal(report.has_js_error, 1);
      assert.equal(report.has_http_error, 1);
      assert.equal(report.max_http_status, 500);
    });

    await step('sensitive data never leaves the browser (password, token, api_key, csrf, URL token)', async () => {
      const raw = report.timeline_json + report.url;
      for (const secret of ['hunter2', 'K-123', 'T-456', 'abc123', 'url-secret', 'should-not-leak']) {
        assert.ok(!raw.includes(secret), `"${secret}" must not be sent`);
      }
      assert.match(raw, /\[REDACTED\]/);
      const secretCall = timeline.find((e) => e.type === 'net' && e.url.startsWith('/api/fail500?week=47'));
      assert.ok(secretCall, 'the call carrying secrets was recorded');
      assert.match(secretCall.url, /token=\[REDACTED\]/);
      assert.match(secretCall.requestBody, /"ok":"visible"/, 'non-sensitive fields are kept');
      assert.match(secretCall.requestBody, /"agent_id":1/);
    });

    await step("Fixi's own request is not recorded in the timeline", async () => {
      assert.ok(!timeline.some((e) => e.type === 'net' && /\/api\/reports/.test(e.url)));
    });

    await step('the stored PNG: viewport size, under 5 MB, scroll applied, fixed banner in place, mask, brush, no modal', async () => {
      const { width, height, bytes } = pngSize(report.screenshot_path!);
      assert.ok(bytes < 5 * 1024 * 1024);
      const client = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.clientHeight]);
      assert.deepEqual([width, height], client, 'PNG must be exactly the visible area, not the whole 3000px+ page');

      const points = [
        { x: 10, y: 10 }, // navbar would be here if the scroll offset were ignored
        { x: 100, y: height - 10 }, // position:fixed banner, must stay glued to the bottom
        { x: maskCenter.x, y: maskCenter.y }, // data-fixi-mask block
        { x: width - 60, y: Math.round(height / 2) }, // where the Fixi tab sits: must NOT be on the capture
        maskCenter.scrollBox, // inner scrollable container, scrolled to row 10
        { x: maskCenter.scrollBox.x, y: maskCenter.scrollBox.y + 30 },
        { x: maskCenter.scrollBox.x, y: maskCenter.scrollBox.y + 60 },
      ];
      const { at, red } = await pixelsOf(page, report.screenshot_path!, points);
      assert.ok(at[0][0] > 200 && at[0][1] > 200, `navbar must be scrolled out of the capture, got rgb(${at[0]})`);
      assert.deepEqual(at[1], [25, 135, 84], `fixed banner must be at the bottom, got rgb(${at[1]})`);
      assert.deepEqual(at[2], [156, 163, 175], `masked block must be grey, got rgb(${at[2]})`);
      assert.ok(at[3][0] !== 79 || at[3][1] !== 70, 'the Fixi tab (indigo #4f46e5) must not appear on the capture');
      // Row i has colour rgb(i*5,100,100). The box is scrolled to row 10 (red channel 50). Unscrolled, the
      // pixels 30px and 60px below the box top would be rows 1-3 (red 5-15); scrolled they are rows 11-12.
      for (const p of [at[5], at[6]]) {
        assert.equal(p[1], 100, `inside the scroll box, got rgb(${p})`);
        assert.ok(p[0] >= 50 && p[0] <= 75, `inner scroll position must be kept (rows 10+), got rgb(${p})`);
      }
      assert.ok(red > 100, `the red brush stroke must be merged into the image (red pixels: ${red})`);
    });

    await step('no error comes from Fixi itself (only the provoked ones reach the page)', async () => {
      assert.ok(
        pageErrors.every((m) => /render|Chargement du planning/.test(m)),
        `unexpected page errors: ${pageErrors.join(' | ')}`,
      );
    });

    await context.close();
  }

  console.log('\nScenario 2: network failure keeps the typed text and allows a retry');
  {
    const { page, context } = await newPage();
    await openFixi(page);
    await page.locator('#fixi-root textarea').fill('Texte à ne pas perdre');
    const before = env.db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number };

    await page.route('**/api/reports', (route) => route.abort());
    await page.locator('#fixi-root .btn.primary').click();

    await step('an explicit error is displayed, the text is kept, the button becomes "Réessayer"', async () => {
      await page.locator('#fixi-root .error').waitFor({ state: 'visible', timeout: 10_000 });
      assert.match((await page.locator('#fixi-root .error').textContent()) ?? '', /Impossible de joindre le serveur Fixi/);
      assert.equal(await page.locator('#fixi-root textarea').inputValue(), 'Texte à ne pas perdre');
      assert.equal((await page.locator('#fixi-root .btn.primary').textContent())?.trim(), 'Réessayer');
    });

    await page.unroute('**/api/reports');
    await step('retrying succeeds', async () => {
      await page.locator('#fixi-root .btn.primary').click();
      await page.locator('#fixi-root .success').waitFor({ state: 'visible', timeout: 15_000 });
      const after = env.db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number };
      assert.equal(after.n, before.n + 1);
    });
    await context.close();
  }

  console.log('\nScenario 3: validation, no screenshot, Escape');
  {
    const { page, context } = await newPage();
    await openFixi(page);

    await step('empty comment + screenshot unchecked: blocked with a message', async () => {
      await page.locator('#fixi-root .check input').uncheck();
      await page.locator('#fixi-root .btn.primary').click();
      assert.match((await page.locator('#fixi-root .error').textContent()) ?? '', /décrire le problème/);
    });

    await step('without screenshot, only the comment is sent', async () => {
      await page.locator('#fixi-root textarea').fill('Sans capture');
      await page.locator('#fixi-root .btn.primary').click();
      await page.locator('#fixi-root .success').waitFor({ state: 'visible', timeout: 15_000 });
      const r = lastReport();
      assert.equal(r.comment, 'Sans capture');
      assert.equal(r.screenshot_path, null);
    });

    await page.locator(modal).waitFor({ state: 'detached', timeout: 5_000 });
    await step('Escape closes the dialog without sending', async () => {
      const before = env.db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number };
      await openFixi(page);
      await page.keyboard.press('Escape');
      await page.locator(modal).waitFor({ state: 'detached' });
      assert.equal((env.db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number }).n, before.n);
    });

    await step('window.Fixi.open() opens the dialog', async () => {
      await click(page, 'btn-open');
      await page.locator(modal).waitFor({ state: 'visible', timeout: 20_000 });
      await page.keyboard.press('Escape');
    });
    await context.close();
  }

  console.log('\nScenario 4: multi-page timeline, host Bootstrap modal');
  {
    const { page, context } = await newPage();
    await click(page, 'btn-save-shift');
    await page.waitForTimeout(200);
    await page.locator('#lien-page2').click();
    await page.waitForURL('**/page2.html');
    await page.waitForFunction(() => !!document.getElementById('fixi-root'));
    await click(page, 'btn-fetch500');
    await page.waitForTimeout(400);

    await step('the timeline survives a full page change (sessionStorage)', async () => {
      await openFixi(page);
      await page.locator('#fixi-root textarea').fill('Après changement de page');
      await page.locator('#fixi-root .btn.primary').click();
      await page.locator('#fixi-root .success').waitFor({ state: 'visible', timeout: 15_000 });
      const tl = timelineOf(lastReport());
      const loads = tl.filter((e) => e.type === 'nav' && e.kind === 'load').map((e) => e.url);
      assert.deepEqual(loads, ['/', '/page2.html']);
      assert.ok(tl.some((e) => e.type === 'click' && e.selector.includes('btn-save-shift')), 'click made on the previous page');
      assert.ok(tl.some((e) => e.type === 'net' && e.status === 500));
    });
    await page.locator(modal).waitFor({ state: 'detached', timeout: 5_000 });

    await page.goto(HOST_URL);
    await page.waitForFunction(() => !!document.getElementById('fixi-root'));
    await step("typing works even while a Bootstrap modal of the host is open (no focus trap theft)", async () => {
      await page.locator('[data-bs-target="#modal-bs"]').click();
      await page.locator('#modal-bs.show').waitFor({ state: 'visible' });
      await click(page, 'btn-open');
      await page.locator(modal).waitFor({ state: 'visible', timeout: 20_000 });
      await page.locator('#fixi-root textarea').click();
      await page.keyboard.type('saisie sous modale bootstrap');
      assert.equal(await page.locator('#fixi-root textarea').inputValue(), 'saisie sous modale bootstrap');
    });
    await context.close();
  }
} finally {
  await browser.close();
  await host.close();
  await env.close();
}

console.log(failures === 0 ? '\nE2E: all checks passed' : `\nE2E: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
