import type { Category, ReportPayload } from '../shared/types.js';
import type { WidgetConfig } from './config.js';
import { nativeFetch } from './native.js';
import { sanitizeUrl } from './sanitize.js';
import type { TimelineStore } from './breadcrumbs/store.js';

export interface SubmitInput {
  category: Category;
  comment: string;
  screenshot: Blob | null;
  attachment: { blob: Blob; name: string } | null;
}

export class SubmitError extends Error {}

const REQUEST_TIMEOUT_MS = 30_000;

/** Human-readable (French) message for a failed response. */
function messageFor(status: number, code: string | undefined): string {
  if (code === 'comment_required') return 'Merci de décrire le problème.';
  if (code === 'invalid_file') return "Le fichier joint n'est pas accepté (images, PDF, CSV, Excel ou texte).";
  if (status === 401) return 'Fixi est mal configuré sur cette application (clé API invalide).';
  if (status === 403) return "Cette application n'est pas autorisée à envoyer des signalements.";
  if (status === 413) return 'Un fichier est trop volumineux (5 Mo maximum).';
  if (status === 429) return 'Trop de signalements envoyés. Réessayez dans une minute.';
  if (status >= 500) return 'Le serveur Fixi a rencontré une erreur. Réessayez dans un instant.';
  return `Le signalement a été refusé (code ${status}).`;
}

/** Sends the report as multipart/form-data. Throws a SubmitError with a displayable message. */
export async function submitReport(
  config: WidgetConfig,
  store: TimelineStore,
  input: SubmitInput,
): Promise<{ id: number }> {
  if (!nativeFetch) throw new SubmitError("Ce navigateur n'est pas pris en charge.");

  const payload: ReportPayload = {
    app: config.app,
    apiKey: config.apiKey,
    user: config.user,
    userEmail: config.userEmail,
    version: config.version,
    category: input.category,
    comment: input.comment.trim(),
    url: sanitizeUrl(location.href, 2000, true), // full URL, with sensitive query values masked
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: navigator.userAgent,
    clientCreatedAt: new Date().toISOString(),
    timeline: store.read(),
  };

  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  if (input.screenshot) form.append('screenshot', input.screenshot, 'capture.png');
  if (input.attachment) form.append('attachment', input.attachment.blob, input.attachment.name);

  let response: Response;
  try {
    response = await nativeFetch(`${config.apiBase}/api/reports`, {
      method: 'POST',
      body: form,
      credentials: 'omit',
      mode: 'cors',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    });
  } catch {
    throw new SubmitError('Impossible de joindre le serveur Fixi. Vérifiez votre connexion et réessayez.');
  }

  if (!response.ok) {
    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: string }).error;
    } catch {
      /* body is not JSON */
    }
    throw new SubmitError(messageFor(response.status, code));
  }
  try {
    return (await response.json()) as { id: number };
  } catch {
    return { id: 0 };
  }
}
