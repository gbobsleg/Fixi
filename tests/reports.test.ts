import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/server/repositories/apps.js';
import { getReportById, type ReportRow } from '../src/server/repositories/reports.js';
import {
  makeApp,
  makeTestApp,
  multipart,
  PNG_BYTES,
  reportPayload,
  TEST_ORIGIN,
  type MultipartFile,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let shifti: App;

beforeEach(async () => {
  env = await makeTestApp();
  shifti = makeApp(env.db);
});
afterEach(async () => {
  await env.close();
});

const screenshot: MultipartFile = { name: 'screenshot', filename: 'capture.png', content: PNG_BYTES, type: 'image/png' };

/** `origin: null` sends the request without any Origin header. */
async function send(payload: unknown, files: MultipartFile[] = [], origin: string | null = TEST_ORIGIN) {
  const { body, contentType } = await multipart(payload, files);
  return env.app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: { 'content-type': contentType, ...(origin ? { origin } : {}) },
    payload: body,
  });
}

const stored = () => readdirSync(env.storageDir);

describe('POST /api/reports — success', () => {
  it('stores the report, the PNG and computes the anomaly flags', async () => {
    const timeline = [
      { t: 1000, type: 'nav', url: '/plannings/edit/42', kind: 'load' },
      { t: 2000, type: 'click', selector: 'button#btn-save', text: 'Valider' },
      { t: 3000, type: 'net', method: 'POST', url: '/api/shifts/save', status: 500, durationMs: 412, responseBody: 'SQL error' },
      { t: 3100, type: 'net', method: 'GET', url: '/api/x', status: 404, durationMs: 10 },
      { t: 3200, type: 'js_error', source: 'error', message: 'TypeError: x is undefined', file: 'a.js', line: 142, col: 18 },
    ];
    const res = await send(reportPayload(shifti, { timeline }), [screenshot]);
    expect(res.statusCode).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);

    const row = getReportById(env.db, res.json().id) as ReportRow;
    expect(row.status).toBe('new');
    expect(row.category).toBe('bug');
    expect(row.user_email).toBe('j.dupont@domaine.fr');
    expect(row.has_http_error).toBe(1);
    expect(row.max_http_status).toBe(500);
    expect(row.has_js_error).toBe(1);
    expect(JSON.parse(row.timeline_json)).toHaveLength(5);
    expect(row.screenshot_path).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(existsSync(join(env.storageDir, row.screenshot_path!))).toBe(true);
  });

  it('leaves the flags at 0 when the timeline has no anomaly', async () => {
    const res = await send(
      reportPayload(shifti, { timeline: [{ t: 1, type: 'net', method: 'GET', url: '/ok', status: 200, durationMs: 5 }] }),
      [screenshot],
    );
    const row = getReportById(env.db, res.json().id) as ReportRow;
    expect(row.has_http_error).toBe(0);
    expect(row.max_http_status).toBeNull();
    expect(row.has_js_error).toBe(0);
  });

  it('accepts a report without screenshot when a comment is given', async () => {
    const res = await send(reportPayload(shifti));
    expect(res.statusCode).toBe(201);
    expect((getReportById(env.db, res.json().id) as ReportRow).screenshot_path).toBeNull();
  });

  it('accepts a report with only a screenshot (empty comment)', async () => {
    const res = await send(reportPayload(shifti, { comment: '' }), [screenshot]);
    expect(res.statusCode).toBe(201);
  });

  it('stores a text attachment with its sanitized original name', async () => {
    const res = await send(reportPayload(shifti), [
      { name: 'attachment', filename: '../../etc/notes.txt', content: Buffer.from('héllo'), type: 'text/plain' },
    ]);
    expect(res.statusCode).toBe(201);
    const row = getReportById(env.db, res.json().id) as ReportRow;
    expect(row.attachment_original_name).toBe('notes.txt');
    expect(row.attachment_path).toMatch(/\.txt$/);
    expect(row.attachment_mime).toBe('text/plain');
  });

  it('truncates oversized text fields instead of rejecting the report', async () => {
    const res = await send(
      reportPayload(shifti, {
        timeline: [{ t: 1, type: 'net', method: 'POST', url: '/x', status: 500, durationMs: 1, responseBody: 'a'.repeat(5000) }],
      }),
    );
    expect(res.statusCode).toBe(201);
    const row = getReportById(env.db, res.json().id) as ReportRow;
    expect(JSON.parse(row.timeline_json)[0].responseBody).toHaveLength(500);
  });

  it('drops a malformed e-mail instead of rejecting the report', async () => {
    const res = await send(reportPayload(shifti, { userEmail: 'not-an-email' }));
    expect(res.statusCode).toBe(201);
    expect((getReportById(env.db, res.json().id) as ReportRow).user_email).toBeNull();
  });
});

