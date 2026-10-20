// The key policy on Fansly (audit 2026-10-20, regression 10): the old Fansly extension's ways — our combinations over
// a window of Fansly or FBuddy, AI keys in any field, a generation over the «Развернуть ↗» window, ⌘⇧H as Coach,
// ChatSpace's rows left to the page — while ChatSpace keeps every decision it had.

import { decideKey, type DispatcherCommandId, type KeyContext, type KeyDecision, type KeyVerdict } from '@cg/core/domain/hotkeys';
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
      ['⌘↵ under a site window', key('apply-fix', 'extra'), { nativeModal: true, focus: 'composer', fix: 'ready' }, 'pass', 'refuse overlay-open'],
      ['⌘E in another field of the site', key('reply'), { focus: 'field' }, 'run reply', 'refuse in-field'],
      ['⌘E over the «Развернуть ↗» window', key('reply'), { overlays: ['result-expanded'] }, 'run reply over-window', 'refuse overlay-open'],
      ['⌘⇧B over the window', key('review'), { overlays: ['result-expanded'] }, 'run review over-window', 'run review'],
      ['⌘⇧O over the window', key('tone'), { overlays: ['result-expanded'] }, 'refuse overlay-open', 'refuse overlay-open'],
      ['⌘⇧H', key('help'), {}, 'run help', 'refuse help-removed'],
      ['J outside a field', key('chat-next', 'plain'), { combo: false }, 'pass', 'run chat-next'],
      ['⌘K', key('palette', 'extra'), {}, 'pass', 'run palette'],
      ['⌘U in the message field', key('next-unread', 'extra'), { focus: 'composer' }, 'pass', 'refuse in-field'],
    ];
    for (const [what, verdict, page, fansly, chatspace] of cases) {
      expect(said(decideKey(verdict, { ...BASE, ...page, client: 'fansly' })), `Fansly: ${what}`).toBe(fansly);
      expect(said(decideKey(verdict, { ...BASE, ...page, client: 'extension' })), `ChatSpace: ${what}`).toBe(chatspace);
      expect(said(decideKey(verdict, { ...BASE, ...page })), `no client: ${what}`).toBe(chatspace);
    }
  });
});
