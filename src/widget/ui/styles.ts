// CSS of the whole widget. It lives inside a Shadow DOM, so it can neither leak into the host
// page nor be altered by the host's stylesheets.
export const STYLES = /* css */ `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.4;
  color: #111827; }
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- tab (right edge, vertically centered) ---------- */
.tab { position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 8px; padding: 14px 9px;
  writing-mode: vertical-rl; text-orientation: mixed;
  background: #4f46e5; color: #fff; border: 0; border-radius: 10px 0 0 10px;
  box-shadow: -2px 2px 10px rgba(0,0,0,.25); opacity: .55; transition: opacity .15s, padding .15s;
  font-weight: 600; letter-spacing: .02em; }
.tab:hover, .tab:focus-visible { opacity: 1; padding-right: 12px; }
.tab:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
.tab svg { transform: rotate(90deg); flex: none; }

/* ---------- loading indicator ---------- */
.loading { position: fixed; right: 16px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #111827; color: #fff;
  border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---------- modal ---------- */
.backdrop { position: fixed; inset: 0; background: rgba(17,24,39,.55); display: flex;
  align-items: center; justify-content: center; padding: 16px; }
.modal { width: 100%; max-width: 520px; max-height: calc(100vh - 32px); overflow: auto; background: #fff;
  border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.35); display: flex; flex-direction: column; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 4px; }
.modal-head h2 { margin: 0; font-size: 18px; font-weight: 700; }
.icon-btn { background: transparent; border: 0; padding: 6px; border-radius: 8px; color: #6b7280; display: inline-flex; }
.icon-btn:hover { background: #f3f4f6; color: #111827; }
.modal-body { padding: 10px 18px 6px; display: flex; flex-direction: column; gap: 14px; }
.modal-foot { padding: 12px 18px 16px; display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }

.pills { display: flex; gap: 8px; border: 0; padding: 0; margin: 0; }
.pill { position: relative; }
.pill input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.pill span { display: inline-block; padding: 6px 14px; border: 1.5px solid #d1d5db; border-radius: 999px;
  background: #fff; color: #374151; font-weight: 600; }
.pill input:checked + span { background: #eef2ff; border-color: #4f46e5; color: #3730a3; }
.pill.blocking input:checked + span { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
.pill input:focus-visible + span { outline: 3px solid #a5b4fc; outline-offset: 1px; }

textarea { width: 100%; min-height: 96px; resize: vertical; padding: 10px 12px; font: inherit; color: inherit;
  border: 1.5px solid #d1d5db; border-radius: 10px; }
textarea:focus { outline: 3px solid #c7d2fe; border-color: #4f46e5; }

.check { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.check input { width: 16px; height: 16px; margin: 0; }
.shot { display: flex; align-items: center; gap: 12px; }
.shot-thumb { position: relative; flex: none; border: 1.5px solid #d1d5db; border-radius: 8px; overflow: hidden;
  padding: 0; background: #f9fafb; cursor: zoom-in; line-height: 0; }
.shot-thumb img { width: 150px; height: 90px; object-fit: cover; object-position: top left; display: block; }
.shot-thumb:hover { border-color: #4f46e5; }
.shot.disabled .shot-thumb { opacity: .4; }
.note { color: #6b7280; font-size: 12.5px; margin: 0; }

.attach-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #f9fafb;
  border: 1.5px dashed #9ca3af; border-radius: 10px; color: #4b5563; text-align: left; width: 100%; }
.attach-btn:hover { border-color: #4f46e5; color: #3730a3; background: #eef2ff; }
.attached { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1.5px solid #d1d5db;
  border-radius: 10px; }
.attached img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; flex: none; }
.attached .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attached .size { color: #6b7280; font-size: 12px; }

.btn { padding: 9px 18px; border-radius: 10px; border: 1.5px solid #d1d5db; background: #fff; color: #111827; font-weight: 600; }
.btn:hover { background: #f3f4f6; }
.btn.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.btn.primary:hover { background: #4338ca; }
.btn:disabled { opacity: .6; cursor: default; }
.btn:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }

.error { margin: 0; padding: 8px 12px; border-radius: 8px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.success { padding: 26px 18px 30px; text-align: center; font-size: 16px; font-weight: 600; color: #065f46; }
.success svg { display: block; margin: 0 auto 10px; color: #059669; }

/* ---------- annotation overlay ---------- */
.annot { position: fixed; inset: 0; background: rgba(17,24,39,.92); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; padding: 16px; }
.annot-stage { position: relative; line-height: 0; max-width: 100%; max-height: calc(100vh - 90px);
  box-shadow: 0 10px 40px rgba(0,0,0,.5); background: #fff; }
.annot-stage img { display: block; max-width: calc(100vw - 32px); max-height: calc(100vh - 90px); user-select: none; -webkit-user-drag: none; }
.annot-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.annot-bar { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center; }
.annot-bar .hint { color: #d1d5db; font-size: 13px; }

@media print { :host { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } .tab { transition: none; } }
`;
