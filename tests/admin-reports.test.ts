import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getReportById, updateReport } from '../src/server/repositories/reports.js';
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

const get = (url: string) => env.app.inject({ method: 'GET', url, headers: { cookie } });
const patch = (id: number, payload: unknown) =>
  env.app.inject({ method: 'PATCH', url: `/api/admin/reports/${id}`, headers: { cookie }, payload: payload as object });

describe('GET /api/admin/reports', () => {
  it('requires a session', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/api/admin/reports' });
    expect(res.statusCode).toBe(401);
  });

  it('hides duplicates by default and counts them exactly', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const c1 = addReport(env.db, app);
    const c2 = addReport(env.db, app);
    for (const c of [c1, c2]) updateReport(env.db, c, { parent_id: parent, status: 'duplicate' });

    const res = (await get('/api/admin/reports')).json();
    expect(res.total).toBe(1);
    expect(res.reports[0].id).toBe(parent);
    expect(res.reports[0].duplicates_count).toBe(2);

    const all = (await get('/api/admin/reports?include_duplicates=1')).json();
    expect(all.total).toBe(3);
    expect(all.reports.find((r: { id: number }) => r.id === c1).duplicates_count).toBe(0);
  });

  it('shows duplicates when filtering on the duplicate status', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    updateReport(env.db, child, { parent_id: parent, status: 'duplicate' });
    const res = (await get('/api/admin/reports?status=duplicate')).json();
    expect(res.reports.map((r: { id: number }) => r.id)).toEqual([child]);
  });

  it('combines filters', async () => {
    const shifti = makeApp(env.db);
    const flowi = makeApp(env.db, { slug: 'flowi', name: 'Flowi' });
    const a = addReport(env.db, shifti, { category: 'blocking', comment: 'planning cassé' });
    addReport(env.db, shifti, { category: 'bug', comment: 'planning lent' });
    addReport(env.db, flowi, { category: 'blocking', comment: 'planning cassé' });
    updateReport(env.db, a, { status: 'in_progress' });

    const res = (
      await get(`/api/admin/reports?app_id=${shifti.id}&category=blocking&status=in_progress&q=planning`)
    ).json();
    expect(res.reports.map((r: { id: number }) => r.id)).toEqual([a]);
  });

  it('searches by id and treats LIKE wildcards literally', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app, { comment: 'taux 100%' });
    addReport(env.db, app, { comment: 'taux 1000' });
    expect((await get('/api/admin/reports?q=100%25')).json().total).toBe(1);
    expect((await get(`/api/admin/reports?q=%23${a}`)).json().reports[0].id).toBe(a);
  });

  it('paginates by 50, newest first', async () => {
    const app = makeApp(env.db);
    for (let i = 0; i < 55; i++) addReport(env.db, app);
    const p1 = (await get('/api/admin/reports')).json();
    const p2 = (await get('/api/admin/reports?page=2')).json();
    expect(p1.reports).toHaveLength(50);
    expect(p2.reports).toHaveLength(5);
    expect(p1.total_pages).toBe(2);
    expect(p1.reports[0].id).toBeGreaterThan(p1.reports[1].id);
  });
});

describe('GET /api/admin/reports/:id', () => {
  it('returns the detail, the children and the markdown without the api key', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    updateReport(env.db, child, { parent_id: parent, status: 'duplicate' });
    updateReport(env.db, parent, { admin_notes: 'secret' });

    const res = (await get(`/api/admin/reports/${parent}`)).json();
    expect(res.children.map((c: { id: number }) => c.id)).toEqual([child]);
    expect(res.markdown).toContain('# [Fixi] Bug Report - Shifti');
    expect(res.markdown).not.toContain('secret');
    expect(res.app.api_key).toBeUndefined();

    const childRes = (await get(`/api/admin/reports/${child}`)).json();
    expect(childRes.parent.id).toBe(parent);
  });

  it('inherits the issue link of the parent', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    updateReport(env.db, parent, { issue_url: 'https://gitlab.interne/g/p/-/issues/7', issue_provider: 'gitlab', issue_number: 7 });
    updateReport(env.db, child, { parent_id: parent, status: 'duplicate' });
    const res = (await get(`/api/admin/reports/${child}`)).json();
    expect(res.issue).toMatchObject({ number: 7, inherited: true });
  });

  it('returns 404 for an unknown report', async () => {
    expect((await get('/api/admin/reports/999')).statusCode).toBe(404);
  });
});

