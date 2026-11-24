import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReportById, updateReport } from '../src/server/repositories/reports.js';
import { addReport, loginCookie, makeApp, makeTestApp, type TestEnv } from './helpers.js';

const SCREENSHOT = '11111111-1111-4111-8111-111111111111.png';
const ATTACHMENT = '22222222-2222-4222-8222-222222222222.csv';
const GITLAB_ISSUE_URL = 'https://gitlab.test/groupe/projet/-/issues/7';

interface FetchCall {
  url: string;
  init: RequestInit;
}

let env: TestEnv;
let cookie: string;
let calls: FetchCall[];
let fetchMock: ReturnType<typeof vi.fn>;

/** Default stub: GitLab and GitHub both succeed. */
function stubFetch(handler?: (call: FetchCall) => Response | undefined) {
  calls = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const custom = handler?.(call);
    if (custom) return custom;
    if (call.url.endsWith('/uploads')) {
      const name = ((init.body as FormData).get('file') as File).name;
      return Response.json({ markdown: `![${name}](/uploads/abc/${name})` }, { status: 201 });
    }
    if (call.url.includes('api.github.com')) {
      return Response.json({ number: 15, html_url: 'https://github.com/o/r/issues/15' }, { status: 201 });
    }
    return Response.json({ iid: 7, web_url: GITLAB_ISSUE_URL }, { status: 201 });
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
  env = await makeTestApp({
    gitlab: { url: 'https://gitlab.test', token: 'glpat-secret' },
    github: { apiUrl: 'https://api.github.com', token: 'ghp-secret' },
  });
  cookie = await loginCookie(env.app);
  writeFileSync(join(env.storageDir, SCREENSHOT), Buffer.from('png-bytes'));
  writeFileSync(join(env.storageDir, ATTACHMENT), Buffer.from('a;b\n1;2\n'));
  stubFetch();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await env.close();
});

const createIssue = (id: number, payload: object = { title: 'Mon titre', labels: ['bug', 'fixi'] }) =>
  env.app.inject({ method: 'POST', url: `/api/admin/reports/${id}/issue`, headers: { cookie }, payload });

function gitlabApp(extra: Partial<Parameters<typeof makeApp>[1]> = {}) {
  return makeApp(env.db, { issue_provider: 'gitlab', issue_project: 'groupe/projet', ...extra });
}

function fullReport(app: ReturnType<typeof makeApp>) {
  return addReport(env.db, app, {
    comment: 'La roue tourne',
    user_info: 'j.dupont',
    user_email: 'j.dupont@domaine.fr',
    screenshot_path: SCREENSHOT,
    attachment_path: ATTACHMENT,
    attachment_original_name: 'releve.csv',
    attachment_mime: 'text/csv',
    timeline: [
      {
        t: Date.now(),
        type: 'net',
        method: 'POST',
        url: '/api/shifts/save',
        status: 500,
        durationMs: 10,
        requestBody: '{"secret_payload":1}',
        responseBody: 'RESPONSE-BODY-SQL',
      },
    ],
    has_http_error: true,
    max_http_status: 500,
  });
}

const issueCalls = () => calls.filter((c) => c.url.endsWith('/issues'));
const uploadCalls = () => calls.filter((c) => c.url.endsWith('/uploads'));

