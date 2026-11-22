import {
  describeFailure,
  trackerFetch,
  TrackerConfigError,
  TrackerError,
  type CreateIssueInput,
  type IssueTracker,
} from './index.js';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** GitHub has no upload API for issues: files are ignored (the body links to the Fixi ticket instead). */
export class GithubTracker implements IssueTracker {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  async createIssue(input: CreateIssueInput): Promise<{ number: number; url: string }> {
    if (!REPO_PATTERN.test(input.project)) {
      throw new TrackerConfigError('Le projet GitHub doit être au format « owner/repo ».');
    }
    const res = await trackerFetch('GitHub', `${this.apiUrl}/repos/${input.project}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Fixi',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
    });
    if (!res.ok) {
      throw new TrackerError(`GitHub a refusé la création de l'issue : ${await describeFailure(res)}`);
    }
    const issue = (await res.json()) as { number?: number; html_url?: string };
    if (typeof issue.number !== 'number' || !issue.html_url) {
      throw new TrackerError('Réponse GitHub inattendue (number ou html_url manquant).');
    }
    return { number: issue.number, url: issue.html_url };
  }
}
