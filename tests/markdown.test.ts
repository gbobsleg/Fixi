import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/server/db/index.js';
import { getAppBySlug } from '../src/server/repositories/apps.js';
import { getReportById, updateReport } from '../src/server/repositories/reports.js';
import { buildReportMarkdown } from '../src/server/services/markdown.js';
import { describeUserAgent } from '../src/server/services/user-agent.js';
import type { TimelineEvent } from '../src/shared/types.js';
import { addReport, makeApp } from './helpers.js';

const REPORT_TIME = Date.parse('2026-11-20T13:32:10Z'); // 14:32:10 in Europe/Paris

const timeline: TimelineEvent[] = [
  { t: REPORT_TIME - 18400, type: 'nav', url: '/plannings/edit/42?week=47&token=abc', kind: 'load' },
  { t: REPORT_TIME - 5200, type: 'click', selector: 'button#btn-save-shift.btn-primary', text: 'Valider le planning' },
  {
    t: REPORT_TIME - 4800,
    type: 'net',
    method: 'POST',
    url: '/api/shifts/save?agent=12',
    status: 500,
    durationMs: 412,
    requestId: 'req_98ab',
    requestBody: '{"agent_id": 12, "shift_type_id": null}',
    responseBody: '{"error": "Column ```shift_type_id``` cannot be null"}',
  },
  {
    t: REPORT_TIME - 4700,
    type: 'js_error',
    source: 'error',
    message: 'TypeError: Cannot read properties of undefined',
    file: 'planning-editor.js',
    line: 142,
    col: 18,
  },
];

let db: DB;
beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => db.close());

function build(anonymize: boolean, childCount = 0) {
  const app = getAppBySlug(db, 'shifti') ?? makeApp(db);
  const id = addReport(db, app, {
    category: 'blocking',
    comment: "Quand je clique sur valider, rien ne s'enregistre.",
    user_info: 'j.dupont (superviseur)',
    user_email: 'j.dupont@domaine.fr',
    app_version: 'a3f9c12',
    user_agent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    client_created_at: new Date(REPORT_TIME).toISOString(),
    timeline,
  });
  updateReport(db, id, { admin_notes: 'NOTE-PRIVEE-A-NE-JAMAIS-DIFFUSER' });
  const children = [];
  for (let i = 0; i < childCount; i++) {
    const cid = addReport(db, app, { user_info: `autre${i}`, user_email: `autre${i}@x.fr` });
    updateReport(db, cid, { parent_id: id, status: 'duplicate' });
    children.push(getReportById(db, cid)!);
  }
  return buildReportMarkdown(getReportById(db, id)!, children, {
    app,
    anonymize,
    fixiLink: 'http://fixi.test/admin/reports/1',
    timezone: 'Europe/Paris',
  });
}

describe('buildReportMarkdown', () => {
  it('produces the expected report (snapshot)', () => {
    expect(build(false, 2)).toMatchInlineSnapshot(`
      "# [Fixi] Bug Report - Shifti (#1) [Bloquant]
      **Symptôme utilisateur :** "Quand je clique sur valider, rien ne s'enregistre."
      *(Signalé par 3 utilisateurs)*

      ## Contexte
      - **App :** shifti | **Version (Git) :** \`a3f9c12\`
      - **Catégorie :** Bloquant
      - **URL :** https://shifti.interne/plannings/edit/42
      - **Utilisateur :** j.dupont (superviseur) — j.dupont@domaine.fr
      - **Viewport :** 1920x1080 | **UA :** Edge 130 / Windows 10/11
      - **Date :** 2026-11-20 14:32:10
      - **Fiche Fixi :** http://fixi.test/admin/reports/1

      ## Chronologie (dernières actions avant signalement)
      - \`[-18.4s]\` **[NAV]** Chargement \`/plannings/edit/42?week=47&token=abc\`
      - \`[-5.2s]\` **[CLICK]** \`button#btn-save-shift.btn-primary\` ("Valider le planning")
      - \`[-4.8s]\` **[NET]** \`POST /api/shifts/save?agent=12\` -> **500 Internal Server Error** (412ms) \`[X-Request-Id: req_98ab]\`
        - Payload:
          \`\`\`
          {"agent_id": 12, "shift_type_id": null}
          \`\`\`
        - Response:
          \`\`\`\`
          {"error": "Column \`\`\`shift_type_id\`\`\` cannot be null"}
          \`\`\`\`
      - \`[-4.7s]\` **[JS_ERROR]** \`TypeError: Cannot read properties of undefined\` at \`planning-editor.js:142:18\`
      - \`[0.0s]\` **[REPORT]** Signalement déclenché
      "
    `);
  });

  it('never contains the private admin notes', () => {
    expect(build(false)).not.toContain('NOTE-PRIVEE');
    expect(build(true)).not.toContain('NOTE-PRIVEE');
  });

  it('does not mention duplicates when there are none', () => {
    expect(build(false)).not.toContain('Signalé par');
  });

  it('anonymizes: no e-mail, no user, no payload, no response body, no query string', () => {
    const md = build(true);
    expect(md).not.toContain('j.dupont');
    expect(md).not.toContain('@');
    expect(md).not.toContain('agent_id');
    expect(md).not.toContain('cannot be null');
    expect(md).not.toContain('token=abc');
    expect(md).not.toContain('week=47');
    expect(md).not.toContain('Valider le planning');
    // what is kept
    expect(md).toContain('**Symptôme utilisateur :**');
    expect(md).toContain('**[NET]** `POST /api/shifts/save` -> **500 Internal Server Error**');
    expect(md).toContain('http://fixi.test/admin/reports/1');
  });
});

describe('describeUserAgent', () => {
  it('recognizes common browsers', () => {
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'),
    ).toBe('Firefox 127 / Linux');
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBe(
      'Safari 17 / macOS',
    );
  });

  it('falls back to the raw user agent', () => {
    expect(describeUserAgent('curl/8.0')).toBe('curl/8.0');
  });
});
