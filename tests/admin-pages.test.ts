import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addReport, loginCookie, makeApp, makeTestApp, type TestEnv } from './helpers.js';

let env: TestEnv;
let cookie: string;

beforeEach(async () => {
  env = await makeTestApp();
  cookie = await loginCookie(env.app);
});
afterEach(async () => {
  await env.close();
});

const page = (url: string, withSession = true) =>
  env.app.inject({ method: 'GET', url, headers: withSession ? { cookie } : {} });

describe('admin pages', () => {
  it.each(['/admin', '/admin/settings', '/admin/reports/1'])('%s redirects to the login without a session', async (url) => {
    const res = await page(url, false);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('serves the login page without a session', async () => {
    const res = await page('/admin/login', false);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Se connecter');
  });

  it('redirects /admin/login to /admin when already logged in', async () => {
    const res = await page('/admin/login');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin');
  });

  it('escapes user content: a <script> comment is rendered as text', async () => {
    const app = makeApp(env.db);
    const payload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const id = addReport(env.db, app, {
      comment: payload,
      user_info: '<b>evil</b>',
      timeline: [
        { t: Date.now(), type: 'net', method: 'GET', url: '/x', status: 500, durationMs: 5, responseBody: payload },
        { t: Date.now(), type: 'js_error', source: 'error', message: payload },
      ],
    });
    for (const url of ['/admin', `/admin/reports/${id}`]) {
      const res = await page(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('<script>alert');
      expect(res.body).not.toContain('<img src=x');
      expect(res.body).not.toContain('<b>evil</b>');
      expect(res.body).toContain('&lt;script&gt;alert');
    }
  });

  it('renders the list with badges', async () => {
    const app = makeApp(env.db);
    addReport(env.db, app, { category: 'blocking', has_http_error: true, max_http_status: 503, has_js_error: true });
    const res = await page('/admin');
    expect(res.body).toContain('Bloquant');
    expect(res.body).toContain('HTTP 5xx');
    expect(res.body).toContain('JS Error');
  });

  it('shows a 404 page for an unknown report', async () => {
    const res = await page('/admin/reports/999');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('n&#39;existe pas'); // Eta escapes the apostrophe
  });

  it('shows the issue button and the notify panel states on the detail page', async () => {
    const id = addReport(env.db, makeApp(env.db, { issue_provider: 'gitlab', issue_project: '42' }));
    const res = await page(`/admin/reports/${id}`);
    // GitLab is not configured in the test environment: the reason is shown instead of the button
    expect(res.body).toContain('GITLAB_URL ou GITLAB_TOKEN manque');
    expect(res.body).toContain('Disponible quand le statut');
    expect(res.body).not.toContain('bientôt');
  });

  it('renders the settings page', async () => {
    const res = await page('/admin/settings');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('settingsPage');
  });
});

describe('static assets', () => {
  it('serves alpine.min.js without any build step', async () => {
    const res = await page('/public/vendor/alpine.min.js', false);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body.length).toBeGreaterThan(10_000);
  });

  it('serves admin.css and admin.js', async () => {
    const css = await page('/public/admin/admin.css', false);
    const js = await page('/public/admin/admin.js', false);
    expect(css.statusCode).toBe(200);
    expect(js.statusCode).toBe(200);
  });
});

describe('CSP compatibility of the templates', () => {
  it('has no inline style attribute, inline script or inline event handler in the admin pages', async () => {
    const app = makeApp(env.db);
    const id = addReport(env.db, app, { screenshot_path: '11111111-1111-4111-8111-111111111111.png' });
    const pages = ['/admin/login', '/admin', `/admin/reports/${id}`, '/admin/settings'];
    for (const url of pages) {
      const body = (await page(url)).body;
      expect(body, url).not.toMatch(/\sstyle\s*=/i);
      expect(body, url).not.toMatch(/\son[a-z]+\s*=/i);
      // every <script> must have a src
      for (const tag of body.match(/<script\b[^>]*>/gi) ?? []) expect(tag, url).toMatch(/\bsrc=/);
    }
  });

  it('keeps every modal behind x-cloak, defined in admin.css', async () => {
    const css = readFileSync(new URL('../src/server/public/admin/admin.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\[x-cloak\]\s*\{\s*display:\s*none\s*!important/);
    const id = addReport(env.db, makeApp(env.db), { screenshot_path: '11111111-1111-4111-8111-111111111111.png' });
    const body = (await page(`/admin/reports/${id}`)).body;
    expect(body).toMatch(/class="lightbox"[^>]*x-cloak/);
  });
});

describe('security headers scope', () => {
  it('applies the CSP and framing protection to admin pages and the admin API', async () => {
    for (const url of ['/admin', '/api/admin/me']) {
      const res = await page(url);
      expect(res.headers['content-security-policy'], url).toContain("script-src 'self' 'unsafe-eval'");
      expect(res.headers['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(res.headers['x-frame-options'], url).toBe('DENY');
      expect(res.headers['referrer-policy'], url).toBe('same-origin');
    }
  });

  it('does not override the stricter policy of file downloads', async () => {
    const res = await page('/api/admin/files/nope.png');
    expect(res.statusCode).toBe(404);
  });

  it('never touches GET /widget.js', async () => {
    const res = await page('/widget.js', false);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).not.toBe('same-origin');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('never touches the public reports endpoint', async () => {
    const res = await env.app.inject({ method: 'OPTIONS', url: '/api/reports', headers: { origin: 'http://localhost:5173' } });
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).not.toBe('same-origin');
  });
});
