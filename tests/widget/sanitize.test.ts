// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { parseKeyList } from '../../src/widget/config.js';
import {
  isSensitiveKey,
  redact,
  redactText,
  sanitizeBody,
  sanitizeText,
  sanitizeUrl,
  setExtraRedactKeys,
} from '../../src/widget/sanitize.js';

describe('PIN (whole word of the key only)', () => {
  const pinKeys = ['pin', 'PIN', 'supervisor_pin', 'newPin', 'pinCode', 'pin-code', 'supervisorPIN', 'PINCode'];
  const otherKeys = ['spinner', 'opinion', 'shipping', 'pinned', 'pinyin', 'spin'];

  it('recognizes pin as a word in camelCase, snake_case and kebab-case keys', () => {
    for (const key of pinKeys) expect(isSensitiveKey(key), key).toBe(true);
    for (const key of otherKeys) expect(isSensitiveKey(key), key).toBe(false);
  });

  it('redacts PIN values in JSON bodies (e.g. a wrong PIN rejected with a 401)', () => {
    const out = sanitizeBody('{"pin":"1234","supervisor_pin":"5678","spinner":true,"opinion":"ok"}')!;
    expect(out).not.toContain('1234');
    expect(out).not.toContain('5678');
    expect(out).toContain('"spinner":true');
    expect(out).toContain('"opinion":"ok"');
  });

  it('redacts PIN query parameters and keeps look-alike ones', () => {
    const out = sanitizeUrl('/login?pin=1234&newPin=5678&shipping=fast');
    expect(out).not.toContain('1234');
    expect(out).not.toContain('5678');
    expect(out).toContain('shipping=fast');
  });

  it('redacts PIN values in free text without touching words that contain "pin"', () => {
    expect(redactText('bad pin=1234 for user')).not.toContain('1234');
    expect(redactText('refused: pin=1234')).toBe('refused: pin=[REDACTED]');
    expect(redactText('{"pinCode": "9999"}')).not.toContain('9999');
    expect(redactText('spinner=3 opinion: good shipping=fast')).toBe('spinner=3 opinion: good shipping=fast');
  });
});

describe('extra keys from data-redact-keys', () => {
  afterEach(() => setExtraRedactKeys(() => []));

  it('parses the attribute into lowercase keys', () => {
    expect(parseKeyList(' query, Agent_Matricule,, ')).toEqual(['query', 'agent_matricule']);
    expect(parseKeyList(undefined)).toEqual([]);
  });

  it('redacts URLs, bodies and free text, comparing whole keys and ignoring case', () => {
    setExtraRedactKeys(() => ['query', 'agent_matricule', 'nom', 'prenom']);
    expect(sanitizeUrl('/api/agent/suggestions?query=Dupo')).toBe('/api/agent/suggestions?query=[REDACTED]');
    expect(sanitizeUrl('/api/agent/bootstrap?Agent_Matricule=12345&nombre=3')).toBe(
      '/api/agent/bootstrap?Agent_Matricule=[REDACTED]&nombre=3',
    );

    const body = sanitizeBody({ nom: 'Dupont', prenom: 'Jean', nombre: 3, nomOffre: 'Fibre', denomination: 'x' })!;
    expect(body).not.toContain('Dupont');
    expect(body).not.toContain('Jean');
    expect(body).toContain('"nombre":3');
    expect(body).toContain('"nomOffre":"Fibre"');
    expect(body).toContain('"denomination":"x"');

    expect(redactText('agent nom: Dupont, nombre: 5')).toBe('agent nom: [REDACTED], nombre: 5');
  });

  it('reads the source again at every call (an attribute change applies to the next event)', () => {
    let keys: string[] = [];
    setExtraRedactKeys(() => keys);
    expect(sanitizeUrl('/s?query=Dupo')).toContain('Dupo');
    keys = ['query'];
    expect(sanitizeUrl('/s?query=Dupo')).not.toContain('Dupo');
  });

  it('never throws when the source fails', () => {
    setExtraRedactKeys(() => {
      throw new Error('boom');
    });
    expect(sanitizeUrl('/s?query=Dupo&token=t')).toBe('/s?query=Dupo&token=[REDACTED]');
  });
});

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
