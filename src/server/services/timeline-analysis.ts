import type { TimelineEvent } from '../../shared/types.js';

export interface TimelineAnalysis {
  hasHttpError: boolean;
  /** Highest HTTP status >= 400 found in the timeline, null if none. */
  maxHttpStatus: number | null;
  hasJsError: boolean;
}

/** Computes the anomaly flags stored on the report at insertion time. */
export function analyzeTimeline(events: TimelineEvent[]): TimelineAnalysis {
  let maxHttpStatus: number | null = null;
  let hasJsError = false;
  for (const e of events) {
    if (e.type === 'net' && e.status >= 400) {
      maxHttpStatus = Math.max(maxHttpStatus ?? 0, e.status);
    } else if (e.type === 'js_error') {
      hasJsError = true;
    }
  }
  return { hasHttpError: maxHttpStatus !== null, maxHttpStatus, hasJsError };
}
