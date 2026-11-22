import type { Category } from '../../shared/types.js';
import type { TimelineStore } from '../breadcrumbs/store.js';
import type { Capture } from '../capture.js';
import type { WidgetConfig } from '../config.js';
import { debug } from '../native.js';
import { submitReport, SubmitError } from '../submit.js';
import { openAnnotator } from './annotator.js';
import { createAttachmentControl } from './attachment.js';
import { h, icon, ICON_CLOSE } from './dom.js';

export interface ModalDeps {
  container: ShadowRoot;
  capture: Capture | null;
  getConfig: () => WidgetConfig;
  store: TimelineStore;
  onClose: () => void;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'blocking', label: 'Bloquant' },
  { value: 'suggestion', label: 'Suggestion' },
];

const ICON_CHECK_CIRCLE = ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'm8 12 3 3 5-6'];

/** The report dialog. Two clicks by default: write a short comment, send. */
export function openModal(deps: ModalDeps): void {
  const { container, capture } = deps;

  let category: Category = 'bug';
  let sending = false;
  let screenshotBlob: Blob | null = capture?.blob ?? null;
  let screenshotUrl: string | null = screenshotBlob ? URL.createObjectURL(screenshotBlob) : null;

  // ---------------------------------------------------------------- fields
  const errorBox = h('p', { class: 'error', hidden: true, attrs: { role: 'alert' } });
  const showError = (message: string | null) => {
    errorBox.textContent = message ?? '';
    errorBox.hidden = !message;
  };

  const textarea = h('textarea', {
    placeholder: "Que s'est-il passé ? Qu'essayiez-vous de faire ?",
    rows: 4,
    attrs: { 'aria-label': 'Description du problème', maxlength: '5000' },
  });

  const pills = h('fieldset', { class: 'pills' }, h('legend', { class: 'sr' }, 'Type de signalement'));
  for (const { value, label } of CATEGORIES) {
    pills.append(
      h(
        'label',
        { class: `pill ${value}` },
        h('input', {
          type: 'radio',
          name: 'fixi-category',
          value,
          checked: value === category,
          on: { change: () => (category = value) },
        }),
        h('span', {}, label),
      ),
    );
  }

  // ------------------------------------------------------------ screenshot
  const includeShot = h('input', { type: 'checkbox', checked: true });
  const thumb = h('img', { alt: 'Aperçu de la capture', src: screenshotUrl ?? '' });
  const shotRow = h(
    'div',
    { class: 'shot' },
    h(
      'button',
      {
        class: 'shot-thumb',
        type: 'button',
        attrs: { 'aria-label': 'Annoter ou agrandir la capture' },
        on: { click: () => void annotate() },
      },
      thumb,
    ),
    h(
      'div',
      {},
      h('button', { class: 'btn', type: 'button', on: { click: () => void annotate() } }, 'Annoter / Agrandir'),
      h('p', { class: 'note' }, 'Entourez la zone concernée avec le pinceau rouge.'),
    ),
  );

  // The thumbnail is dimmed when the screenshot is not going to be sent.
  includeShot.addEventListener('change', () => shotRow.classList.toggle('disabled', !includeShot.checked));

  async function annotate(): Promise<void> {
    if (!screenshotUrl) return;
    const merged = await openAnnotator(container, screenshotUrl);
    if (!merged) return;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    screenshotBlob = merged;
    screenshotUrl = URL.createObjectURL(merged);
    thumb.src = screenshotUrl;
    includeShot.checked = true;
    shotRow.classList.remove('disabled');
  }

  const shotSection = capture
    ? h('div', {}, h('label', { class: 'check' }, includeShot, 'Joindre la capture d’écran'), shotRow)
    : h('p', { class: 'note' }, "La capture d'écran n'a pas pu être générée : décrivez le problème avec vos mots.");

  const attachment = createAttachmentControl(showError);

  // ---------------------------------------------------------------- actions
  const cancelBtn = h('button', { class: 'btn', type: 'button', on: { click: () => close() } }, 'Annuler');
  const sendBtn = h('button', { class: 'btn primary', type: 'button', on: { click: () => void send() } }, 'Envoyer');

  async function send(): Promise<void> {
    if (sending) return;
    const comment = textarea.value.trim();
    const withShot = Boolean(screenshotBlob) && includeShot.checked;
    if (!comment && !withShot) {
      showError("Merci de décrire le problème (ou de joindre la capture d'écran).");
      textarea.focus();
      return;
    }

    showError(null);
    sending = true;
    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    sendBtn.textContent = 'Envoi…';
    try {
      await submitReport(deps.getConfig(), deps.store, {
        category,
        comment,
        screenshot: withShot ? screenshotBlob : null,
        attachment: attachment.get(),
      });
      showSuccess();
      setTimeout(close, 2000);
    } catch (err) {
      // The typed content is kept: the user can simply retry.
      showError(err instanceof SubmitError ? err.message : 'Une erreur inattendue est survenue. Réessayez.');
      if (!(err instanceof SubmitError)) debug(err);
      sending = false;
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
      sendBtn.textContent = 'Réessayer';
    }
  }

  // ------------------------------------------------------------------ layout
  const title = h('h2', { id: 'fixi-title' }, 'Signaler un problème');
  const modal = h(
    'div',
    { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fixi-title' } },
    h(
      'div',
      { class: 'modal-head' },
      title,
      h(
        'button',
        { class: 'icon-btn', type: 'button', attrs: { 'aria-label': 'Fermer' }, on: { click: () => close() } },
        icon(ICON_CLOSE, 20),
      ),
    ),
    h('div', { class: 'modal-body' }, pills, textarea, shotSection, attachment.el),
    h('div', { class: 'modal-foot' }, errorBox, h('div', { class: 'actions' }, cancelBtn, sendBtn)),
  );
  const backdrop = h('div', { class: 'backdrop' }, modal);

  function showSuccess(): void {
    modal.replaceChildren(
      h(
        'div',
        { class: 'success', attrs: { role: 'status' } },
        icon(ICON_CHECK_CIRCLE, 40),
        'Merci, votre signalement a bien été transmis.',
      ),
    );
  }

  // Esc closes the dialog. Keyboard events stop here: the host app's shortcuts must not fire while typing.
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sending) close();
  });

  // Ctrl+V of an image attaches it. Plain text pasting is never intercepted: if the clipboard carries
  // text (e.g. cells copied from Excel also expose an image), the text paste proceeds normally.
  const onPaste = (e: ClipboardEvent) => {
    try {
      const data = e.clipboardData;
      if (!data || data.types.includes('text/plain')) return;
      for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          showError(attachment.setFile(file));
          return;
        }
      }
    } catch (err) {
      debug(err);
    }
  };
  document.addEventListener('paste', onPaste, true);

  function close(): void {
    document.removeEventListener('paste', onPaste, true);
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    attachment.destroy();
    backdrop.remove();
    deps.onClose();
  }

  container.append(backdrop);
  requestAnimationFrame(() => textarea.focus());
}
