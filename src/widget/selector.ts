const MAX_CLASSES = 2;
const MAX_CLASS_LENGTH = 30;

/** Rejects generated class names (css-1a2b3c, sc-bdVaJa, jsx-123456, long hashes...). */
function isStableClass(name: string): boolean {
  if (name.length > MAX_CLASS_LENGTH) return false;
  if (/^(css|sc|jsx|styled|emotion)-/i.test(name)) return false;
  if (/\d{4,}/.test(name)) return false;
  if (/[0-9a-f]{8,}/i.test(name)) return false;
  return true;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Builds a readable selector like `button#btn-save-shift.btn-primary` or `select[name="agent_id"]`.
 * It never reads a `value`, so nothing typed by the user can leak into it.
 */
export function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let out = tag;

  const id = el.getAttribute('id');
  if (id && id.length <= 50) out += `#${id.replace(/\s+/g, '')}`;

  const classes = Array.from(el.classList).filter(isStableClass).slice(0, MAX_CLASSES);
  for (const c of classes) out += `.${c}`;

  const name = el.getAttribute('name');
  if (name) out += `[name="${cssEscape(name.slice(0, 40))}"]`;

  return out;
}
