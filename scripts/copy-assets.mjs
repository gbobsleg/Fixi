// Copies the non-TypeScript files needed at runtime into dist/ (SQL migrations).
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/server/db', { recursive: true });
cpSync('src/server/db/migrations', 'dist/server/db/migrations', { recursive: true });
console.log('assets copied');
