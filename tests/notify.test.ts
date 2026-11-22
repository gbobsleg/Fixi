import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getReportById, updateReport } from '../src/server/repositories/reports.js';
import { addReport, loginCookie, makeApp, makeFakeMailer, makeTestApp, type TestEnv } from './helpers.js';

let env: TestEnv;
let cookie: string;
let fake: ReturnType<typeof makeFakeMailer>;

beforeEach(async () => {
  fake = makeFakeMailer();
  env = await makeTestApp({}, { mailer: fake.mailer });
  cookie = await loginCookie(env.app);
});
afterEach(async () => {
  await env.close();
});

const notify = (id: number, payload: object = { subject: 'Votre signalement', message: 'Bonjour le {{date}}' }) =>
  env.app.inject({ method: 'POST', url: `/api/admin/reports/${id}/notify`, headers: { cookie }, payload });

/** A resolved parent (A@x.fr) with two duplicates: a@x.fr (same person, other case) and b@x.fr, plus one without e-mail. */
function group(status = 'resolved') {
  const app = makeApp(env.db);
  const parent = addReport(env.db, app, { user_email: 'A@x.fr' });
  const kids = [
    addReport(env.db, app, { user_email: 'a@x.fr' }),
    addReport(env.db, app, { user_email: 'b@x.fr' }),
    addReport(env.db, app, { user_email: null }),
  ];
  for (const k of kids) updateReport(env.db, k, { parent_id: parent, status: 'duplicate' });
  updateReport(env.db, parent, { status: status as 'resolved' });
  return { parent, kids };
}

describe('POST /api/admin/reports/:id/notify', () => {
  it('deduplicates the addresses (case-insensitive) and sends one e-mail per recipient', async () => {
    const { parent } = group();
    const res = await notify(parent);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sent: 2, failed: [] });

    expect(fake.sent.map((m) => m.to).sort()).toEqual(['a@x.fr', 'b@x.fr']);
    // each mail has a single recipient: nobody sees the others' address
    for (const mail of fake.sent) {
      expect(mail.to).not.toContain(',');
      expect(mail.text).not.toContain('@x.fr');
      expect(mail.subject).toBe('Votre signalement');
    }
  });

  it('replaces {{date}} by the date of each recipient\'s own report', async () => {
    const app = makeApp(env.db);
    const parent = addReport(env.db, app, { user_email: 'a@x.fr' });
    const child = addReport(env.db, app, { user_email: 'b@x.fr' });
    updateReport(env.db, child, { parent_id: parent, status: 'duplicate' });
    updateReport(env.db, parent, { status: 'resolved' });
    env.db.prepare('UPDATE bug_reports SET created_at = ? WHERE id = ?').run('2026-11-03T10:00:00.000Z', parent);
    env.db.prepare('UPDATE bug_reports SET created_at = ? WHERE id = ?').run('2026-11-10T10:00:00.000Z', child);

    await notify(parent);
    expect(fake.sent.find((m) => m.to === 'a@x.fr')!.text).toBe('Bonjour le 03/11/2026');
    expect(fake.sent.find((m) => m.to === 'b@x.fr')!.text).toBe('Bonjour le 10/11/2026');
  });

  it('sets last_notified_at on the parent and all its duplicates', async () => {
    const { parent, kids } = group();
    await notify(parent);
    for (const id of [parent, ...kids]) expect(getReportById(env.db, id)!.last_notified_at).not.toBeNull();
  });

  it('reports the failed addresses and still updates last_notified_at when at least one mail left', async () => {
    const { parent, kids } = group();
    fake.failFor.add('b@x.fr');
    const res = (await notify(parent)).json();
    expect(res.sent).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].email).toBe('b@x.fr');
    expect(res.failed[0].error).toContain('550');
    expect(res.last_notified_label).not.toBeNull();
    for (const id of [parent, ...kids]) expect(getReportById(env.db, id)!.last_notified_at).not.toBeNull();
  });

  it('does NOT touch last_notified_at when every e-mail failed', async () => {
    const { parent, kids } = group();
    fake.failFor.add('a@x.fr').add('b@x.fr');
    const res = (await notify(parent)).json();
    expect(res.sent).toBe(0);
    expect(res.failed.map((f: { email: string }) => f.email).sort()).toEqual(['a@x.fr', 'b@x.fr']);
    expect(res.last_notified_label).toBeNull();
    for (const id of [parent, ...kids]) expect(getReportById(env.db, id)!.last_notified_at).toBeNull();
  });

  it('refuses to notify from a duplicate', async () => {
    const { kids } = group();
    const res = await notify(kids[0]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('report_is_duplicate');
    expect(fake.sent).toHaveLength(0);
  });

  it.each(['new', 'in_progress', 'sent'])('refuses a ticket with the status "%s"', async (status) => {
    const { parent } = group(status);
    const res = await notify(parent);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('status_not_notifiable');
  });

  it('accepts the "rejected" status', async () => {
    const { parent } = group('rejected');
    expect((await notify(parent)).statusCode).toBe(200);
  });

  it('answers 400 when nobody has an e-mail address', async () => {
    const id = addReport(env.db, makeApp(env.db), { user_email: null });
    updateReport(env.db, id, { status: 'resolved' });
    const res = await notify(id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_recipients');
  });

  it('flattens line breaks of the subject (no header injection)', async () => {
    const { parent } = group();
    await notify(parent, { subject: 'Objet\r\nBcc: evil@x.fr', message: 'Salut' });
    expect(fake.sent[0].subject).toBe('Objet Bcc: evil@x.fr');
  });

  it('requires a session', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/api/admin/reports/1/notify', payload: { subject: 's', message: 'm' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('notify panel', () => {
  it('lists the deduplicated recipients and warns when already notified', async () => {
    const { parent, kids } = group();
    let page = await env.app.inject({ method: 'GET', url: `/admin/reports/${parent}`, headers: { cookie } });
    expect(page.body).toContain('<li>a@x.fr</li>');
    expect(page.body).toContain('<li>b@x.fr</li>');
    expect(page.body.match(/<li>a@x\.fr<\/li>/g)).toHaveLength(1);
    expect(page.body).toContain('data-last-notified=""');

    await notify(parent);
    page = await env.app.inject({ method: 'GET', url: `/admin/reports/${parent}`, headers: { cookie } });
    expect(page.body).not.toContain('data-last-notified=""');

    // a duplicate points to its parent instead of offering the panel
    page = await env.app.inject({ method: 'GET', url: `/admin/reports/${kids[0]}`, headers: { cookie } });
    expect(page.body).toContain(`Aller au signalement parent #${parent}`);
  });

  it('is unavailable while the ticket is not closed', async () => {
    const { parent } = group('in_progress');
    const page = await env.app.inject({ method: 'GET', url: `/admin/reports/${parent}`, headers: { cookie } });
    expect(page.body).toContain('Disponible quand le statut');
  });
});
