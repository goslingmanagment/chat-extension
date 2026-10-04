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
        async check() {
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

  it('a failed check while granted gates sending but is not a revoke: listeners hear nothing, the queue is kept', async () => {
    const browser = fakePort(true);
    const logs: ServiceLogEntry[] = [];
    const consent = createConsentState({ port: browser.port, log: (entry) => logs.push(entry) });
    const heard: boolean[] = [];
    consent.onChange((granted) => heard.push(granted));
    expect(consent.status()).toBe('unknown');
    expect(await consent.start()).toBe(true);
    expect(consent.status()).toBe('granted');
    browser.set('throws');
    expect(await consent.refresh()).toBe(false);
    expect(consent.granted()).toBe(false);
    expect(consent.status()).toBe('unknown');
    expect(heard).toEqual([true]);
    expect(logs.at(-1)).toMatchObject({ level: 'warn', msg: 'technical data consent check failed: not sending until known' });
    // The browser answers again: sending resumes without a second "granted".
    browser.set(true);
    expect(await consent.refresh()).toBe(true);
    expect(heard).toEqual([true]);
    // A check that succeeds with "no" is a revoke.
    browser.set(false);
    expect(await consent.refresh()).toBe(false);
    expect(consent.status()).toBe('denied');
    expect(heard).toEqual([true, false]);
  });

  it('a port answering null (the platform\'s failed check) is unknown, not denied', async () => {
    const listeners = new Set<(granted: boolean) => void>();
    let answer: boolean | null = true;
    const consent = createConsentState({
      port: {
        check: () => Promise.resolve(answer),
        onChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    const heard: boolean[] = [];
    consent.onChange((granted) => heard.push(granted));
    await consent.start();
    answer = null;
    expect(await consent.refresh()).toBe(false);
    expect(consent.status()).toBe('unknown');
    expect(heard).toEqual([true]);
  });
});
