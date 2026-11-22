import { fileURLToPath } from 'node:url';

// From src/server/paths.ts (dev) and dist/server/paths.js (build), `../../` is the project root.
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