describe('PATCH /api/admin/reports/:id', () => {
  it('attaches a duplicate: sets the parent and the duplicate status', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    const res = await patch(child, { parent_id: parent });
    expect(res.statusCode).toBe(200);
    expect(getReportById(env.db, child)).toMatchObject({ parent_id: parent, status: 'duplicate' });
  });

  it('refuses to attach a report to itself', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app);
    const res = await patch(a, { parent_id: a });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('parent_is_self');
  });

  it('refuses a target from another application', async () => {
    const shifti = makeApp(env.db);
    const flowi = makeApp(env.db, { slug: 'flowi', name: 'Flowi' });
    const a = addReport(env.db, shifti);
    const b = addReport(env.db, flowi);
    const res = await patch(a, { parent_id: b });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('parent_other_app');
  });

  it('refuses a target that is itself a duplicate (no chaining)', async () => {
    const app = makeApp(env.db);
    const root = addReport(env.db, app);
    const child = addReport(env.db, app);
    const other = addReport(env.db, app);
    expect((await patch(child, { parent_id: root })).statusCode).toBe(200);
    const res = await patch(other, { parent_id: child });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('parent_is_child');
  });

  it('refuses to turn a parent into a duplicate', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    const target = addReport(env.db, app);
    await patch(child, { parent_id: parent });
    const res = await patch(parent, { parent_id: target });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('report_has_children');
  });

  it('returns 404 when the target does not exist', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app);
    expect((await patch(a, { parent_id: 999 })).statusCode).toBe(404);
  });

  it('detaching puts the duplicate back to "new"', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    await patch(child, { parent_id: parent });
    const res = await patch(child, { parent_id: null });
    expect(res.statusCode).toBe(200);
    expect(getReportById(env.db, child)).toMatchObject({ parent_id: null, status: 'new' });
  });

  it('closing a parent does not change the status of its duplicates', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    await patch(child, { parent_id: parent });
    await patch(parent, { status: 'resolved' });
    expect(getReportById(env.db, child)!.status).toBe('duplicate');
  });

  it('locks the status of a duplicate and forbids "duplicate" without a parent', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    await patch(child, { parent_id: parent });
    expect((await patch(child, { status: 'resolved' })).json().error).toBe('child_status_locked');
    expect((await patch(parent, { status: 'duplicate' })).json().error).toBe('duplicate_needs_parent');
  });

  it('a manual issue URL sets the status to "sent" and clears the provider', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app);
    const url = 'https://gitlab.interne/g/p/-/issues/12';
    const res = await patch(a, { issue_url: url });
    expect(res.statusCode).toBe(200);
    expect(getReportById(env.db, a)).toMatchObject({ issue_url: url, status: 'sent', issue_provider: null });
  });

  it('refuses a non-https issue URL', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app);
    for (const bad of ['http://gitlab.interne/1', 'javascript:alert(1)', 'pas une url']) {
      expect((await patch(a, { issue_url: bad })).statusCode).toBe(400);
    }
  });

  it('refuses an issue URL on a duplicate', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    await patch(child, { parent_id: parent });
    const res = await patch(child, { issue_url: 'https://gitlab.interne/1' });
    expect(res.json().error).toBe('child_issue_locked');
  });

  it('saves admin notes and rejects an empty body', async () => {
    const app = makeApp(env.db);
    const a = addReport(env.db, app);
    expect((await patch(a, { admin_notes: 'piste : cache' })).statusCode).toBe(200);
    expect(getReportById(env.db, a)!.admin_notes).toBe('piste : cache');
    expect((await patch(a, {})).statusCode).toBe(400);
  });
});
