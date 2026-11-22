// Fake host application used to try the widget by hand (and by the E2E test).
//   npm run seed && npm run dev      (terminal 1: Fixi on :3000)
//   npm run test-host                (terminal 2: this page on :5173)
// then open http://localhost:5173

import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = resolve(HERE, '../node_modules/bootstrap/dist');

export interface TestHostOptions {
  port: number;
  /** Origin of the Fixi server, e.g. http://localhost:3000 */
  fixiUrl: string;
  appSlug: string;
  apiKey: string;
}

export async function buildTestHost(opts: TestHostOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const page = async (name: string) =>
    (await readFile(resolve(HERE, 'pages', name), 'utf8'))
      .replaceAll('__FIXI_URL__', opts.fixiUrl)
      .replaceAll('__APP__', opts.appSlug)
      .replaceAll('__API_KEY__', opts.apiKey);

  for (const [url, file] of [
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/page2.html', 'page2.html'],
  ] as const) {
    app.get(url, async (_req, reply) => reply.type('text/html; charset=utf-8').send(await page(file)));
  }

  await app.register(formbody); // the XHR button sends application/x-www-form-urlencoded
  await app.register(fastifyStatic, { root: resolve(HERE, 'public'), index: false });

  // The pushState button navigates to a URL that does not exist: serve the home page for it on reload.
  app.get('/plannings/*', async (_req, reply) => reply.type('text/html; charset=utf-8').send(await page('index.html')));
  app.get('/vendor/bootstrap.min.css', async (_req, reply) =>
    reply.type('text/css').send(await readFile(resolve(BOOTSTRAP, 'css/bootstrap.min.css'))),
  );
  app.get('/vendor/bootstrap.bundle.min.js', async (_req, reply) =>
    reply.type('text/javascript').send(await readFile(resolve(BOOTSTRAP, 'js/bootstrap.bundle.min.js'))),
  );

  // ---- fake API used to provoke breadcrumbs
  app.get('/api/ok', async () => ({ ok: true }));
  app.get('/api/slow', async () => {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true };
  });
  app.all('/api/fail500', async (_req, reply) =>
    reply
      .code(500)
      .header('X-Request-Id', 'req_98ab')
      .send({ error: "Integrity constraint violation: Column 'shift_type_id' cannot be null" }),
  );
  app.all('/api/fail422', async (_req, reply) => reply.code(422).send({ errors: { date: ['La date est invalide'] } }));

  return app;
}

// Started directly (not imported by a test)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixiUrl = process.env.FIXI_URL ?? 'http://localhost:3000';
  let apiKey = process.env.TEST_HOST_API_KEY;

  if (!apiKey) {
    // Read the dev key of the `shifti` app straight from the local database.
    const { openDatabase } = await import('../src/server/db/index.js');
    const { getAppBySlug } = await import('../src/server/repositories/apps.js');
    const db = openDatabase(process.env.DATABASE_PATH ?? './data/fixi.db');
    apiKey = getAppBySlug(db, 'shifti')?.api_key;
    db.close();
  }
  if (!apiKey) {
    console.error("Application 'shifti' introuvable : lancez d'abord `npm run seed`.");
    process.exit(1);
  }

  const app = await buildTestHost({ port: 5173, fixiUrl, appSlug: 'shifti', apiKey });
  await app.listen({ port: 5173, host: '127.0.0.1' });
  console.log(`Page de test : http://localhost:5173   (widget servi par ${fixiUrl})`);
}
