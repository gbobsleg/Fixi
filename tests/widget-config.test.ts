import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginCookie, makeApp, makeTestApp, TEST_ORIGIN, type TestEnv } from './helpers.js';

let env: TestEnv;
let cookie: string;

beforeEach(async () => {
  env = await makeTestApp();
  cookie = await loginCookie(env.app);
});
afterEach(async () => {
  await env.close();
});

const base = { slug: 'shifti', name: 'Shifti', allowed_origins: [TEST_ORIGIN] };

describe('widget color in the app settings', () => {
  it('defaults to the teal of Shifti / Flowi, then is updated and normalized', async () => {
    const created = (
      await env.app.inject({ method: 'POST', url: '/api/admin/apps', headers: { cookie }, payload: base })
    ).json().app;
    expect(created.widget_color).toBe('#318f9b');

    const put = await env.app.inject({
      method: 'PUT',
      url: `/api/admin/apps/${created.id}`,
      headers: { cookie },
      payload: { ...base, widget_color: '#FFD400' },
    });
    expect(put.json().app.widget_color).toBe('#ffd400');

    // An update that does not mention the color keeps it.
    const again = await env.app.inject({
      method: 'PUT',
      url: `/api/admin/apps/${created.id}`,
      headers: { cookie },
      payload: { ...base, name: 'Shifti 2' },
    });
    expect(again.json().app.widget_color).toBe('#ffd400');
  });

  it('refuses a value that is not #rrggbb', async () => {
    for (const widget_color of ['red', '#fff', '#12345g', 'url(x)']) {
      const res = await env.app.inject({
        method: 'POST',
        url: '/api/admin/apps',
        headers: { cookie },
        payload: { ...base, widget_color },
      });
      expect(res.statusCode, widget_color).toBe(400);
    }
  });
});

describe('GET /api/widget/config', () => {
  const get = (app: string, origin?: string) =>
    env.app.inject({
      method: 'GET',
      url: `/api/widget/config?app=${app}`,
      headers: origin ? { origin } : {},
    });

  it("gives the app's color to an allowed origin, with CORS and cache headers", async () => {
    const app = makeApp(env.db, { allowed_origins: [TEST_ORIGIN], widget_color: '#7c3aed' });
    const res = await get(app.slug, TEST_ORIGIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ color: '#7c3aed' });
    expect(res.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers.vary).toContain('Origin');
  });

  it('gives the default color, same 200, to another site or for an unknown app', async () => {
    const app = makeApp(env.db, { allowed_origins: [TEST_ORIGIN], widget_color: '#7c3aed' });
    for (const res of [await get(app.slug, 'https://evil.example'), await get(app.slug), await get('nope', TEST_ORIGIN)]) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ color: '#318f9b' });
    }
    expect((await get(app.slug, 'https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('needs no admin session', async () => {
    const app = makeApp(env.db, { allowed_origins: [TEST_ORIGIN] });
    expect((await get(app.slug, TEST_ORIGIN)).statusCode).toBe(200);
  });
});
