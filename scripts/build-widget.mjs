// Bundles src/widget/index.ts (+ modern-screenshot) into one self-contained IIFE: dist/public/widget.js
// Usage: node scripts/build-widget.mjs [--watch]
import { build, context } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist/public', { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/widget/index.ts'],
  outfile: 'dist/public/widget.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[widget] watching src/widget ...');
} else {
  await build(options);
  const kb = (statSync('dist/public/widget.js').size / 1024).toFixed(1);
  console.log(`[widget] dist/public/widget.js (${kb} KB)`);
}
