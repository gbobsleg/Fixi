import { LIMITS, type NetEvent } from '../../shared/types.js';
import { debug, guard } from '../native.js';
import { clip, sanitizeBody, sanitizeText, sanitizeUrl } from '../sanitize.js';
import type { TimelineStore } from './store.js';

const TEXTUAL = /json|text|html|xml|javascript|x-www-form-urlencoded/i;
const WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Light interception of fetch and XMLHttpRequest. Every request is recorded (method, URL, status,
 * duration). For status >= 400 the first 500 characters of the response and of the sent payload are
 * kept, after redaction. The wrapped functions behave exactly like the originals.
 */
export function installNetwork(store: TimelineStore, apiBase: string): void {
  const isFixiUrl = (url: string) => {
    try {
      return new URL(url, location.href).href.startsWith(`${apiBase}/api/reports`);
    } catch {
      return false;
    }
  };

  const record = (base: Omit<NetEvent, 'type'>): NetEvent => store.push({ type: 'net', ...base });

  // ---------------------------------------------------------------- fetch
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const promise = originalFetch.call(this, input, init);
      try {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const rawUrl = isRequest ? input.url : String(input);
        if (isFixiUrl(rawUrl)) return promise;
        const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
        const sentBody = init?.body;
        const start = performance.now();

        promise.then(
          guard((res: Response) => {
            const event = record({
              t: Date.now(),
              method,
              url: sanitizeUrl(rawUrl),
              status: res.status,
              durationMs: Math.round(performance.now() - start),
              requestId: clip(res.headers.get('x-request-id') ?? '', 100) || undefined,
            });
            if (res.status < 400) return;
            if (WITH_BODY.has(method)) event.requestBody = sanitizeBody(sentBody);
            const type = res.headers.get('content-type') ?? '';
            if (TEXTUAL.test(type) || type === '') {
              // Read a copy, asynchronously: the host app's own reading is never delayed or blocked.
              res
                .clone()
                .text()
                .then(
                  guard((text: string) => {
                    event.responseBody = sanitizeText(text, LIMITS.bodyExcerptChars);
                    store.persist();
                  }),
                  () => undefined,
                );
            }
            store.persist();
          }),
          guard((err: unknown) => {
            if ((err as { name?: string })?.name === 'AbortError') return; // cancelled by the app: not a failure
            record({
              t: Date.now(),
              method,
              url: sanitizeUrl(rawUrl),
              status: 0,
              durationMs: Math.round(performance.now() - start),
              responseBody: clip(String((err as Error)?.message ?? err), 200),
            });
          }),
        );
      } catch (err) {
        debug(err);
      }
      return promise;
    };
  }

  // ------------------------------------------------------------------ XHR
  if (typeof XMLHttpRequest === 'undefined') return;
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    try {
      meta.set(this, { method: String(args[0]).toUpperCase(), url: String(args[1]) });
    } catch (err) {
      debug(err);
    }
    return (originalOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const info = meta.get(this);
      if (info && !isFixiUrl(info.url)) {
        const start = performance.now();
        let aborted = false;
        this.addEventListener('abort', () => (aborted = true));
        this.addEventListener(
          'loadend',
          guard(() => {
            if (aborted) return;
            const status = this.status;
            const event = record({
              t: Date.now(),
              method: info.method,
              url: sanitizeUrl(info.url),
              status,
              durationMs: Math.round(performance.now() - start),
              requestId: clip(this.getResponseHeader('X-Request-Id') ?? '', 100) || undefined,
            });
            if (status < 400 && status !== 0) return;
            if (status >= 400) {
              if (WITH_BODY.has(info.method)) event.requestBody = sanitizeBody(body);
              // Only text-like responses: blob / arraybuffer / document responses are ignored.
              if (this.responseType === '' || this.responseType === 'text') {
                event.responseBody = sanitizeText(this.responseText ?? '', LIMITS.bodyExcerptChars);
              } else if (this.responseType === 'json' && this.response !== null) {
                event.responseBody = sanitizeBody(this.response);
              }
            }
            store.persist();
          }),
        );
      }
    } catch (err) {
      debug(err);
    }
    return originalSend.call(this, body);
  };
}
