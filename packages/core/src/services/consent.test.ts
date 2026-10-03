import { describe, expect, it } from 'vitest';

import { createConsentState } from './consent';
import type { ServiceLogEntry } from './storage/ports';
import { settle } from './test-support/memory-kv';

describe('[EX-018] technicalAndInteraction consent, revoked anywhere (§9.6)', () => {
  function fakePort(initial: boolean | 'throws') {
    const listeners = new Set<(granted: boolean) => void>();
    let answer: boolean | 'throws' = initial;
    let resolveCheck: (() => void) | null = null;
    let hold = false;
    return {
      port: {
        async granted() {
          if (hold) await new Promise<void>((resolve) => (resolveCheck = resolve));
          if (answer === 'throws') throw new Error('permissions API failed');
          return answer;
        },
        onChange(listener: (granted: boolean) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      set(next: boolean | 'throws') {
        answer = next;
      },
      emit(next: boolean) {
        for (const listener of [...listeners]) listener(next);
      },
      holdNextCheck() {
        hold = true;
      },
      releaseCheck() {
        hold = false;
        resolveCheck?.();
      },
      listeners: () => listeners.size,
    };
  }

  it('fails closed until checked; a revoke anywhere stops at once and tells the listeners', async () => {
    const browser = fakePort(true);
    const logs: ServiceLogEntry[] = [];
    const consent = createConsentState({ port: browser.port, log: (entry) => logs.push(entry) });
    expect(consent.granted()).toBe(false);
    const heard: boolean[] = [];
    consent.onChange((granted) => heard.push(granted));
    consent.onChange(() => {
      throw new Error('listener bug');
    });
    expect(await consent.start()).toBe(true);
    expect(consent.start()).toBe(consent.start());
    browser.emit(false);
    expect(consent.granted()).toBe(false);
    browser.emit(false);
    browser.emit(true);
    expect(heard).toEqual([true, false, true]);
    expect(logs.map((entry) => entry.msg)).toEqual(['technical data consent granted', 'technical data consent revoked', 'technical data consent granted']);
    consent.dispose();
    expect(browser.listeners()).toBe(0);
  });

  it('a failing check is "not granted"; an event during a check wins over the check', async () => {
    const browser = fakePort('throws');
    const consent = createConsentState({ port: browser.port });
    expect(await consent.start()).toBe(false);
    browser.set(true);
    browser.holdNextCheck();
    const check = consent.refresh();
    await settle();
    browser.emit(false);
    browser.releaseCheck();
    expect(await check).toBe(false);
    expect(consent.granted()).toBe(false);
    expect(await consent.refresh()).toBe(true);
  });
});
