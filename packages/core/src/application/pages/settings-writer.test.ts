// The autosave of the options page (architecture.md §9.4): one request at a
// time, 300 ms after the last typed change, «Сохранено ✓» only with the
// revision the background confirmed, a refused patch kept for «Повторить».

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type SettingsPatch, type SettingsState } from '@cg/contracts';

import { type PageAnswer } from './ports';
import { AUTOSAVE_DEBOUNCE_MS, SettingsWriter, mergeSettingsPatch, settingsWithPending } from './settings-writer';

interface Sent {
  readonly patch: SettingsPatch;
  readonly baseRevision: number | null;
  readonly restricted: boolean;
  answer(result: PageAnswer<SettingsState> | 'lost'): Promise<void>;
}

function harness() {
  const sent: Sent[] = [];
  const timers: { fn: () => void; ms: number; on: boolean }[] = [];
  const confirmed: SettingsState[] = [];
  let changes = 0;
  const writer = new SettingsWriter({
    send: (patch, baseRevision, restricted) =>
      new Promise<PageAnswer<SettingsState>>((resolve, reject) => {
        sent.push({
          patch,
          baseRevision,
          restricted,
          answer: async (result) => {
            if (result === 'lost') reject(new Error('no answer'));
            else resolve(result);
            // The writer settles in the promise's reactions.
            for (let round = 0; round < 5; round += 1) await Promise.resolve();
          },
        });
      }),
    timers: {
      set: (fn, ms) => {
        const timer = { fn, ms, on: true };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        (handle as { on: boolean }).on = false;
      },
    },
    onConfirmed: (state) => confirmed.push(state),
    onChange: () => {
      changes += 1;
    },
  });
  const fire = (): void => {
    for (const timer of timers.splice(0)) if (timer.on) timer.fn();
  };
  const state = (revision: number): PageAnswer<SettingsState> => ({ ok: true, payload: { settings: DEFAULT_SETTINGS, revision, readOnly: false } });
  return { writer, sent, timers, confirmed, fire, state, changes: () => changes };
}

describe('mergeSettingsPatch', () => {
  it('lays the later patch over the earlier one field by field', () => {
    const merged = mergeSettingsPatch({ generation: { windows: { quick: 60 }, split: true }, ui: { hints: false } }, { generation: { windows: { ping: 40, quick: 80 } }, sound: { volume: 30 } });
    expect(merged).toEqual({ generation: { windows: { quick: 80, ping: 40 }, split: true }, ui: { hints: false }, sound: { volume: 30 } });
  });

  it('merges the maps by key — a null still removes — and replaces the muted list whole', () => {
    const merged = mergeSettingsPatch(
      { accounts: { labels: { 'chatspace:1001': 'Основная', 'chatspace:1002': 'Вторая' } }, sound: { mutedAccounts: ['chatspace:1001'] } },
      { accounts: { labels: { 'chatspace:1002': null } }, sound: { mutedAccounts: [] } },
    );
    expect(merged).toEqual({ accounts: { labels: { 'chatspace:1001': 'Основная', 'chatspace:1002': null } }, sound: { mutedAccounts: [] } });
  });

  it('adds nothing a patch did not name', () => {
    expect(mergeSettingsPatch({}, {})).toEqual({});
    expect(mergeSettingsPatch({ ui: { theme: 'dark' } }, {})).toEqual({ ui: { theme: 'dark' } });
  });
});

describe('settingsWithPending', () => {
  it('shows the confirmed settings with the unsaved change on top', () => {
    expect(settingsWithPending(DEFAULT_SETTINGS, null)).toBe(DEFAULT_SETTINGS);
    expect(settingsWithPending(DEFAULT_SETTINGS, { sound: { volume: 35 }, debug: { enabled: true } })).toMatchObject({ sound: { volume: 35 }, debug: { enabled: true } });
  });
});

