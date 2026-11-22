import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import type { Config } from '../src/server/config.js';
import { openDatabase, type DB } from '../src/server/db/index.js';
import { createApp, type App } from '../src/server/repositories/apps.js';

export const ADMIN_PASSWORD = 'correct-horse-battery';
export const TEST_ORIGIN = 'http://localhost:5173';

/** Smallest valid PNG (1x1 pixel). */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface TestEnv {
  app: FastifyInstance;
  db: DB;
  config: Config;
  storageDir: string;
  close: () => Promise<void>;
}

export async function makeTestApp(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'fixi-test-'));
  const config: Config = {
    nodeEnv: 'test',
    port: 0,
    appBaseUrl: 'http://fixi.test',
    trustProxy: false,
    databasePath: ':memory:',
    storageDir: join(dir, 'storage'),
    retentionDays: 90,
    displayTimezone: 'Europe/Paris',
    adminUser: 'admin',
    // cost 4 keeps the tests fast
    adminPasswordHash: bcrypt.hashSync(ADMIN_PASSWORD, 4),
    sessionSecret: 'x'.repeat(40),
    gitlab: {},
    github: { apiUrl: 'https://api.github.com' },
    smtp: { port: 587, secure: false, from: 'Fixi <fixi@test>' },
    rateLimit: { loginPerMin: 5, reportsPerMin: 100 },
    ...overrides,
  };
  const db = openDatabase(':memory:');
  const app = await buildApp({ config, db });
  await app.ready();
  return {
    app,
    db,
    config,
    storageDir: config.storageDir,
    close: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Logs in as admin and returns the Cookie header value to send on later requests. */
export async function loginCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { username: 'admin', password: ADMIN_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'fixi_sid');
  if (!cookie) throw new Error('no session cookie');
  return `${cookie.name}=${cookie.value}`;
}

export function makeApp(db: DB, overrides: Partial<Parameters<typeof createApp>[1]> = {}): App {
  return createApp(db, {
    slug: 'shifti',
    name: 'Shifti',
    allowed_origins: [TEST_ORIGIN],
    issue_provider: null,
    issue_project: null,
    issue_default_labels: null,
    issue_anonymize: false,
    ...overrides,
  });
}

export interface MultipartFile {
  name: string;
  filename: string;
  content: Buffer;
  type: string;
}

/** Builds a multipart/form-data body usable with app.inject. */
export async function multipart(
  payload: unknown,
  files: MultipartFile[] = [],
): Promise<{ body: Buffer; contentType: string }> {
  const form = new FormData();
  form.append('payload', typeof payload === 'string' ? payload : JSON.stringify(payload));
  for (const f of files) {
    form.append(f.name, new Blob([new Uint8Array(f.content)], { type: f.type }), f.filename);
  }
  const response = new Response(form);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
}

export function reportPayload(app: App, extra: Record<string, unknown> = {}) {
  return {
    app: app.slug,
    apiKey: app.api_key,
    user: 'j.dupont (superviseur)',
    userEmail: 'j.dupont@domaine.fr',
    version: 'a3f9c12',
    category: 'bug',
    comment: 'La roue tourne et rien ne s\'enregistre.',
    url: 'https://shifti.interne/plannings/edit/42',
    viewport: '1920x1080',
    userAgent: 'Mozilla/5.0 Test',
    clientCreatedAt: new Date().toISOString(),
    timeline: [],
    ...extra,
  };
}
