// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { redact, redactText, sanitizeBody, sanitizeText, sanitizeUrl } from '../../src/widget/sanitize.js';

describe('redact', () => {
  it('replaces the value of every sensitive key, whatever the case', () => {
    const out = redact({
      password: 'a',
      Password: 'a',
      PASSWD: 'a',
      pwd: 'a',
      access_token: 'a',
      clientSecret: 'a',
      Authorization: 'Bearer a',
      'x-auth-header': 'a',
      Cookie: 'a',
      csrfToken: 'a',
      API_KEY: 'a',
      apikey: 'a',
      agent_id: 12,
      note: 'visible',
    }) as Record<string, unknown>;

    for (const key of Object.keys(out)) {
      if (key === 'agent_id') expect(out[key]).toBe(12);
      else if (key === 'note') expect(out[key]).toBe('visible');
      else expect(out[key], key).toBe('[REDACTED]');
    }
  });

  it('works recursively through objects and arrays and does not mutate the input', () => {
    const input = { users: [{ name: 'x', password: 'p' }], deep: { a: { b: { token: 't', ok: 1 } } } };
    const copy = JSON.parse(JSON.stringify(input));
    expect(redact(input)).toEqual({
      users: [{ name: 'x', password: '[REDACTED]' }],
      deep: { a: { b: { token: '[REDACTED]', ok: 1 } } },
    });
    expect(input).toEqual(copy);
  });

  it('survives circular structures', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});

describe('sanitizeBody', () => {
  it('redacts a JSON string payload', () => {
    const out = sanitizeBody('{"agent_id":12,"password":"hunter2","nested":{"api_key":"K"}}')!;
    expect(out).toContain('"agent_id":12');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('"K"');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts a secret located AFTER the 500th character (parsing happens before truncation)', () => {
    const json = JSON.stringify({ filler: 'x'.repeat(600), password: 'late-secret' });
    const out = sanitizeBody(json)!;
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).not.toContain('late-secret');
  });

  it('redacts form-encoded strings and URLSearchParams', () => {
    expect(sanitizeBody('date=2026-11-21&csrf_token=abc123&a=1')).not.toContain('abc123');
    const params = new URLSearchParams({ login: 'bob', password: 'zzz' });
    const out = sanitizeBody(params)!;
    expect(out).toContain('bob');
    expect(out).not.toContain('zzz');
  });

  it('redacts FormData and never exposes file contents', () => {
    const form = new FormData();
    form.append('name', 'x');
    form.append('password', 'secret-pass');
    form.append('doc', new File(['hello'], 'cv.pdf'));
    const out = sanitizeBody(form)!;
    expect(out).toContain('[File cv.pdf]');
    expect(out).not.toContain('secret-pass');
    expect(out).not.toContain('hello');
  });

  it('replaces binary bodies', () => {
    expect(sanitizeBody(new Blob(['abc']))).toBe('[binary]');
    expect(sanitizeBody(new ArrayBuffer(8))).toBe('[binary]');
    expect(sanitizeBody(new Uint8Array(4))).toBe('[binary]');
  });

  it('truncates to 500 characters and handles empty bodies', () => {
    expect(sanitizeBody('z'.repeat(2000))).toHaveLength(500);
    expect(sanitizeBody(undefined)).toBeUndefined();
    expect(sanitizeBody(null)).toBeUndefined();
    expect(sanitizeBody('')).toBeUndefined();
  });
});

describe('sanitizeText / redactText (free text fallback)', () => {
  it('masks inline secrets, including a whole Authorization value', () => {
    expect(redactText('Authorization: Bearer abc123def')).not.toContain('abc123def');
    expect(redactText('login failed: password=hunter2 for bob')).not.toContain('hunter2');
    expect(redactText('{"token": "tok_live_1"} trailing')).not.toContain('tok_live_1');
    expect(redactText('Cookie: sid=zzz; other=1')).not.toContain('zzz');
  });

  it('keeps harmless text untouched', () => {
    const msg = "Integrity constraint violation: Column 'shift_type_id' cannot be null";
    expect(sanitizeText(msg)).toBe(msg);
  });

  it('handles truncated JSON responses without throwing and still redacts', () => {
    const truncated = '{"error":"x","access_token":"abcdef';
    expect(sanitizeText(truncated)).not.toContain('abcdef');
  });
});

describe('sanitizeUrl', () => {
  it('reduces same-origin URLs to path + query', () => {
    expect(sanitizeUrl(`${location.origin}/plannings/edit/42?week=47`)).toBe('/plannings/edit/42?week=47');
    expect(sanitizeUrl('/api/x?a=1#top')).toBe('/api/x?a=1#top');
  });

  it('masks sensitive query parameters', () => {
    const out = sanitizeUrl('/reset?token=abc123&user=bob&api_key=K');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('=K');
    expect(out).toContain('user=bob');
  });

  it('keeps the full URL with keepOrigin (page URL of the report) and still masks secrets', () => {
    const out = sanitizeUrl(`${location.origin}/plannings/edit/42?week=47&token=zzz`, 2000, true);
    expect(out.startsWith(`${location.origin}/plannings/edit/42?week=47`)).toBe(true);
    expect(out).not.toContain('zzz');
  });

  it('keeps cross-origin URLs whole (and redacts them too)', () => {
    const out = sanitizeUrl('https://api.example.com/v1/items?secret=zzz');
    expect(out.startsWith('https://api.example.com/v1/items')).toBe(true);
    expect(out).not.toContain('zzz');
  });
});