describe('GitLab', () => {
  it('uploads the files, puts their Markdown in the description and links the issue', async () => {
    const app = gitlabApp();
    const id = fullReport(app);
    const child = addReport(env.db, app, { user_info: 'autre', user_email: 'autre@x.fr' });
    updateReport(env.db, child, { parent_id: id, status: 'duplicate' });

    const res = await createIssue(id);
    expect(res.statusCode).toBe(200);

    expect(uploadCalls()).toHaveLength(2);
    // "groupe/projet" is URL-encoded in the API path
    expect(uploadCalls()[0].url).toBe('https://gitlab.test/api/v4/projects/groupe%2Fprojet/uploads');
    expect((uploadCalls()[0].init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-secret');

    const issue = issueCalls()[0];
    expect(issue.url).toBe('https://gitlab.test/api/v4/projects/groupe%2Fprojet/issues');
    const body = JSON.parse(issue.init.body as string);
    expect(body.title).toBe('Mon titre');
    expect(body.labels).toBe('bug,fixi');
    expect(body.description).toContain(`![capture-${id}.png](/uploads/abc/capture-${id}.png)`);
    expect(body.description).toContain('![releve.csv](/uploads/abc/releve.csv)');
    expect(body.description).toContain('Signalé par 2 utilisateurs');
    expect(body.description).toContain(`http://fixi.test/admin/reports/${id}`);

    expect(getReportById(env.db, id)).toMatchObject({
      issue_provider: 'gitlab',
      issue_number: 7,
      issue_url: GITLAB_ISSUE_URL,
      status: 'sent',
    });
    expect(getReportById(env.db, child)!.status).toBe('duplicate');
  });

  it('supports a numeric project id', async () => {
    const id = fullReport(gitlabApp({ issue_project: '42' }));
    await createIssue(id);
    expect(issueCalls()[0].url).toBe('https://gitlab.test/api/v4/projects/42/issues');
  });

  it('refuses a second creation (anti-duplicate lock) without calling GitLab again', async () => {
    const id = fullReport(gitlabApp());
    expect((await createIssue(id)).statusCode).toBe(200);
    const callsAfterFirst = calls.length;
    const second = await createIssue(id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('issue_already_linked');
    expect(calls).toHaveLength(callsAfterFirst);
  });

  it('refuses a ticket that already has a manual link', async () => {
    const id = fullReport(gitlabApp());
    updateReport(env.db, id, { issue_url: 'https://x.test/1' });
    expect((await createIssue(id)).statusCode).toBe(409);
  });

  it('refuses to create an issue from a duplicate', async () => {
    const app = gitlabApp();
    const parent = addReport(env.db, app);
    const child = addReport(env.db, app);
    updateReport(env.db, child, { parent_id: parent, status: 'duplicate' });
    const res = await createIssue(child);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('report_is_duplicate');
  });

  it('answers 400 when the application has no tracker', async () => {
    const id = addReport(env.db, makeApp(env.db));
    const res = await createIssue(id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_issue_tracker');
  });

  it('answers 400 with a clear message when the token is missing', async () => {
    await env.close();
    env = await makeTestApp({ gitlab: { url: 'https://gitlab.test' } });
    cookie = await loginCookie(env.app);
    const id = addReport(env.db, gitlabApp());
    const res = await createIssue(id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('tracker_not_configured');
    expect(res.json().message).toContain('GITLAB_TOKEN');
    expect(calls).toHaveLength(0);
  });

  it('answers 502 with the tracker message and leaves the database untouched', async () => {
    stubFetch((call) =>
      call.url.endsWith('/issues') ? Response.json({ message: '403 Forbidden' }, { status: 403 }) : undefined,
    );
    const id = fullReport(gitlabApp());
    const res = await createIssue(id);
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('403 Forbidden');
    expect(getReportById(env.db, id)).toMatchObject({ status: 'new', issue_url: null, issue_provider: null, issue_number: null });
  });

  it('answers 502 when an upload fails, and creates no issue', async () => {
    stubFetch((call) => (call.url.endsWith('/uploads') ? new Response('nope', { status: 500 }) : undefined));
    const id = fullReport(gitlabApp());
    const res = await createIssue(id);
    expect(res.statusCode).toBe(502);
    expect(issueCalls()).toHaveLength(0);
    expect(getReportById(env.db, id)!.issue_url).toBeNull();
  });

  it('answers 502 when GitLab is unreachable', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });
    const id = fullReport(gitlabApp());
    const res = await createIssue(id);
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('injoignable');
    expect(getReportById(env.db, id)!.status).toBe('new');
  });

  it('neutralizes @mentions of the user comment', async () => {
    const id = addReport(env.db, gitlabApp(), { comment: 'Merci @all et @jean', user_info: '@boss' });
    await createIssue(id);
    const { description } = JSON.parse(issueCalls()[0].init.body as string);
    expect(description).not.toMatch(/@(?!​)/);
    expect(description).toContain('@​all');
    expect(description).toContain('@​jean');
  });

});

describe('GitHub', () => {
  function githubApp(extra: Partial<Parameters<typeof makeApp>[1]> = {}) {
    return makeApp(env.db, { issue_provider: 'github', issue_project: 'owner/repo', ...extra });
  }

  it('creates the issue without any upload and links to the Fixi ticket', async () => {
    const id = fullReport(githubApp());
    const res = await createIssue(id);
    expect(res.statusCode).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/owner/repo/issues');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp-secret');
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['User-Agent']).toBe('Fixi');

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.labels).toEqual(['bug', 'fixi']);
    expect(body.body).toContain(`Capture et pièce jointe disponibles dans Fixi : http://fixi.test/admin/reports/${id}`);

    expect(getReportById(env.db, id)).toMatchObject({
      issue_provider: 'github',
      issue_number: 15,
      issue_url: 'https://github.com/o/r/issues/15',
      status: 'sent',
    });
  });

  it('rejects a project that is not owner/repo', async () => {
    const id = addReport(env.db, githubApp({ issue_project: '../etc/passwd' }));
    const res = await createIssue(id);
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('anonymization', () => {
  it('GitLab: no e-mail, no user, no payload, no response body and no file sent', async () => {
    const id = fullReport(gitlabApp({ issue_anonymize: true }));
    await createIssue(id);

    expect(uploadCalls()).toHaveLength(0);
    const { description } = JSON.parse(issueCalls()[0].init.body as string);
    expect(description).not.toContain('j.dupont');
    expect(description).not.toContain('@domaine.fr');
    expect(description).not.toContain('secret_payload');
    expect(description).not.toContain('RESPONSE-BODY-SQL');
    expect(description).toContain('La roue tourne');
    expect(description).toContain(`http://fixi.test/admin/reports/${id}`);
  });

  it('GitHub: same guarantees', async () => {
    const id = fullReport(makeApp(env.db, { issue_provider: 'github', issue_project: 'o/r', issue_anonymize: true }));
    await createIssue(id);
    const { body } = JSON.parse(calls[0].init.body as string);
    expect(body).not.toContain('@domaine.fr');
    expect(body).not.toContain('secret_payload');
  });
});

describe('detail exposes the issue form', () => {
  it('pre-fills the title and labels, and hides the button once the issue is linked', async () => {
    const app = gitlabApp({ issue_default_labels: 'bug, fixi' });
    const id = addReport(env.db, app, { category: 'blocking', comment: 'La roue tourne' });
    let detail = (await env.app.inject({ method: 'GET', url: `/api/admin/reports/${id}`, headers: { cookie } })).json();
    expect(detail.issue_form).toMatchObject({
      can_create: true,
      title: `[Fixi][Bloquant] Shifti #${id} — La roue tourne`,
      labels: ['bug', 'fixi'],
    });

    // the confirmation modal is hidden by x-cloak and uses no inline style (CSP)
    const before = await env.app.inject({ method: 'GET', url: `/admin/reports/${id}`, headers: { cookie } });
    expect(before.body).toMatch(/class="modal"[^>]*x-cloak/);
    expect(before.body).not.toMatch(/\sstyle\s*=/i);
    expect(before.body).toContain('Créer le ticket GitLab');

    await createIssue(id);
    detail = (await env.app.inject({ method: 'GET', url: `/api/admin/reports/${id}`, headers: { cookie } })).json();
    const page =await env.app.inject({ method: 'GET', url: `/admin/reports/${id}`, headers: { cookie } });
    expect(page.body).not.toContain('Créer le ticket GitLab');
    expect(detail.issue.url).toBe(GITLAB_ISSUE_URL);
  });

  it('explains why the button is missing', async () => {
    const id = addReport(env.db, makeApp(env.db));
    const page = await env.app.inject({ method: 'GET', url: `/admin/reports/${id}`, headers: { cookie } });
    expect(page.body).toContain('Aucun outil de tickets n&#39;est configuré');
  });
});
