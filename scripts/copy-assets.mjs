// Copies the non-TypeScript files needed at runtime into dist/ (SQL migrations, admin views and assets).
// alpine.min.js is not copied: it is served from node_modules (a production dependency).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/server/db', { recursive: true });
cpSync('src/server/db/migrations', 'dist/server/db/migrations', { recursive: true });
cpSync('src/server/views', 'dist/server/views', { recursive: true });
cpSync('src/server/public', 'dist/server/public', { recursive: true });
console.log('assets copied');
