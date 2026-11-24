import { readFile } from 'node:fs/promises';
import {
  describeFailure,
  trackerFetch,
  TrackerError,
  type CreateIssueInput,
  type IssueTracker,
} from './index.js';

export class GitlabTracker implements IssueTracker {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async createIssue(input: CreateIssueInput): Promise<{ number: number; url: string }> {
    // encodeURIComponent supports both numeric ids ("42") and paths ("groupe/projet" -> "groupe%2Fprojet").
    const project = `${this.baseUrl}/api/v4/projects/${encodeURIComponent(input.project)}`;
    const headers = { 'PRIVATE-TOKEN': this.token };

    // 1. Upload every file; GitLab answers with the Markdown to embed in the description.
    const uploads: string[] = [];
    for (const file of input.files) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(await readFile(file.path))], { type: file.mime }), file.name);
      const res = await trackerFetch('GitLab', `${project}/uploads`, { method: 'POST', headers, body: form });
      if (!res.ok) {
        throw new TrackerError(`GitLab a refusé l'envoi de « ${file.name} » : ${await describeFailure(res)}`);
      }
      const json = (await res.json()) as { markdown?: string };
      if (json.markdown) uploads.push(json.markdown);
    }

    // 2. Create the issue.
    const description = uploads.length
      ? `${input.body}\n## Fichiers joints\n\n${uploads.join('\n\n')}\n`
      : input.body;
    const res = await trackerFetch('GitLab', `${project}/issues`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, description, labels: input.labels.join(',') }),
    });
    if (!res.ok) {
      throw new TrackerError(`GitLab a refusé la création du ticket : ${await describeFailure(res)}`);
    }
    const issue = (await res.json()) as { iid?: number; web_url?: string };
    if (typeof issue.iid !== 'number' || !issue.web_url) {
      throw new TrackerError('Réponse GitLab inattendue (iid ou web_url manquant).');
    }
    return { number: issue.iid, url: issue.web_url };
  }
}
