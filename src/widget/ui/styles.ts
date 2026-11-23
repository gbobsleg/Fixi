// CSS of the whole widget. It lives inside a Shadow DOM, so it can neither leak into the host
// page nor be altered by the host's stylesheets.
// Palette shared with Shifti and Flowi. The accent (--fx-*) is set per application in Fixi's settings
// and applied on the host element by theme.ts; the values below are only the default (teal).
export const STYLES = /* css */ `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000;
  --fx-accent: #318f9b; --fx-accent-hover: #27727c; --fx-accent-soft: #eaf4f5;
  --fx-accent-ring: rgba(49, 143, 155, 0.35); --fx-on-accent: #ffffff; --fx-accent-text: #27727c;
  --fx-text: #1f2a30; --fx-muted: #6b7a82; --fx-border: #d5dde0; --fx-line: #e2e8ea; --fx-bg: #f4f6f7;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.4;
  color: var(--fx-text); }
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- tab (right edge, vertically centered) ---------- */
.tab { position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 8px; padding: 14px 9px;
  writing-mode: vertical-rl; text-orientation: mixed;
  background: var(--fx-accent); color: var(--fx-on-accent); border: 0; border-radius: 8px 0 0 8px;
  box-shadow: -2px 2px 8px rgba(0,0,0,.2); opacity: .6; transition: opacity .15s, padding .15s;
  font-weight: 600; letter-spacing: .02em; }
.tab:hover, .tab:focus-visible { opacity: 1; padding-right: 12px; }
.tab:focus-visible { outline: 3px solid var(--fx-accent-ring); outline-offset: 2px; }
.tab svg { transform: rotate(90deg); flex: none; }

/* ---------- loading indicator ---------- */
.loading { position: fixed; right: 16px; top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--fx-text); color: #fff;
  border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---------- modal ---------- */
.backdrop { position: fixed; inset: 0; background: rgba(31,42,48,.55); display: flex;
  align-items: center; justify-content: center; padding: 16px; }
.modal { width: 100%; max-width: 520px; max-height: calc(100vh - 32px); overflow: auto; background: #fff;
  border: 1px solid var(--fx-line); border-radius: 10px; box-shadow: 0 20px 50px rgba(0,0,0,.25);
  display: flex; flex-direction: column; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 12px;
  border-bottom: 1px solid var(--fx-line); }
.modal-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
.icon-btn { background: transparent; border: 0; padding: 6px; border-radius: 6px; color: var(--fx-muted); display: inline-flex; }
.icon-btn:hover { background: var(--fx-bg); color: var(--fx-text); }
.modal-body { padding: 14px 18px 6px; display: flex; flex-direction: column; gap: 14px; }
.modal-foot { padding: 12px 18px 16px; display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }

.pills { display: flex; gap: 8px; border: 0; padding: 0; margin: 0; }
.pill { position: relative; }
.pill input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
.pill span { display: inline-block; padding: 5px 14px; border: 1px solid var(--fx-border); border-radius: 999px;
  background: #fff; color: var(--fx-text); font-weight: 600; }
.pill input:checked + span { background: var(--fx-accent-soft); border-color: var(--fx-accent); color: var(--fx-accent-text); }
.pill.blocking input:checked + span { background: #fdecea; border-color: #b42318; color: #8a1c13; }
.pill input:focus-visible + span { outline: 3px solid var(--fx-accent-ring); outline-offset: 1px; }

textarea { width: 100%; min-height: 96px; resize: vertical; padding: 8px 12px; font: inherit; color: inherit;
  border: 1px solid var(--fx-border); border-radius: 6px; }
textarea:focus { outline: 0; border-color: var(--fx-accent); box-shadow: 0 0 0 3px var(--fx-accent-ring); }

.check { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.check input { width: 16px; height: 16px; margin: 0; accent-color: var(--fx-accent); }
.shot { display: flex; align-items: center; gap: 12px; }
.shot-thumb { position: relative; flex: none; border: 1px solid var(--fx-border); border-radius: 6px; overflow: hidden;
  padding: 0; background: var(--fx-bg); cursor: zoom-in; line-height: 0; }
.shot-thumb img { width: 150px; height: 90px; object-fit: cover; object-position: top left; display: block; }
.shot-thumb:hover { border-color: var(--fx-accent); }
.shot.disabled .shot-thumb { opacity: .4; }
.note { color: var(--fx-muted); font-size: 12.5px; margin: 0; }

.attach-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--fx-bg);
  border: 1px dashed #a9b6bc; border-radius: 6px; color: var(--fx-muted); text-align: left; width: 100%; }
.attach-btn:hover { border-color: var(--fx-accent); color: var(--fx-accent-text); background: var(--fx-accent-soft); }
.attached { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--fx-border);
  border-radius: 6px; }
.attached img { width: 44px; height: 44px; object-fit: cover; border-radius: 4px; flex: none; }
.attached .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attached .size { color: var(--fx-muted); font-size: 12px; }

.btn { padding: 7px 16px; border-radius: 6px; border: 1px solid var(--fx-border); background: #fff; color: var(--fx-text); font-weight: 600; }
.btn:hover { background: var(--fx-bg); }
.btn.primary { background: var(--fx-accent); border-color: var(--fx-accent); color: var(--fx-on-accent); }
.btn.primary:hover { background: var(--fx-accent-hover); border-color: var(--fx-accent-hover); }
.btn:disabled { opacity: .6; cursor: default; }
.btn:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--fx-accent-ring); }

.error { margin: 0; padding: 8px 12px; border-radius: 6px; background: #fff; color: #8a1c13;
  border: 1px solid var(--fx-line); border-left: 3px solid #b42318; }
.success { padding: 26px 18px 30px; text-align: center; font-size: 16px; font-weight: 600; color: var(--fx-text); }
.success svg { display: block; margin: 0 auto 10px; color: var(--fx-accent); }

/* ---------- annotation overlay ---------- */
.annot { position: fixed; inset: 0; background: rgba(31,42,48,.92); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; padding: 16px; }
.annot-stage { position: relative; line-height: 0; max-width: 100%; max-height: calc(100vh - 90px);
  box-shadow: 0 10px 40px rgba(0,0,0,.5); background: #fff; }
.annot-stage img { display: block; max-width: calc(100vw - 32px); max-height: calc(100vh - 90px); user-select: none; -webkit-user-drag: none; }
.annot-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.annot-bar { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center; }
.annot-bar .hint { color: #cfd8dc; font-size: 13px; }

@media print { :host { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } .tab { transition: none; } }
`;
