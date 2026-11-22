import { LIMITS } from '../../shared/types.js';
import { h, icon, ICON_CLOSE, ICON_PAPERCLIP } from './dom.js';

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'csv', 'xls', 'xlsx', 'txt']);
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const ACCEPT_ATTRIBUTE = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.csv,.xls,.xlsx,.txt';

export interface AttachedFile {
  blob: Blob;
  name: string;
}

export interface AttachmentControl {
  el: HTMLElement;
  get(): AttachedFile | null;
  /** Attaches a file (from the picker or from a pasted image). Returns an error message if refused. */
  setFile(file: File): string | null;
  destroy(): void;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/** Pasted images are often named just "image.png" or have no name at all. */
function normalizeName(file: File): string {
  if (extensionOf(file.name)) return file.name;
  const ext = MIME_TO_EXT[file.type] ?? 'png';
  return `${file.name || 'image-collee'}.${ext}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/** Optional manual attachment: 1 file, 5 MB max, images / PDF / CSV / Excel / text. */
export function createAttachmentControl(onError: (message: string | null) => void): AttachmentControl {
  let file: AttachedFile | null = null;
  let previewUrl: string | null = null;

  const root = h('div', {});
  const input = h('input', { type: 'file', hidden: true, accept: ACCEPT_ATTRIBUTE });
  input.addEventListener('change', () => {
    const picked = input.files?.[0];
    input.value = ''; // allows picking the same file again after removing it
    if (picked) onError(setFile(picked));
  });

  function revoke(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function render(): void {
    root.replaceChildren(input);
    if (!file) {
      root.append(
        h(
          'button',
          { class: 'attach-btn', type: 'button', on: { click: () => input.click() } },
          icon(ICON_PAPERCLIP, 16),
          h('span', {}, 'Joindre un fichier ou coller une image (Ctrl+V)'),
        ),
      );
      return;
    }
    const isImage = file.blob.type.startsWith('image/');
    previewUrl = isImage ? URL.createObjectURL(file.blob) : null;
    root.append(
      h(
        'div',
        { class: 'attached' },
        previewUrl ? h('img', { src: previewUrl, alt: '' }) : icon(ICON_PAPERCLIP, 20),
        h('span', { class: 'name', title: file.name }, file.name),
        h('span', { class: 'size' }, formatSize(file.blob.size)),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            attrs: { 'aria-label': 'Retirer la pièce jointe' },
            on: {
              click: () => {
                revoke();
                file = null;
                onError(null);
                render();
              },
            },
          },
          icon(ICON_CLOSE, 16),
        ),
      ),
    );
  }

  function setFile(candidate: File): string | null {
    const name = normalizeName(candidate);
    if (!ALLOWED_EXTENSIONS.has(extensionOf(name))) {
      return 'Type de fichier non accepté (images, PDF, CSV, Excel ou texte).';
    }
    if (candidate.size > LIMITS.maxFileBytes) return 'Fichier trop volumineux (5 Mo maximum).';
    revoke();
    file = { blob: candidate, name };
    render();
    return null;
  }

  render();
  return {
    el: root,
    get: () => file,
    setFile,
    destroy: revoke,
  };
}
