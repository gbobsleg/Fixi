import type { FastifyInstance } from 'fastify';
import { isAdminPath, pathOf } from './auth.js';

// 'unsafe-eval' is required because the standard Alpine build evaluates its expressions with new Function().
// No inline script or inline style is allowed: everything comes from /public/*.
export const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Security headers for the admin pages and API only.
 * Deliberately NOT global (no @fastify/helmet): its default `Cross-Origin-Resource-Policy: same-origin`
 * would prevent Shifti and Flowi from loading /widget.js, and POST /api/reports must stay untouched.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (!isAdminPath(pathOf(req))) return payload;
    // A route may already have set a stricter policy (e.g. the file download route): keep it.
    if (!reply.hasHeader('content-security-policy')) reply.header('Content-Security-Policy', ADMIN_CSP);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });
}
