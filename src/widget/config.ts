export interface WidgetConfig {
  app: string;
  apiKey: string;
  user: string;
  userEmail?: string;
  version?: string;
  /** Extra keys to redact (`data-redact-keys="query,nom"`), lowercase, compared to whole keys. */
  redactKeys: string[];
  /** Origin of the Fixi server, deduced from the `src` of the script tag. */
  apiBase: string;
}

/** Finds the <script> tag that loaded the widget. */
function findScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.hasAttribute('data-app')) return current;
  return document.querySelector<HTMLScriptElement>('script[data-app][data-api-key]');
}

/** `" query, Agent_Matricule,,"` -> `['query', 'agent_matricule']`. */
export function parseKeyList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads the `data-*` attributes of the script tag. The attributes are read again at every call, so
 * a host app can update `data-user` after load (e.g. once the session is known).
 */
export function createConfigReader(): (() => WidgetConfig) | null {
  const script = findScript();
  if (!script || !script.src) return null;
  const apiBase = new URL(script.src, location.href).origin;

  return () => {
    const attr = (name: string) => script.getAttribute(`data-${name}`)?.trim() || undefined;
    return {
      app: attr('app') ?? '',
      apiKey: attr('api-key') ?? '',
      user: attr('user') ?? '',
      userEmail: attr('user-email'),
      version: attr('version'),
      redactKeys: parseKeyList(attr('redact-keys')),
      apiBase,
    };
  };
}
