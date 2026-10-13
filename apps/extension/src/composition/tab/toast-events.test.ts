// The background's toast as this tab shows it (tab/toast-events.ts).

import type { ChatRef } from '@cg/contracts/ids';
import type { BackgroundToast } from '@cg/contracts/tab-messages';
import { BackgroundToastSchema } from '@cg/contracts/tab-messages';
import { describe, expect, it } from 'vitest';

import { toastOfTab, type ToastFacts } from './toast-events';

const HERE = { host: 'chatspace' as const, hostAccountId: '910101', platformFanId: '74001001' };
const THERE = { ...HERE, platformFanId: '74001002' };

const ready = (chat: ChatRef, over: Partial<BackgroundToast> = {}): BackgroundToast =>
  BackgroundToastSchema.parse({ toastId: '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b01', kind: 'success', scope: 'op.ready', opId: '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b02', feature: 'reply', chat, fanLabel: null, ...over });

const facts = (over: Partial<ToastFacts> = {}): ToastFacts => ({ showing: () => HERE, visible: () => true, fanName: () => null, inPreview: () => false, ...over });

describe('the background toast as the tab shows it', () => {
  it('[ER-014] «AI готово» of the chat that is open in a visible tab is not shown: its dock holds the result', () => {
    expect(toastOfTab(ready(HERE), facts())).toBeNull();
    expect(toastOfTab(ready(HERE, { kind: 'error', scope: 'op.failed', code: 'CG-HUB-REQUEST', error: { code: 'CG-HUB-REQUEST' } }), facts())).toBeNull();
  });

  it('is shown when the tab is hidden, shows another chat, or no chat at all', () => {
    expect(toastOfTab(ready(HERE), facts({ visible: () => false }))).not.toBeNull();
    expect(toastOfTab(ready(THERE), facts())).not.toBeNull();
    expect(toastOfTab(ready(HERE), facts({ showing: () => null }))).not.toBeNull();
  });

  it('[ER-014] a generation whose result stands in an open preview is not toasted over it; with the tab hidden or the preview closed it is', () => {
    const inPreview = (opId: string): boolean => opId === '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b02';
    expect(toastOfTab(ready(THERE), facts({ inPreview }))).toBeNull();
    expect(toastOfTab(ready(THERE, { kind: 'error', scope: 'op.failed', code: 'CG-HUB-REQUEST', error: { code: 'CG-HUB-REQUEST' } }), facts({ inPreview }))).toBeNull();
    expect(toastOfTab(ready(THERE), facts({ inPreview, visible: () => false }))).not.toBeNull();
    expect(toastOfTab(ready(THERE, { opId: '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b03' }), facts({ inPreview }))).not.toBeNull();
    // What is not a generation's own toast stays.
    expect(toastOfTab(ready(THERE, { scope: 'recap.profile', feature: 'recap' }), facts({ inPreview }))).not.toBeNull();
  });

  it('names the fan of another chat as the page holds the name, and keeps a name the background gave', () => {
    expect(toastOfTab(ready(THERE), facts({ fanName: (chat) => (chat.platformFanId === THERE.platformFanId ? 'Fan Birch' : null) }))?.fanLabel).toBe('Fan Birch');
    expect(toastOfTab(ready(THERE, { fanLabel: 'Given' }), facts({ fanName: () => 'Fan Birch' }))?.fanLabel).toBe('Given');
    expect(toastOfTab(ready(THERE), facts())?.fanLabel).toBeNull();
  });

  it('a toast of the open chat that is not a generation’s stays, without «Открыть чат»', () => {
    const saved = toastOfTab(ready(HERE, { scope: 'recap.profile', feature: 'recap' }), facts());
    expect(saved).not.toBeNull();
    expect(saved?.chat).toBeUndefined();
    expect(BackgroundToastSchema.safeParse(saved).success).toBe(true);
  });

  it('R20 F6a: a toast of the open chat that keeps no «Открыть чат» keeps no conversation either; a toast of another chat keeps both', () => {
    const FANSLY_HERE = { host: 'fansly-web' as const, hostAccountId: '700000000000000001', platformFanId: '700000000000000002' };
    const group = '700000000000000003';
    const saved = toastOfTab(ready(FANSLY_HERE, { scope: 'recap.profile', feature: 'recap', conversationRef: group }), facts({ showing: () => FANSLY_HERE }));
    expect(saved).not.toBeNull();
    expect([saved?.chat, saved?.conversationRef]).toEqual([undefined, undefined]);
    expect(BackgroundToastSchema.safeParse(saved).success).toBe(true);
    expect(toastOfTab(ready(FANSLY_HERE, { conversationRef: group }), facts())).toMatchObject({ chat: FANSLY_HERE, conversationRef: group });
  });

  it('a toast with no chat passes as it is', () => {
    const { chat: _none, ...bare } = ready(HERE);
    expect(toastOfTab(bare, facts())).toBe(bare);
  });
});
