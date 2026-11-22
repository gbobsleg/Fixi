import type { Config } from '../../config.js';
import type { IssueProvider } from '../../repositories/apps.js';
import { GithubTracker } from './github.js';
import { GitlabTracker } from './gitlab.js';

export interface IssueFile {
  /** Absolute path on disk. */
  path: string;
  /** Name shown on the tracker. */
  name: string;
  mime: string;
}

export interface CreateIssueInput {
  /** GitLab project id ("42") or path ("groupe/projet"); GitHub "owner/repo". */
  project: string;
  title: string;
  body: string;
  labels: string[];
  files: IssueFile[];
}

export interface IssueTracker {
  createIssue(input: CreateIssueInput): Promise<{ number: number; url: string }>;
}

/** The tracker is not usable as configured (missing token, bad project): maps to HTTP 400. */
export class TrackerConfigError extends Error {}

/** The tracker call failed (network, refusal, timeout): maps to HTTP 502. */
export class TrackerError extends Error {}

export const TRACKER_TIMEOUT_MS = 15_000;

/** True when the global configuration holds what the provider needs (URL and token). */
export function isTrackerConfigured(provider: IssueProvider, config: Config): boolean {
  return provider === 'gitlab'
    ? Boolean(config.gitlab.url && config.gitlab.token)
    : Boolean(config.github.token);
}

/** Picks the implementation for an application's provider. */
export function createTracker(provider: IssueProvider, config: Config): IssueTracker {
  if (provider === 'gitlab') {
    const { url, token } = config.gitlab;
    if (!url || !token) {
      throw new TrackerConfigError("GitLab n'est pas configuré : renseignez GITLAB_URL et GITLAB_TOKEN.");
    }
    return new GitlabTracker(url, token);
  }
  const { apiUrl, token } = config.github;
  if (!token) throw new TrackerConfigError("GitHub n'est pas configuré : renseignez GITHUB_TOKEN.");
  return new GithubTracker(apiUrl, token);
}

/** Readable message from an error response (truncated, never a whole HTML page). */
export async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { message?: unknown; error?: unknown };
      const found = json.message ?? json.error;
      detail = typeof found === 'string' ? found : JSON.stringify(found ?? json);
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  return `${res.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`;
}

/** fetch with the shared timeout; network errors and timeouts become TrackerError. */
export async function trackerFetch(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new TrackerError(
      timedOut ? `${label} : délai dépassé (${TRACKER_TIMEOUT_MS / 1000} s).` : `${label} est injoignable.`,
    );
  }
}
