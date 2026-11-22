import type { JsErrorEvent } from '../../shared/types.js';
import { guard } from '../native.js';
import { clip, redact, redactText, sanitizeUrl } from '../sanitize.js';
import type { TimelineStore } from './store.js';

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(redact(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function shortStack(error: unknown): string | undefined {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return undefined;
  return clip(stack.split('\n').slice(0, 5).join('\n'), 1000);
}

/** Records uncaught errors, unhandled promise rejections and console.error calls. */
export function installErrors(store: TimelineStore): void {
  const record = (event: Omit<JsErrorEvent, 't' | 'type'>) =>
    store.push({ t: Date.now(), type: 'js_error', ...event, message: clip(redactText(event.message), 300) });

  window.addEventListener(
    'error',
    guard((e: ErrorEvent) => {
      // Resource errors (img, script 404) do not bubble to window: only runtime errors arrive here.
      const message = e.error ? describe(e.error) : e.message.replace(/^Uncaught /, '');
      record({
        source: 'error',
        message,
        file: e.filename ? sanitizeUrl(e.filename) : undefined,
        line: e.lineno || undefined,
        col: e.colno || undefined,
        stack: shortStack(e.error),
      });
    }),
  );

  window.addEventListener(
    'unhandledrejection',
    guard((e: PromiseRejectionEvent) => {
      record({ source: 'unhandledrejection', message: describe(e.reason), stack: shortStack(e.reason) });
    }),
  );

  // console.error: guarded against re-entrance, so an error logged while recording can never loop.
  const original = console.error;
  let inFixi = false;
  console.error = function (this: Console, ...args: unknown[]) {
    if (!inFixi) {
      inFixi = true;
      try {
        record({
          source: 'console',
          message: args.map(describe).join(' '),
          stack: shortStack(args.find((a) => a instanceof Error)),
        });
      } catch {
        /* never let Fixi break logging */
      } finally {
        inFixi = false;
      }
    }
    return original.apply(this, args as []);
  };
}
