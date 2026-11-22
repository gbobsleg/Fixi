import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getReportById, type ReportRow } from '../src/server/repositories/reports.js';
import { loginCookie, makeApp, makeTestApp, multipart, PNG_BYTES, reportPayload, TEST_ORIGIN, type TestEnv } from './helpers.js';

let env: TestEnv;
let cookie: string;
let report: ReportRow;

beforeEach(async () => {
  env = await makeTestApp();
  cookie = await loginCookie(env.app);
  const shifti = makeApp(env.db);
  const { body, contentType } = await multipart(reportPayload(shifti), [
    { name: 'screenshot', filename: 'c.png', content: PNG_BYTES, type: 'image/png' },
    { name: 'attachment', filename: 'Relevé été.csv', content: Buffer.from('a;b\n1;2\n'), type: 'text/csv' },
  ]);
  const res = await env.app.inject({
    method: 'POST',
    url: '/api/reports',
    headers: { 'content-type': contentType, origin: TEST_ORIGIN },
    payload: body,
  });
  report = getReportById(env.db, res.json().id) as ReportRow;
});
afterEach(async () => {
  await env.close();
});

describe('GET /api/admin/files/:name', () => {
  it('requires a session', async () => {
    const res = await env.app.inject({ method: 'GET', url: `/api/admin/files/${report.screenshot_path}` });
    expect(res.statusCode).toBe(401);
  });

  it('serves the screenshot inline with hardened headers', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `/api/admin/files/${report.screenshot_path}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.rawPayload.equals(PNG_BYTES)).toBe(true);
  });

  it('serves a non-image attachment as a download with its original name', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `/api/admin/files/${report.attachment_path}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('Relevé été.csv'));
  });

  it('forces a download with ?download=1', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: `/api/admin/files/${report.screenshot_path}?download=1`,
      headers: { cookie },
    });
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('returns 404 for invalid names and path traversal attempts', async () => {
    writeFileSync(join(env.storageDir, 'secret.txt'), 'secret');
    for (const name of [
      'secret.txt',
      '..%2F..%2Fpackage.json',
      '%2e%2e%2f%2e%2e%2fpackage.json',
      'not-a-uuid.png',
      `${report.screenshot_path}.exe`,
    ]) {
      const res = await env.app.inject({ method: 'GET', url: `/api/admin/files/${name}`, headers: { cookie } });
      expect(res.statusCode, name).toBe(404);
    }
  });

  it('returns 404 for a valid name that does not exist', async () => {
    const res = await env.app.inject({
      method: 'GET',
      url: '/api/admin/files/00000000-0000-0000-0000-000000000000.png',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
