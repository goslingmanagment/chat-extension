// The background's toast as this tab shows it (tab/toast-events.ts).

import type { BackgroundToast } from '@cg/contracts/tab-messages';
import { BackgroundToastSchema } from '@cg/contracts/tab-messages';
import { describe, expect, it } from 'vitest';

import { toastOfTab, type ToastFacts } from './toast-events';

const HERE = { host: 'chatspace' as const, hostAccountId: '910101', platformFanId: '74001001' };
const THERE = { ...HERE, platformFanId: '74001002' };

const ready = (chat: typeof HERE, over: Partial<BackgroundToast> = {}): BackgroundToast =>
  BackgroundToastSchema.parse({ toastId: '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b01', kind: 'success', scope: 'op.ready', opId: '6b0f2c1e-7a35-4b55-9d0e-2f1c5a7e9b02', feature: 'reply', chat, fanLabel: null, ...over });

const facts = (over: Partial<ToastFacts> = {}): ToastFacts => ({ showing: () => HERE, visible: () => true, fanName: () => null, ...over });

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

  it('a toast with no chat passes as it is', () => {
    const { chat: _none, ...bare } = ready(HERE);
    expect(toastOfTab(bare, facts())).toBe(bare);
  });
});
