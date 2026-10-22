// Styles of the voice studio (1.46.0), adopted when its chunk loads. The
// script is a draft card — the dashed terracotta edge and the warm fill of
// every AI text that has not gone anywhere, in the serif — and grows with its
// text; the presets are the kit's segment. A take is a quiet row: ▶, its
// waveform (played bars in the accent's ink), its length; the take that
// «Прикрепить» hands over is tinted. Two columns from 640 px of the dock,
// one below.

import { type StyleSource } from '../../kit';

export const VOICE_CSS = `
.cg-voice { display: grid; align-content: start; gap: 8px; padding: 8px 10px 10px 12px; }
.cg-voice__sp { flex: 1 1 0; min-width: 0; }
.cg-voice__cols { display: grid; gap: 10px 16px; min-width: 0; }
@container cg (min-width: 640px) {
  .cg-voice__cols:not(.is-single) { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); }
}

${/* ── the script ── */ ''}
.cg-voice__script { display: grid; gap: 6px; align-content: start; min-width: 0; }
.cg-voice__tones { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
.cg-voice__draft {
  display: block; box-sizing: border-box; width: 100%; min-height: 78px; max-height: 176px; margin: 0; padding: 8px 12px 9px;
  border: 1px dashed var(--cg-clay-line); border-radius: 9px; background: var(--cg-draft); color: var(--cg-ink);
  font-family: var(--cg-serif); font-size: var(--cg-text-ai); line-height: var(--cg-leading-ai);
  white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; resize: none; scrollbar-width: thin;
}
textarea.cg-voice__draft { appearance: none; }
textarea.cg-voice__draft:hover { background: var(--cg-draft-hover); }
textarea.cg-voice__draft:focus { outline: none; border-style: solid; border-color: var(--cg-clay-ink); background: var(--cg-draft-hover); box-shadow: 0 0 0 3px var(--cg-focus-soft); }
textarea.cg-voice__draft::placeholder { color: var(--cg-ink-muted); font-style: italic; opacity: 1; }
.cg-voice__under { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-height: 24px; min-width: 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); }
.cg-voice__count { font-family: var(--cg-mono); font-size: var(--cg-text-xs); letter-spacing: 0; white-space: nowrap; }
.cg-voice__count.is-over { color: var(--cg-bad-ink); font-weight: 600; }
.cg-voice__edited { font-size: var(--cg-text-xs); color: var(--cg-clay-ink); white-space: nowrap; }
.cg-voice__tagbtn[aria-pressed="true"] { color: var(--cg-clay-ink); background: var(--cg-clay-bg); }
.cg-voice__tags { display: flex; flex-wrap: wrap; gap: 4px; }
.cg-voice__tag {
  height: 24px; padding: 0 9px; border: 0; border-radius: var(--cg-r-pill); background: var(--cg-chip); box-shadow: inset 0 0 0 1px var(--cg-rule-2);
  color: var(--cg-ink-2); font: inherit; font-size: var(--cg-text-sm); line-height: 24px; white-space: nowrap; cursor: pointer;
}
.cg-voice__tag:hover { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); }
.cg-voice__tag:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
.cg-voice__issue {
  display: flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: var(--cg-r-md);
  background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-amber-ink); font-size: var(--cg-text-sm2); line-height: 18px;
}
.cg-voice__source { display: flex; gap: 5px; min-width: 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 18px; cursor: default; border-radius: 4px; }
.cg-voice__source:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 1px; }
.cg-voice__source-k { flex: none; font-weight: 600; color: var(--cg-ink-2); }
.cg-voice__source-k::after { content: ":"; }
.cg-voice__source-t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-voice__empty { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px 13px; border: 1px dashed var(--cg-rule-3); border-radius: 9px; }
.cg-voice__mic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--cg-clay-bg); color: var(--cg-clay-ink); }
.cg-voice__empty-t { display: grid; gap: 3px; min-width: 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm2); line-height: 18px; }
.cg-voice__empty-t b { color: var(--cg-ink-strong); font-size: var(--cg-text-base); font-weight: 600; }

${/* ── the takes ── */ ''}
.cg-voice__takes { display: grid; gap: 5px; align-content: start; min-width: 0; }
.cg-voice__cap { font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 24px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-ink-muted); }
.cg-voice__list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.cg-take { display: grid; gap: 3px; min-width: 0; padding: 5px 6px; border-radius: 9px; background: var(--cg-raised); box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-take.is-selected { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); }
.cg-take__row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
.cg-take__player { display: flex; align-items: center; gap: 8px; flex: 1 1 170px; min-width: 150px; }
.cg-take__play {
  flex: none; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
  background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink);
}
.cg-take.is-selected .cg-take__play { background: var(--cg-raised); }
.cg-take__play:hover, .cg-take__play.is-on { background: var(--cg-clay-ink); box-shadow: none; color: var(--cg-raised); }
.cg-take__play[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.cg-take__play:focus-visible, .cg-take__wave:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-take__wave { flex: 1 1 auto; display: flex; align-items: center; gap: 1px; height: 24px; min-width: 64px; border-radius: 3px; cursor: pointer; }
.cg-take__wave > i { flex: 1 1 0; min-width: 1px; max-width: 3px; border-radius: 1px; background: var(--cg-bar); }
.cg-take__wave > i.is-past { background: var(--cg-clay-ink); }
.cg-take__wave.is-wait { opacity: 0.6; cursor: default; }
.cg-take.is-stale .cg-take__wave > i:not(.is-past) { opacity: 0.6; }
.cg-take__time { flex: none; min-width: 30px; text-align: right; font-family: var(--cg-mono); font-size: var(--cg-text-xs); color: var(--cg-ink-muted); }
.cg-take__wait { flex: none; display: grid; place-items: center; width: 26px; height: 26px; }
.cg-take__n.is-text { padding: 0 2px; color: var(--cg-ink-2); font-size: var(--cg-text-sm); font-weight: 600; white-space: nowrap; }
.cg-take__n[aria-pressed="true"] { color: var(--cg-clay-ink); }
.cg-take__words { display: inline-flex; flex-wrap: wrap; gap: 0 8px; min-width: 0; color: var(--cg-ink-muted); font-size: var(--cg-text-sm); line-height: 18px; }
.cg-take__word { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.cg-take__word.is-good { color: var(--cg-good-ink); }
.cg-take__word.is-accent { color: var(--cg-clay-ink); font-weight: 600; }
.cg-take__word.is-warn { color: var(--cg-amber-ink); }
.cg-take__fail { color: var(--cg-ink-2); font-size: var(--cg-text-sm); line-height: 18px; }
.cg-take__err { padding: 0 2px 2px 32px; }

${/* ── the question, the handover, the footer ── */ ''}
.cg-voice__confirm {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 10px; border-radius: 9px;
  background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-ink); font-size: var(--cg-text-sm2); line-height: 18px;
}
.cg-voice__confirm-t { flex: 1 1 220px; min-width: 0; }
.cg-voice__confirm-a { display: inline-flex; gap: 4px; margin-left: auto; }
.cg-voice__foot { display: grid; gap: 6px; padding: 7px 8px 8px 12px; border-top: 1px solid var(--cg-rule); }
.cg-voice__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
.cg-voice__go:not([aria-disabled="true"]) { background: var(--cg-clay-bg); box-shadow: inset 0 0 0 1px var(--cg-clay-line); color: var(--cg-clay-ink); font-weight: 600; }
.cg-voice__go:not([aria-disabled="true"]):hover { box-shadow: inset 0 0 0 1px var(--cg-clay-ink); }
.cg-voice__attach { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--cg-ink-2); font-size: var(--cg-text-sm2); line-height: 18px; }
.cg-voice__attach.is-done { color: var(--cg-good-ink); }
.cg-voice__attach.is-done .cg-ico { flex: none; }
.cg-voice__leftover {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 4px 6px 4px 10px; border-radius: var(--cg-r-md);
  background: var(--cg-amber-bg); box-shadow: inset 0 0 0 1px var(--cg-amber-line); color: var(--cg-amber-ink); font-size: var(--cg-text-sm2); line-height: 18px;
}
.cg-voice__leftover.is-cleared { background: none; box-shadow: none; padding-left: 0; color: var(--cg-ink-2); }
.cg-voice__leftover-t { flex: 1 1 200px; min-width: 0; }
@container cg (max-width: 420px) {
  .cg-voice { padding: 6px 8px 8px 10px; }
  .cg-voice__foot { padding-left: 10px; }
  .cg-voice__restart .cg-btn__t { font-size: var(--cg-text-sm); }
}
`;

export const VOICE_STYLE: StyleSource = { id: 'cg-dock-voice', css: VOICE_CSS };
