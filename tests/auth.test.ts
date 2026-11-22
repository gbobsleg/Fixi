import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, loginCookie, makeTestApp, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(async () => {
  await env?.close();
});

describe('admin login', () => {
  it('opens a session with valid credentials and sets an HttpOnly signed cookie', async () => {
    env = await makeTestApp();
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'fixi_sid');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
  });

  it('refuses a wrong password and a wrong username', async () => {
    env = await makeTestApp();
    const wrongPassword = await env.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'admin', password: 'nope-nope' },
    });
    const wrongUser = await env.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'root', password: ADMIN_PASSWORD },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongUser.statusCode).toBe(401);
    expect(wrongPassword.cookies).toHaveLength(0);
  });

  it('rejects a malformed body with 400', async () => {
    env = await makeTestApp();
    const res = await env.app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 429 after 5 attempts per minute', async () => {
    env = await makeTestApp();
    const attempt = () =>
      env.app.inject({ method: 'POST', url: '/api/admin/login', payload: { username: 'admin', password: 'bad-bad-bad' } });
    for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe('session protection', () => {
  it('GET /api/admin/me requires a session', async () => {
    env = await makeTestApp();
    const anonymous = await env.app.inject({ method: 'GET', url: '/api/admin/me' });
    expect(anonymous.statusCode).toBe(401);

    const cookie = await loginCookie(env.app);
    const authed = await env.app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } });
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual({ user: 'admin' });
  });

  it('refuses a forged or tampered cookie', async () => {
    env = await makeTestApp();
    const cookie = await loginCookie(env.app);
    const res = await env.app.inject({
      method: 'GET',
      url: '/api/admin/me',
      headers: { cookie: cookie + 'tampered' },
    });
    expect(res.statusCode).toBe(401);
    const forged = await env.app.inject({
      method: 'GET',
      url: '/api/admin/me',
      headers: { cookie: 'fixi_sid=abc.def' },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('logout invalidates the session', async () => {
    env = await makeTestApp();
    const cookie = await loginCookie(env.app);
    await env.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } });
    const res = await env.app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired session', async () => {
    env = await makeTestApp();
    const cookie = await loginCookie(env.app);
    env.db.prepare('UPDATE sessions SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    const res = await env.app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('redirects admin pages to the login page when anonymous', async () => {
    env = await makeTestApp();
    const res = await env.app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('blocks state-changing admin requests coming from a foreign Origin (CSRF)', async () => {
    env = await makeTestApp();
    const cookie = await loginCookie(env.app);
    const foreign = await env.app.inject({
      method: 'POST',
      url: '/api/admin/apps',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { slug: 'x', name: 'X' },
    });
    expect(foreign.statusCode).toBe(403);
    const own = await env.app.inject({
      method: 'POST',
      url: '/api/admin/apps',
      headers: { cookie, origin: 'http://fixi.test' },
      payload: { slug: 'x', name: 'X' },
    });
    expect(own.statusCode).toBe(201);
  });
});

describe('health and widget', () => {
  it('GET /healthz is public', async () => {
    env = await makeTestApp();
    const res = await env.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true });
  });
});
