import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginCookie, makeApp, makeTestApp, multipart, PNG_BYTES, reportPayload, TEST_ORIGIN, type TestEnv } from './helpers.js';

let env: TestEnv;
let cookie: string;

beforeEach(async () => {
  env = await makeTestApp();
  cookie = await loginCookie(env.app);
});
afterEach(async () => {
  await env.close();
});

const validBody = {
  slug: 'shifti',
  name: 'Shifti',
  allowed_origins: ['https://shifti.interne/', 'http://localhost'],
  issue_provider: 'github',
  issue_project: 'org/shifti',
  issue_default_labels: 'bug,fixi',
  issue_anonymize: true,
};

describe('apps CRUD', () => {
  it('requires authentication', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/admin/apps' });
    expect(res.statusCode).toBe(401);
  });

  it('creates an app with a generated key and normalized origins', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload: validBody });
    expect(res.statusCode).toBe(201);
    const { app } = res.json();
    expect(app.api_key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(app.allowed_origins).toEqual(['https://shifti.interne', 'http://localhost']);
    expect(app.issue_anonymize).toBe(true);
    expect(app.issue_provider).toBe('github');
  });

  it('lists, reads, updates and regenerates the key', async () => {
    const created = (
      await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload: validBody })
    ).json().app;

    const list = await env.app.inject({ method: 'GET', url: '/api/admin/apps', headers: { cookie } });
    expect(list.json().apps).toHaveLength(1);

    const put = await env.app.inject({
      method: 'PUT',
      url: `/api/admin/apps/${created.id}`,
      headers: { cookie },
      payload: { ...validBody, name: 'Shifti v2', issue_provider: null },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().app.name).toBe('Shifti v2');
    expect(put.json().app.api_key).toBe(created.api_key); // the key is untouched by an update

    const regen = await env.app.inject({
      method: 'POST',
      url: `/api/admin/apps/${created.id}/regenerate-key`,
      headers: { cookie },
    });
    expect(regen.json().app.api_key).not.toBe(created.api_key);
  });

  it('validates the input', async () => {
    const bad = async (payload: Record<string, unknown>) =>
      (await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload })).statusCode;
    expect(await bad({ ...validBody, slug: 'Bad Slug' })).toBe(400);
    expect(await bad({ ...validBody, allowed_origins: ['not a url'] })).toBe(400);
    expect(await bad({ ...validBody, allowed_origins: ['ftp://x.example'] })).toBe(400);
    expect(await bad({ ...validBody, issue_provider: 'bitbucket' })).toBe(400);
    expect(await bad({ ...validBody, name: '' })).toBe(400);
  });

  it('refuses a duplicate slug with 409', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload: validBody });
    const res = await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload: validBody });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for an unknown app', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/admin/apps/999', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('deletes an app without reports, but refuses (409) when it has reports', async () => {
    const empty = makeApp(env.db, { slug: 'flowi', name: 'Flowi' });
    const del = await env.app.inject({ method: 'DELETE', url: `/api/admin/apps/${empty.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const used = makeApp(env.db);
    const { body, contentType } = await multipart(reportPayload(used), [
      { name: 'screenshot', filename: 'c.png', content: PNG_BYTES, type: 'image/png' },
    ]);
    const sent = await env.app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { 'content-type': contentType, origin: TEST_ORIGIN },
      payload: body,
    });
    expect(sent.statusCode).toBe(201);

    const refused = await env.app.inject({ method: 'DELETE', url: `/api/admin/apps/${used.id}`, headers: { cookie } });
    expect(refused.statusCode).toBe(409);
  });
});