describe('POST /api/reports — authentication and CORS', () => {
  it('rejects a wrong API key with 401', async () => {
    const res = await send(reportPayload(shifti, { apiKey: 'wrong' }), [screenshot]);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown application with 401', async () => {
    const res = await send(reportPayload(shifti, { app: 'unknown' }), [screenshot]);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an origin that is not allowed for this application with 403', async () => {
    const flowi = makeApp(env.db, { slug: 'flowi', name: 'Flowi', allowed_origins: ['https://flowi.interne'] });
    // TEST_ORIGIN is allowed for shifti only: using it with flowi's valid key must fail.
    const res = await send(reportPayload(flowi), [screenshot], TEST_ORIGIN);
    expect(res.statusCode).toBe(403);
    expect(stored()).toHaveLength(0);
  });

  it('rejects a request without Origin with 403', async () => {
    const res = await send(reportPayload(shifti), [screenshot], null);
    expect(res.statusCode).toBe(403);
  });

  it('answers the CORS preflight only for known origins', async () => {
    const ok = await env.app.inject({ method: 'OPTIONS', url: '/api/reports', headers: { origin: TEST_ORIGIN } });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(ok.headers['access-control-allow-methods']).toContain('POST');

    const ko = await env.app.inject({ method: 'OPTIONS', url: '/api/reports', headers: { origin: 'https://evil.example' } });
    expect(ko.statusCode).toBe(204);
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('exposes the CORS header on error responses too', async () => {
    const res = await send(reportPayload(shifti, { apiKey: 'wrong' }));
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
  });

  it('is rate limited', async () => {
    await env.close();
    env = await makeTestApp({ rateLimit: { loginPerMin: 5, reportsPerMin: 3 } });
    shifti = makeApp(env.db);
    for (let i = 0; i < 3; i++) expect((await send(reportPayload(shifti))).statusCode).toBe(201);
    expect((await send(reportPayload(shifti))).statusCode).toBe(429);
  });
});

describe('POST /api/reports — validation', () => {
  it('rejects a fake PNG (executable renamed .png) with 400 and stores nothing', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const res = await send(reportPayload(shifti), [
      { name: 'screenshot', filename: 'capture.png', content: exe, type: 'image/png' },
    ]);
    expect(res.statusCode).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it('rejects a screenshot that is a real image but not a PNG', async () => {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    const res = await send(reportPayload(shifti), [
      { name: 'screenshot', filename: 'capture.png', content: jpeg, type: 'image/png' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an executable attachment', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const res = await send(reportPayload(shifti), [
      { name: 'attachment', filename: 'tool.exe', content: exe, type: 'application/octet-stream' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a binary file disguised as .txt', async () => {
    const res = await send(reportPayload(shifti), [
      { name: 'attachment', filename: 'notes.txt', content: Buffer.from([0x68, 0x00, 0x69]), type: 'text/plain' },
    ]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a file larger than 5 MB with 413', async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const res = await send(reportPayload(shifti), [
      { name: 'screenshot', filename: 'capture.png', content: big, type: 'image/png' },
    ]);
    expect(res.statusCode).toBe(413);
    expect(stored()).toHaveLength(0);
  });

  it('requires a comment when there is no screenshot', async () => {
    const res = await send(reportPayload(shifti, { comment: '   ' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('comment_required');
  });

  it('rejects a timeline with more than 40 events', async () => {
    const timeline = Array.from({ length: 41 }, (_, i) => ({ t: i, type: 'nav', url: '/', kind: 'push' }));
    const res = await send(reportPayload(shifti, { timeline }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid category and a non-JSON payload', async () => {
    expect((await send(reportPayload(shifti, { category: 'critical' }))).statusCode).toBe(400);
    expect((await send('{not json')).statusCode).toBe(400);
  });

  it('rejects a non-multipart request', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { origin: TEST_ORIGIN },
      payload: { app: 'shifti' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /widget.js', () => {
  it('does not add admin or CORP headers to the widget script', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/widget.js' });
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
  });
});