describe('SettingsWriter', () => {
  it('[ST-013] a switch goes at once; typed changes wait 300 ms after the last one and go as one request', async () => {
    const { writer, sent, timers, fire, state } = harness();
    writer.adoptRevision(7);
    void writer.write({ generation: { split: true } }, 'now');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ patch: { generation: { split: true } }, baseRevision: 7, restricted: false });
    await sent[0]?.answer(state(8));

    void writer.write({ generation: { windows: { quick: 6 } } }, 'debounced');
    void writer.write({ generation: { windows: { quick: 60 } } }, 'debounced');
    expect(sent).toHaveLength(1);
    expect(timers.filter((timer) => timer.on).map((timer) => timer.ms)).toEqual([AUTOSAVE_DEBOUNCE_MS]);
    fire();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ patch: { generation: { windows: { quick: 60 } } }, baseRevision: 8 });
  });

  it('[ST-014] «saved» exists only with the confirmed revision; until then the status is «saving» and the change is pending', async () => {
    const { writer, sent, confirmed, state } = harness();
    const outcome = writer.write({ ui: { hints: false } }, 'now');
    expect(writer.status()).toEqual({ s: 'saving' });
    expect(writer.pending()).toEqual({ ui: { hints: false } });
    await sent[0]?.answer(state(3));
    expect(await outcome).toEqual({ ok: true, revision: 3 });
    expect(writer.status()).toEqual({ s: 'saved', revision: 3 });
    expect(writer.pending()).toBeNull();
    expect(confirmed.map((entry) => entry.revision)).toEqual([3]);
  });

  it('keeps one request in flight: a change made meanwhile goes after the answer', async () => {
    const { writer, sent, state } = harness();
    void writer.write({ ui: { theme: 'dark' } }, 'now');
    void writer.write({ ui: { locale: 'en' } }, 'now');
    expect(sent).toHaveLength(1);
    expect(writer.pending()).toEqual({ ui: { theme: 'dark', locale: 'en' } });
    await sent[0]?.answer(state(2));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ patch: { ui: { locale: 'en' } }, baseRevision: 2 });
    expect(writer.status()).toEqual({ s: 'saving' });
    await sent[1]?.answer(state(3));
    expect(writer.status()).toEqual({ s: 'saved', revision: 3 });
  });

  it('[ST-014] a refusal is «failed» with the patch kept; nothing is resent by itself; «Повторить» sends the same change', async () => {
    const { writer, sent, state } = harness();
    const first = writer.write({ sound: { volume: 40 } }, 'now');
    await sent[0]?.answer({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    expect(await first).toEqual({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    expect(writer.status()).toEqual({ s: 'failed', error: { code: 'CG-STORAGE-WRITE' } });
    expect(writer.pending()).toEqual({ sound: { volume: 40 } });
    expect(sent).toHaveLength(1);

    const again = writer.retry();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.patch).toEqual({ sound: { volume: 40 } });
    await sent[1]?.answer(state(5));
    expect(await again).toEqual({ ok: true, revision: 5 });
    expect(writer.retry()).toBeNull();
  });

  it('a lost answer is CG-RUNTIME-UNREACHABLE, and the next change carries the unsaved one along', async () => {
    const { writer, sent, state } = harness();
    void writer.write({ sound: { volume: 40 } }, 'now');
    await sent[0]?.answer('lost');
    expect(writer.status()).toEqual({ s: 'failed', error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    void writer.write({ ui: { hints: false } }, 'now');
    expect(sent[1]?.patch).toEqual({ sound: { volume: 40 }, ui: { hints: false } });
    await sent[1]?.answer(state(2));
    expect(writer.status()).toEqual({ s: 'saved', revision: 2 });
  });

  it('a refusal with a newer change behind it: both go in the next request and both callers get its answer', async () => {
    const { writer, sent, state } = harness();
    const first = writer.write({ ui: { theme: 'dark' } }, 'now');
    const second = writer.write({ ui: { locale: 'en' } }, 'now');
    await sent[0]?.answer({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    expect(sent[1]?.patch).toEqual({ ui: { theme: 'dark', locale: 'en' } });
    await sent[1]?.answer(state(9));
    expect(await first).toEqual({ ok: true, revision: 9 });
    expect(await second).toEqual({ ok: true, revision: 9 });
  });

  it('[ST-015] pagehide sends what waits for its pause; with nothing waiting it does nothing', () => {
    const { writer, sent } = harness();
    writer.flush();
    expect(sent).toHaveLength(0);
    void writer.write({ generation: { coach: { historyLimit: 12 } } }, 'debounced');
    writer.flush();
    expect(sent.map((entry) => entry.patch)).toEqual([{ generation: { coach: { historyLimit: 12 } } }]);
  });

  it('the hub address and debug go through the restricted request; a disposed writer sends nothing more', () => {
    const { writer, sent, fire } = harness();
    void writer.write({ debug: { enabled: true } }, 'now');
    expect(sent[0]?.restricted).toBe(true);
    const other = harness();
    void other.writer.write({ sound: { volume: 10 } }, 'debounced');
    other.writer.dispose();
    other.fire();
    fire();
    expect(other.sent).toHaveLength(0);
  });

  it('the revision only grows: an older state seen later does not move the base back', () => {
    const { writer, sent } = harness();
    writer.adoptRevision(9);
    writer.adoptRevision(4);
    void writer.write({ ui: { hints: true } }, 'now');
    expect(sent[0]?.baseRevision).toBe(9);
  });
});
