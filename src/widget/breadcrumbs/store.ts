import { LIMITS, type TimelineEvent } from '../../shared/types.js';
import { debug } from '../native.js';

export interface TimelineStore {
  /** Adds an event and returns the stored object (it may be completed later, then `persist()`). */
  push<T extends TimelineEvent>(event: T): T;
  /** Saves the current state (call after mutating an event returned by `push`). */
  persist(): void;
  /** Snapshot of the events, oldest first. */
  read(): TimelineEvent[];
}

const MAX = LIMITS.timelineMaxEvents;

/**
 * Circular buffer of the last 40 events, mirrored in sessionStorage so that it survives full page
 * reloads on multi-page apps, and disappears when the tab is closed.
 *
 * When the buffer is full, the oldest *successful* network event is dropped first: a polling request
 * must not push the user's clicks and the errors out of the timeline.
 */
export function createStore(app: string, storage: Storage | undefined = safeSessionStorage()): TimelineStore {
  const key = `fixi:tl:${app}`;
  let events: TimelineEvent[] = load();

  function load(): TimelineEvent[] {
    try {
      const raw = storage?.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as TimelineEvent[]).slice(-MAX) : [];
    } catch {
      return [];
    }
  }

  function persist(): void {
    try {
      storage?.setItem(key, JSON.stringify(events));
    } catch (err) {
      debug('sessionStorage unavailable, timeline kept in memory only', err);
    }
  }

  function evict(): void {
    while (events.length > MAX) {
      const i = events.findIndex((e) => e.type === 'net' && e.status > 0 && e.status < 400);
      events.splice(i === -1 ? 0 : i, 1);
    }
  }

  return {
    push(event) {
      events.push(event);
      evict();
      persist();
      return event;
    },
    persist,
    read: () => events.map((e) => ({ ...e })),
  };
}

function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined; // blocked by browser settings
  }
}
