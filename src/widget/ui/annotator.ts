import { canvasToPngBlob } from '../capture.js';
import { h } from './dom.js';

interface Point {
  x: number;
  y: number;
}

const BRUSH_COLOR = '#e60000';

/**
 * Full-size annotation overlay: the capture with a transparent <canvas> on top and one tool only,
 * a red brush. Resolves with the merged PNG (capture + drawing) when validated, or null if the user
 * cancelled or drew nothing.
 */
export function openAnnotator(container: ParentNode, imageUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const strokes: Point[][] = [];
    let current: Point[] | null = null;

    const img = h('img', { src: imageUrl, alt: 'Capture à annoter', draggable: false });
    const canvas = h('canvas', {});
    const ctx = canvas.getContext('2d');

    const undoBtn = h('button', { class: 'btn', type: 'button', on: { click: () => undo() } }, 'Annuler le dernier trait');
    const clearBtn = h('button', { class: 'btn', type: 'button', on: { click: () => clear() } }, 'Effacer');
    const cancelBtn = h('button', { class: 'btn', type: 'button', on: { click: () => finish(null) } }, 'Annuler');
    const okBtn = h('button', { class: 'btn primary', type: 'button', on: { click: () => void validate() } }, 'Valider');

    const overlay = h(
      'div',
      { class: 'annot', tabIndex: -1, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Annoter la capture' } },
      h('div', { class: 'annot-stage' }, img, canvas),
      h(
        'div',
        { class: 'annot-bar' },
        h('span', { class: 'hint' }, 'Entourez ou pointez le problème avec le pinceau rouge.'),
        undoBtn,
        clearBtn,
        cancelBtn,
        okBtn,
      ),
    );

    const lineWidth = () => Math.max(4, canvas.width / 250);

    function redraw(): void {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = BRUSH_COLOR;
      ctx.fillStyle = BRUSH_COLOR;
      ctx.lineWidth = lineWidth();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke[0].x, stroke[0].y, lineWidth() / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      undoBtn.disabled = strokes.length === 0;
      clearBtn.disabled = strokes.length === 0;
    }

    function undo(): void {
      strokes.pop();
      redraw();
    }
    function clear(): void {
      strokes.length = 0;
      redraw();
    }

    /** Pointer position converted to the canvas' own pixel grid (the image may be scaled by CSS). */
    function pointFrom(e: PointerEvent): Point {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      canvas.setPointerCapture(e.pointerId);
      current = [pointFrom(e)];
      strokes.push(current);
      redraw();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      current.push(pointFrom(e));
      redraw();
    });
    const endStroke = () => {
      current = null;
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    });

    function finish(result: Blob | null): void {
      overlay.remove();
      resolve(result);
    }

    async function validate(): Promise<void> {
      if (strokes.length === 0) return finish(null);
      okBtn.disabled = true;
      const merged = document.createElement('canvas');
      merged.width = canvas.width;
      merged.height = canvas.height;
      const mctx = merged.getContext('2d');
      if (!mctx) return finish(null);
      mctx.drawImage(img, 0, 0, merged.width, merged.height);
      mctx.drawImage(canvas, 0, 0);
      finish(await canvasToPngBlob(merged));
    }

    const init = () => {
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      redraw();
      overlay.focus();
    };
    img.addEventListener('load', init);
    img.addEventListener('error', () => finish(null));

    container.append(overlay);
    if (img.complete && img.naturalWidth) init();
  });
}
