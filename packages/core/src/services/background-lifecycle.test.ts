// The R07 background services together over the same storage, as the
// composition root wires them (architecture.md §7 «Фон и выгрузка», §12 п. 5):
// listeners first, then the stores behind one readiness promise; the event
// page unloads and a new one restores what was stored; the browser restarts
// and storage.session is gone; a newer build wrote the settings; consent is
// revoked while the background runs.

import { account, chat, customSettings, journalEntry, opView, T0, uuid } from '@cg/contracts/fixtures';
import { STORAGE_KEYS, type SettingsState } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { createConsentState } from './consent';
import { createPresence } from './presence';
import { createReadinessBarrier } from './readiness';
import { createResultsStore } from './results-store';
import { createSendJournal } from './send-journal';
import { createSettingsOwner } from './settings-owner';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, settle, type MemoryKv } from './test-support/memory-kv';
import { manualTimers } from './test-support/timers';

function consentPort(initial: boolean) {
  const listeners = new Set<(granted: boolean) => void>();
  let granted = initial;
  return {
    port: {
      check: (): Promise<boolean | null> => Promise.resolve(granted),
      onChange(listener: (value: boolean) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    /** about:addons → «Отозвать». */
    revoke() {
      granted = false;
      for (const listener of [...listeners]) listener(false);
    },
  };
}

/** One event page: services created and listeners wired synchronously, stores started behind the barrier. */
function eventPage(local: MemoryKv, session: MemoryKv, at: number, consent = consentPort(true)) {
  const localPort = local.open();
  const sessionPort = session.open();
  const clock = manualClock(at);
  const logs: ServiceLogEntry[] = [];
  const log = (entry: ServiceLogEntry): void => {
    logs.push(entry);
  };
  const broadcasts: SettingsState[] = [];
  const settings = createSettingsOwner({ local: localPort, session: sessionPort, log, onChange: (state) => broadcasts.push(state) });
  const results = createResultsStore({ session: sessionPort, clock, log });
  const journal = createSendJournal({ local: localPort, clock, log });
  const presence = createPresence({ local: localPort, clock, log });
  const consentState = createConsentState({ port: consent.port, log });
  const telemetryQueue = { pending: 3, purged: 0 };
  consentState.onChange((granted) => {
    if (granted) return;
    telemetryQueue.purged += telemetryQueue.pending;
    telemetryQueue.pending = 0;
  });
  const barrier = createReadinessBarrier({ timers: manualTimers(), clock, log });
  /** A request handler of the RPC: answers only after the barrier. */
  const request = <T>(handler: () => Promise<T>): Promise<T> => barrier.ready.then(handler);
  const start = (): Promise<unknown> =>
    barrier.start([
      { name: 'settings', run: () => settings.start() },
      { name: 'results', run: () => results.start() },
      { name: 'sendJournal', run: () => journal.start() },
      { name: 'presence', run: () => presence.start() },
      { name: 'consent', run: () => consentState.start() },
    ]);
  const unload = (): void => {
    settings.dispose();
    journal.dispose();
    consentState.dispose();
    localPort.detach();
    sessionPort.detach();
  };
  return { settings, results, journal, presence, consent: consentState, consentPort: consent, telemetryQueue, barrier, request, start, unload, logs, broadcasts };
}

describe('[BG-004] background unload and restart (§12 п. 5)', () => {
  it('a request that woke the event page waits for the one readiness promise', async () => {
    const page = eventPage(createMemoryKv(), createMemoryKv(), T0);
    let answered = false;
    const answer = page.request(() => page.settings.state()).then((state) => {
      answered = true;
      return state;
    });
    await settle(10);
    expect(answered).toBe(false);
    await page.start();
    expect(await answer).toMatchObject({ ok: true, state: { revision: 0, readOnly: false } });
  });

  it('[X8-07] a new event page restores settings, results, the send journal and seen accounts; what was running is interrupted or uncertain, never repeated', async () => {
    const local = createMemoryKv();
    const session = createMemoryKv();
    const first = eventPage(local, session, T0);
    await first.start();
    await first.request(() => first.settings.patch({ ui: { theme: 'dark' }, sound: { volume: 35 } }, { baseRevision: 0, restricted: false }));
    await first.results.put(opView, { tabSessionId: 'tab-1' });
    const { endedAt: _endedAt, result: _result, ...running } = { ...opView, opId: uuid(77), state: 'streaming' as const, phase: { name: 'streaming' as const, since: T0 } };
    await first.results.put(running, { tabSessionId: 'tab-1' });
    expect((await first.journal.begin(journalEntry)).ok).toBe(true);
    await first.journal.advance(journalEntry.attemptId, { state: 'nativeEnqueued', pendingId: 'pending-1' });
    await first.presence.report('tab-1', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] });
    // The event page unloads mid-stream and mid-send.
    first.unload();

    const second = eventPage(local, session, T0 + 90_000);
    const settingsAnswer = second.request(() => second.settings.state());
    await second.start();
    expect(await settingsAnswer).toMatchObject({ ok: true, state: { revision: 1, readOnly: false, settings: { ui: { theme: 'dark' }, sound: { volume: 35 } } } });
    expect(await second.results.get(opView.opId)).toEqual(opView);
    expect(await second.results.get(uuid(77))).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(second.journal.get(journalEntry.attemptId)).toMatchObject({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN', pendingId: 'pending-1' });
    expect(await second.journal.begin({ ...journalEntry, attemptId: uuid(78) })).toMatchObject({ ok: false, code: 'CG-SEND-UNCERTAIN' });
    expect(second.presence.seenAccounts().map((item) => item.account.hostAccountId)).toEqual([account.hostAccountId]);
    // Tabs register again after the unload; until then no tab is listening.
    expect(second.presence.listeningTabs()).toBe(0);
    expect(second.consent.granted()).toBe(true);
    second.unload();

    // A browser restart: storage.session is gone, storage.local is not.
    session.wipe();
    const third = eventPage(local, session, T0 + 3_600_000);
    await third.start();
    expect(await third.settings.state()).toMatchObject({ ok: true, state: { revision: 0, settings: { ui: { theme: 'dark' } } } });
    expect(await third.results.list({ scope: 'all' })).toEqual({ ops: [], truncated: false });
    expect(third.journal.stats()).toMatchObject({ uncertain: 1, open: 1 });
  });

  it('[RB-012] a store written by a newer build: settings read-only, the rest keeps working', async () => {
    const local = createMemoryKv();
    local.data.set(STORAGE_KEYS.settings, { ...customSettings, schemaVersion: 2, someV2Section: {} });
    const page = eventPage(local, createMemoryKv(), T0);
    await page.start();
    expect(await page.request(() => page.settings.state())).toMatchObject({ ok: true, state: { readOnly: true, settings: { ui: { theme: 'dark' } } } });
    expect(await page.settings.patch({ ui: { hints: true } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-VERSION' } });
    expect((await page.journal.begin(journalEntry)).ok).toBe(true);
    expect(page.barrier.isReady()).toBe(true);
    expect(page.logs.some((entry) => entry.code === 'CG-STORAGE-VERSION')).toBe(true);
  });

  it('[ST-017] storage that cannot be read: the barrier still opens, nothing is overwritten, sends are refused', async () => {
    const local = createMemoryKv();
    local.data.set(STORAGE_KEYS.settings, customSettings);
    for (let i = 0; i < 6; i += 1) local.failNext('get');
    const page = eventPage(local, createMemoryKv(), T0);
    const report = (await page.start()) as { steps: { name: string; outcome: string }[] };
    expect(report.steps.every((step) => step.outcome === 'ok')).toBe(true);
    expect(page.settings.mode()).toBe('unreadable');
    // «Settings Unavailable» (CG-STORAGE-READ), not the read-only banner of a newer store.
    expect(await page.request(() => page.settings.state())).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(page.broadcasts).toEqual([]);
    expect(await page.journal.begin(journalEntry)).toMatchObject({ ok: false, code: 'CG-STORAGE-READ' });
    expect(local.read(STORAGE_KEYS.settings)).toEqual(customSettings);
    expect(local.calls.set).toBe(0);
  });

  it('[EX-018] consent revoked while the background runs: telemetry stops and drops its queue at once', async () => {
    const consent = consentPort(true);
    const page = eventPage(createMemoryKv(), createMemoryKv(), T0, consent);
    await page.start();
    expect(page.consent.granted()).toBe(true);
    consent.revoke();
    expect(page.consent.granted()).toBe(false);
    expect(page.telemetryQueue).toEqual({ pending: 0, purged: 3 });
    // A new event page after the revoke starts with the consent off.
    page.unload();
    const next = eventPage(createMemoryKv(), createMemoryKv(), T0, consent);
    await next.start();
    expect(next.consent.granted()).toBe(false);
  });
});
