// Creates the `shifti` and `flowi` applications for local development (idempotent).
import { openDatabase } from '../src/server/db/index.js';
import { createApp, getAppBySlug } from '../src/server/repositories/apps.js';

const db = openDatabase(process.env.DATABASE_PATH ?? './data/fixi.db');

const seeds = [
  { slug: 'shifti', name: 'Shifti' },
  { slug: 'flowi', name: 'Flowi' },
];

for (const { slug, name } of seeds) {
  const existing = getAppBySlug(db, slug);
  const app =
    existing ??
    createApp(db, {
      slug,
      name,
      // test-host page + WAMP (Shifti) / Docker (Flowi) on localhost
      allowed_origins: ['http://localhost:5173', 'http://localhost'],
      issue_provider: null,
      issue_project: null,
      issue_default_labels: null,
      issue_anonymize: false,
    });
  console.log(`${existing ? 'exists ' : 'created'}  ${app.slug.padEnd(8)} api_key=${app.api_key}`);
}
db.close();
