import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async (_mail?: unknown) => ({}));
  return { sendMail, createTransport: vi.fn((_options?: unknown) => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { createMailer } = await import('../src/server/services/mailer.js');
const { makeFakeMailer, makeApp, makeTestApp, multipart, reportPayload, TEST_ORIGIN } = await import('./helpers.js');
type TestEnv = Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(() => {
  sendMail.mockClear();
  createTransport.mockClear();
});

describe('createMailer', () => {
  it('without SMTP_HOST: no exception, no transport, the mail is written to the logs', async () => {
    const logger = { info: vi.fn() };
    const mailer = createMailer({ port: 587, secure: false, from: 'Fixi <f@x>' }, logger);
    await expect(mailer.sendMail({ to: 'a@x.fr', subject: 'S', text: 'T' })).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith({ mail: { to: 'a@x.fr', subject: 'S', text: 'T' } }, 'SMTP disabled');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('with SMTP_HOST: creates the transport once and sends with the configured sender', async () => {
    const mailer = createMailer(
      { host: 'smtp.test', port: 1025, secure: false, user: 'u', pass: 'p', from: 'Fixi <f@x>' },
      { info: vi.fn() },
    );
    await mailer.sendMail({ to: 'a@x.fr', subject: 'S1', text: 'T1' });
    await mailer.sendMail({ to: 'b@x.fr', subject: 'S2', text: 'T2' });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0][0]).toMatchObject({ host: 'smtp.test', port: 1025, auth: { user: 'u', pass: 'p' } });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenLastCalledWith({ from: 'Fixi <f@x>', to: 'b@x.fr', subject: 'S2', text: 'T2' });
  });

  it('with SMTP_HOST: a refusal rejects (the caller decides what to do)', async () => {
    sendMail.mockRejectedValueOnce(new Error('550 refused'));
    const mailer = createMailer({ host: 'smtp.test', port: 25, secure: false, from: 'f@x' }, { info: vi.fn() });
    await expect(mailer.sendMail({ to: 'a@x.fr', subject: 'S', text: 'T' })).rejects.toThrow('550 refused');
  });
});

describe('admin alert on a new report', () => {
  let env: TestEnv;
  let fake: ReturnType<typeof makeFakeMailer>;

  afterEach(async () => {
    await env.close();
  });

  async function post(extraPayload: Record<string, unknown> = {}) {
    const shifti = makeApp(env.db);
    const { body, contentType } = await multipart(reportPayload(shifti, extraPayload));
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { 'content-type': contentType, origin: TEST_ORIGIN },
      payload: body,
    });
    // the alert runs in the background (setImmediate)
    await new Promise((r) => setTimeout(r, 30));
    return res;
  }

  const anomalies = [
    { t: 1, type: 'net', method: 'POST', url: '/x', status: 500, durationMs: 5 },
    { t: 2, type: 'js_error', source: 'error', message: 'boom' },
  ];

  it('sends the alert with the expected subject and content', async () => {
    fake = makeFakeMailer();
    env = await makeTestApp({ adminAlertEmail: 'admin@x.fr' }, { mailer: fake.mailer });
    const res = await post({ category: 'blocking', comment: 'x'.repeat(300), timeline: anomalies });
    expect(res.statusCode).toBe(201);

    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0];
    expect(mail.to).toBe('admin@x.fr');
    expect(mail.subject).toBe(`[Fixi][Bloquant] shifti — nouveau signalement #${res.json().id}`);
    expect(mail.text).toContain('Application : Shifti');
    expect(mail.text).toContain('Catégorie : Bloquant');
    expect(mail.text).toContain('j.dupont (superviseur)');
    expect(mail.text).toContain('HTTP 5xx, JS Error');
    expect(mail.text).toContain(`http://fixi.test/admin/reports/${res.json().id}`);
    // the comment excerpt is limited to 200 characters (+ ellipsis)
    expect(mail.text).toContain(`${'x'.repeat(200)}…`);
    expect(mail.text).not.toContain('x'.repeat(201));
  });

  it('sends nothing when ADMIN_ALERT_EMAIL is not set', async () => {
    fake = makeFakeMailer();
    env = await makeTestApp({}, { mailer: fake.mailer });
    expect((await post()).statusCode).toBe(201);
    expect(fake.sent).toHaveLength(0);
  });

  it('never fails the request when the SMTP server refuses the alert', async () => {
    fake = makeFakeMailer();
    fake.failFor.add('admin@x.fr');
    env = await makeTestApp({ adminAlertEmail: 'admin@x.fr' }, { mailer: fake.mailer });
    const res = await post();
    expect(res.statusCode).toBe(201);
    expect(fake.sent).toHaveLength(0);
  });
});
