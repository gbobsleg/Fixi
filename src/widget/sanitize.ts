// Pure functions that strip sensitive data BEFORE anything is stored or sent.

import { LIMITS } from '../shared/types.js';

// Matched anywhere in a key: `access_token`, `x-csrf-token`, `clientSecret`...
const SENSITIVE_KEY = /password|passwd|pwd|token|secret|auth|authorization|cookie|csrf|api_key|apikey/i;
// Matched only as a whole word of the key, because they are too short to be searched inside other words:
// `pin`, `supervisor_pin`, `newPin`, `pinCode`, `pin-code` match; `spinner`, `opinion`, `shipping` do not.
const SENSITIVE_WORDS = new Set(['pin']);
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 12;

type ExtraKeys = ReadonlySet<string>;
const NO_KEYS: ExtraKeys = new Set();

// Extra keys declared by the host application (`data-redact-keys`). The source is read again at every
// redaction, i.e. every time an event is recorded, before it reaches sessionStorage.
let extraKeysSource: () => readonly string[] = () => [];

/** Plugs in the host's extra keys. They are compared to the WHOLE key, ignoring case, never as substrings. */
export function setExtraRedactKeys(source: () => readonly string[]): void {
  extraKeysSource = source;
}

function currentExtraKeys(): ExtraKeys {
  try {
    const keys = extraKeysSource();
    return keys.length ? new Set(keys.map((k) => k.toLowerCase())) : NO_KEYS;
  } catch {
    return NO_KEYS;
  }
}

/** Splits a key into lowercase words: `supervisorPIN_code` -> ['supervisor', 'pin', 'code']. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function isSensitiveKey(key: string, extra: ExtraKeys = currentExtraKeys()): boolean {
  if (SENSITIVE_KEY.test(key)) return true;
  if (keyWords(key).some((word) => SENSITIVE_WORDS.has(word))) return true;
  return extra.has(key.toLowerCase());
}

function redactWith(value: unknown, depth: number, extra: ExtraKeys): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.map((v) => redactWith(v, depth + 1, extra));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key, extra) ? REDACTED : redactWith(v, depth + 1, extra);
  }
  return out;
}

/** Recursively replaces the value of every sensitive key by "[REDACTED]". Never mutates the input. */
export function redact(value: unknown, depth = 0): unknown {
  return redactWith(value, depth, currentExtraKeys());
}

// Fallback patterns for free text.
// 1. Header-like values may contain spaces ("Authorization: Bearer abc"): mask up to the end of the value.
const INLINE_HEADER = /((?:authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)([^\r\n"',}&]+)/gi;
// 2. Any other `key=value`, `key: value` or `"key": "value"` pair: the WHOLE key goes through
//    isSensitiveKey, exactly like a JSON key. A match starts at the beginning of a word, so `spinner=3`
//    is read as the key `spinner`, never as `pin`.
const INLINE_PAIR = /(["']?)([A-Za-z_][\w.-]*)\1(\s*[:=]\s*["']?)([^"'&\s,}]+)/g;

function redactPairs(text: string, extra: ExtraKeys): string {
  const re = new RegExp(INLINE_PAIR.source, 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const head = m[0].length - m[4].length; // quote + key + quote + separator
    if (isSensitiveKey(m[2], extra)) {
      out += text.slice(last, m.index + head) + REDACTED;
      last = m.index + m[0].length;
    } else {
      // Harmless key: scan its value again, it may hold a pair itself (`failed: password=hunter2`).
      re.lastIndex = m.index + head;
    }
  }
  return out + text.slice(last);
}

export function redactText(text: string): string {
  return redactPairs(text.replace(INLINE_HEADER, `$1${REDACTED}`), currentExtraKeys());
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[unserializable]';
  }
}

/**
 * Cleans a text body (request payload or response): JSON and form-encoded bodies are parsed and
 * redacted key by key, anything else goes through the inline pattern fallback.
 * Truncation happens AFTER parsing so that a long JSON body is still redacted correctly.
 */
export function sanitizeText(text: string, max: number = LIMITS.bodyExcerptChars): string {
  const trimmed = text.length > 200_000 ? text.slice(0, 200_000) : text;
  const start = trimmed.trimStart()[0];
  if (start === '{' || start === '[') {
    try {
      return clip(JSON.stringify(redact(JSON.parse(trimmed))), max);
    } catch {
      /* truncated or invalid JSON: fall through to the text fallback */
    }
  }
  if (/^[^=&\s]+=[^\s]*$/.test(trimmed.trim()) && !trimmed.includes('\n')) {
    try {
      const params = new URLSearchParams(trimmed.trim());
      return clip(safeJson(redact(Object.fromEntries(params.entries()))), max);
    } catch {
      /* ignore */
    }
  }
  return clip(redactText(trimmed), max);
}

/** Cleans any value that can be passed as a fetch / XHR body. Returns undefined when there is none. */
export function sanitizeBody(body: unknown, max: number = LIMITS.bodyExcerptChars): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body === '' ? undefined : sanitizeText(body, max);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const obj: Record<string, unknown> = {};
    body.forEach((value, key) => {
      obj[key] = typeof value === 'string' ? value : `[File ${(value as File).name}]`;
    });
    return clip(safeJson(redact(obj)), max);
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return clip(safeJson(redact(Object.fromEntries(body.entries()))), max);
  }
  if (
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return '[binary]';
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[stream]';
  if (typeof Document !== 'undefined' && body instanceof Document) return '[document]';
  if (typeof body === 'object') return clip(safeJson(redact(body)), max);
  return clip(String(body), max);
}

/**
 * Masks the value of sensitive query parameters (`?token=...`, plus the host's extra keys) in a URL.
 * By default same-origin URLs are reduced to path + query + hash (compact breadcrumbs), other URLs are
 * kept whole. With `keepOrigin` the full URL is always returned (used for the report's page URL).
 */
export function sanitizeUrl(raw: string, max = 300, keepOrigin = false): string {
  try {
    const url = new URL(raw, location.href);
    const extra = currentExtraKeys();
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key, extra)) url.searchParams.set(key, REDACTED);
    }
    const sameOrigin = url.origin === location.origin && !keepOrigin;
    const text = sameOrigin ? url.pathname + url.search + url.hash : url.href;
    return clip(decodeURIComponent(text), max);
  } catch {
    return clip(redactText(raw), max);
  }
}
