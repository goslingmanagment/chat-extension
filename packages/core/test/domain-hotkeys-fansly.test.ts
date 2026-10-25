// The key policy on Fansly (audit 2026-10-20, regression 10): the old Fansly extension's ways — our combinations over
// a window of Fansly or FBuddy, AI keys in any field, a generation over the «Развернуть ↗» window, ⌘⇧H as Coach,
// ChatSpace's rows left to the page — while ChatSpace keeps every decision it had.

import { decideKey, type DispatcherCommandId, type KeyContext, type KeyDecision, type KeyVerdict, type SiteKeyRules } from '@cg/core/domain/hotkeys';
import { describe, expect, it } from 'vitest';

const key = (command: DispatcherCommandId, row: 'scheme' | 'extra' | 'plain' = 'scheme'): KeyVerdict => ({
  kind: 'command',
  command,
  slot: null,
  repeat: false,
  scheme: row === 'scheme',
  plain: row === 'plain',
  fallback: false,
});

/** Fansly's rules as its adapter gives them (apps/extension/src/entrypoints/fansly.ts). */
const FANSLY: SiteKeyRules = { lenient: true, absent: ['chat-next', 'chat-previous', 'next-unread', 'quick-jump'] };

const BASE: KeyContext = { composing: false, nativeModal: false, focus: 'page', route: 'chat', overlays: [], dockSheet: false, combo: true };

/** What a decision comes to, in one word or three. */
function said(decision: KeyDecision): string {
  if (decision.act !== 'claim') return decision.act;
  if (decision.run !== null) return `run ${decision.run.id}${decision.run.overWindow === true ? ' over-window' : ''}`;
  return decision.refusal === null ? 'claim' : `refuse ${decision.refusal}`;
}

describe('the key policy on Fansly', () => {
  it('keeps the old Fansly extension’s ways there and every ChatSpace decision as it was', () => {
    const cases: readonly (readonly [string, KeyVerdict, Partial<KeyContext>, string, string])[] = [
      // what, the key, the page, Fansly, ChatSpace
      ['⌘E under a site window (a modal, FBuddy)', key('reply'), { nativeModal: true }, 'run reply', 'refuse overlay-open'],
      ['Esc under a site window', key('close', 'plain'), { nativeModal: true, dockSheet: true }, 'pass', 'pass'],
      // 2026-10-22, the old extension's rule: Esc typed in a field is the page's — it never hides the dock's sheet.
      ['Esc in the message field over the dock’s sheet', key('close', 'plain'), { focus: 'composer', dockSheet: true }, 'pass', 'pass'],
      ['Esc in another field of the site over the dock’s sheet', key('close', 'plain'), { focus: 'field', dockSheet: true }, 'pass', 'pass'],
      ['Esc on the page over the dock’s sheet', key('close', 'plain'), { dockSheet: true }, 'run close', 'run close'],
      ['Esc in the message field under a window of ours', key('close', 'plain'), { focus: 'composer', overlays: ['palette'], dockSheet: true }, 'run close', 'run close'],
      ['⌘↵ under a site window', key('apply-fix', 'extra'), { nativeModal: true, focus: 'composer', fix: 'ready' }, 'pass', 'refuse overlay-open'],
      ['⌘E in another field of the site', key('reply'), { focus: 'field' }, 'run reply', 'refuse in-field'],
      ['⌘E over the «Развернуть ↗» window', key('reply'), { overlays: ['result-expanded'] }, 'run reply over-window', 'refuse overlay-open'],
      // 1.51.0: Review is a turn of Coach — under a covering window its key waits, as Coach's own does.
      ['⌘⇧B over the window', key('review'), { overlays: ['result-expanded'] }, 'refuse overlay-open', 'refuse overlay-open'],
      ['⌘⇧B with Coach open', key('review'), { overlays: ['coach'], focus: 'ours-field' }, 'run review', 'run review'],
      ['⌘⇧O over the window', key('tone'), { overlays: ['result-expanded'] }, 'refuse overlay-open', 'refuse overlay-open'],
      ['⌘⇧H', key('help'), {}, 'run help', 'refuse help-removed'],
      ['J outside a field', key('chat-next', 'plain'), { combo: false }, 'pass', 'run chat-next'],
      // 2026-10-26: the palette is on both sites; J/K and ⌘U stay ChatSpace's alone.
      ['⌘K', key('palette', 'extra'), {}, 'run palette', 'run palette'],
      ['⌘U in the message field', key('next-unread', 'extra'), { focus: 'composer' }, 'pass', 'refuse in-field'],
    ];
    for (const [what, verdict, page, fansly, chatspace] of cases) {
      expect(said(decideKey(verdict, { ...BASE, ...page, rules: FANSLY })), `Fansly: ${what}`).toBe(fansly);
      expect(said(decideKey(verdict, { ...BASE, ...page })), `ChatSpace: ${what}`).toBe(chatspace);
    }
  });
});
