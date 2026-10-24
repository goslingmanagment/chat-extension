import { describe, expect, it } from 'vitest';

import { createI18n } from '../../domain/i18n';
import { type TabRpc } from '../boards';
import { OUTREACH_PACE_MS, createOutreach, type OutreachAnswer, type OutreachCopied, type OutreachItem, type OutreachRequest, type OutreachTarget } from './outreach';

const CREATOR = '700000000000000001';
const BUNDLE = '700000000000000011';
const PREVIEW = '700000000000000012';
const OTHER_MEDIA = '700000000000000013';
const TOKEN = 'token-of-the-click-0001';

function world(copied: readonly OutreachItem[] | ((account: string | null) => Promise<OutreachCopied>), answer: (request: OutreachRequest) => OutreachAnswer = () => ({ ok: true, messageId: '700000000000000099' }), canAdapt = false) {
  let now = 1_000;
  const timers = new Map<number, () => void>();
  let next = 1;
  const sent: OutreachRequest[] = [];
  const rpc = { request: async () => ({ ok: true, payload: { actionToken: TOKEN, expiresAt: now + 10_000 } }), onEvent: () => () => undefined } as unknown as TabRpc;
  const outreach = createOutreach({
    account: () => CREATOR,
    canAdapt: () => canAdapt,
    rpc,
    i18n: createI18n({ language: 'ru', now: () => now, timeZone: 'Europe/Moscow' }),
    clock: {
      now: () => now,
      setTimer(ms, fn) {
        timers.set(next, fn);
        return next++;
      },
      clearTimer: (handle) => void timers.delete(handle),
    },
    port: {
      copied: typeof copied === 'function' ? copied : async () => ({ items: copied, checked: true }),
      async send(request) {
        sent.push(request);
        return answer(request);
      },
    },
    changed: () => undefined,
  });
  const fan = (n: number, line: string | null = `hey ${n}, missed you 😳`): OutreachTarget => ({
    hostAccountId: CREATOR,
    fanRef: `70000000000000020${n}`,
    line,
    group: async () => `80000000000000030${n}`,
  });
  const later = (ms: number): void => {
    now += ms;
    for (const [handle, fn] of [...timers]) {
      timers.delete(handle);
      fn();
    }
  };
  /** The list's read answered (the port's promise and the read's own step). */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  return { outreach, sent, fan, later, settle };
}

describe('[host:fansly] «Рассылка» of Spenders: who gets what', () => {
  it('each fan gets their own line, the common text and the picked copied items — in its own group, by its own click', async () => {
    const w = world([{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }, { contentType: 1, contentId: OTHER_MEDIA }]);
    w.outreach.set({ type: 'SetOutreach', open: true, text: 'new video is up — the dragon one 🐉' });
    await w.settle();
    // Every «Copied Bundle» goes by default; a «Copied Media» only when ticked.
    expect(w.outreach.vm().items).toEqual([
      { contentType: 2, contentId: BUNDLE, picked: true },
      { contentType: 2, contentId: PREVIEW, picked: true },
      { contentType: 1, contentId: OTHER_MEDIA, picked: false },
    ]);
    expect(w.outreach.row('spenders:42:1', true)).toEqual({ state: 'ready', can: true, code: null });

    const first = await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1));
    expect(first.ok).toBe(true);
    w.later(OUTREACH_PACE_MS);
    await w.outreach.send('SendOutreach', 'spenders:42:2', w.fan(2, 'how was the trip?'));

    expect(w.sent).toEqual([
      {
        hostAccountId: CREATOR,
        fanRef: '700000000000000201',
        groupId: '800000000000000301',
        text: 'hey 1, missed you 😳\n\nnew video is up — the dragon one 🐉',
        attachments: [{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }],
        cause: { kind: 'click', actionToken: TOKEN },
      },
      {
        hostAccountId: CREATOR,
        fanRef: '700000000000000202',
        groupId: '800000000000000302',
        text: 'how was the trip?\n\nnew video is up — the dragon one 🐉',
        attachments: [{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }],
        cause: { kind: 'click', actionToken: TOKEN },
      },
    ]);
    expect(w.outreach.vm().sent).toBe(2);
    expect(w.outreach.row('spenders:42:1', true)).toEqual({ state: 'sent', can: false, code: null });
  });

  it('a fan reached, or maybe reached, never gets it again from here; a fan with no line or no chat gets nothing', async () => {
    const w = world([{ contentType: 2, contentId: BUNDLE }], (request) => (request.fanRef.endsWith('2') ? { ok: false, code: 'CG-SEND-UNCERTAIN' } : { ok: true, messageId: '700000000000000099' }));
    w.outreach.set({ type: 'SetOutreach', open: true, text: 'new video' });
    await w.settle();
    await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1));
    w.later(OUTREACH_PACE_MS);
    expect((await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1))).ok).toBe(false);
    await w.outreach.send('SendOutreach', 'spenders:42:2', w.fan(2));
    w.later(OUTREACH_PACE_MS);
    expect(w.outreach.row('spenders:42:2', true)).toEqual({ state: 'uncertain', can: false, code: 'CG-SEND-UNCERTAIN' });
    expect((await w.outreach.send('SendOutreach', 'spenders:42:2', w.fan(2))).ok).toBe(false);
    expect((await w.outreach.send('SendOutreach', 'spenders:42:3', w.fan(3, null))).ok).toBe(false);
    const lost = { ...w.fan(4), group: async () => null };
    expect((await w.outreach.send('SendOutreach', 'spenders:42:4', lost)).ok).toBe(false);
    expect(w.sent.map((request) => request.fanRef)).toEqual(['700000000000000201', '700000000000000202']);
  });

  it('two clicks inside a second send one message: the second rests until the pause is over', async () => {
    const w = world([]);
    w.outreach.set({ type: 'SetOutreach', open: true });
    await w.settle();
    await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1));
    expect(w.outreach.row('spenders:42:2', true)).toEqual({ state: 'ready', can: false, code: null });
    expect((await w.outreach.send('SendOutreach', 'spenders:42:2', w.fan(2))).ok).toBe(false);
    w.later(OUTREACH_PACE_MS);
    expect((await w.outreach.send('SendOutreach', 'spenders:42:2', w.fan(2))).ok).toBe(true);
    // No common text: the personal line goes alone, and no item was copied.
    expect(w.sent.map((request) => [request.text, request.attachments])).toEqual([
      ['hey 1, missed you 😳', []],
      ['hey 2, missed you 😳', []],
    ]);
  });

  it('«Подстроить под фана»: the batch is a Fix of the common text, and the fan gets their own version alone, with the items', async () => {
    const w = world([{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }], undefined, true);
    w.outreach.set({ type: 'SetOutreach', open: true });
    await w.settle();
    expect(w.outreach.vm().adapt).toBe(true);
    // No common text yet: nothing to rewrite, the batch waits for it.
    expect(w.outreach.needsText()).toBe(true);
    w.outreach.set({ type: 'SetOutreach', text: 'ok this one is SPECIAL, first time with a DRAGON' });
    expect(w.outreach.needsText()).toBe(false);
    expect(w.outreach.batchFix()).toEqual({ draft: 'ok this one is SPECIAL, first time with a DRAGON' });
    await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1, 'hey Gordon, made something new and you were the first one I thought of'));
    expect(w.sent.map((request) => [request.fanRef, request.text, request.attachments])).toEqual([
      ['700000000000000201', 'hey Gordon, made something new and you were the first one I thought of', [{ contentType: 2, contentId: BUNDLE }, { contentType: 2, contentId: PREVIEW }]],
    ]);
    // Switched off, the batch goes back to its Reply / Ping, and a hub without the mode never offers it.
    w.outreach.set({ type: 'SetOutreach', adapt: false });
    expect(w.outreach.batchFix()).toBeNull();
    expect(world([]).outreach.vm().adapt).toBeNull();
  });

  it('a bundle Fansly\'s reload filed as «Copied Media» goes as a bundle once Fansly named it; an earlier read\'s late answer is dropped', async () => {
    const answers: ((copied: OutreachCopied) => void)[] = [];
    const accounts: (string | null)[] = [];
    const w = world((account) => {
      accounts.push(account);
      return new Promise((done) => answers.push(done));
    });
    w.outreach.set({ type: 'SetOutreach', open: true });
    expect(w.outreach.vm()).toMatchObject({ items: [], itemsState: 'reading' });
    // As stored after a reload, unchecked: the person ticks it, and it would reach the fan as nothing.
    answers[0]?.({ items: [{ contentType: 1, contentId: BUNDLE }], checked: false });
    await w.settle();
    expect(w.outreach.vm()).toMatchObject({ items: [{ contentType: 1, contentId: BUNDLE, picked: false }], itemsState: 'unchecked' });
    w.outreach.set({ type: 'SetOutreach', item: { contentType: 1, contentId: BUNDLE, picked: true } });
    // «Обновить» twice: the first read answers last and changes nothing.
    w.outreach.set({ type: 'SetOutreach', refresh: true });
    w.outreach.set({ type: 'SetOutreach', refresh: true });
    answers[2]?.({ items: [{ contentType: 2, contentId: BUNDLE }, { contentType: 1, contentId: OTHER_MEDIA }], checked: true });
    answers[1]?.({ items: [{ contentType: 1, contentId: BUNDLE }], checked: false });
    await w.settle();
    expect(accounts).toEqual([CREATOR, CREATOR, CREATOR]);
    expect(w.outreach.vm()).toMatchObject({ items: [{ contentType: 2, contentId: BUNDLE, picked: true }, { contentType: 1, contentId: OTHER_MEDIA, picked: false }], itemsState: 'checked' });
    await w.outreach.send('SendOutreach', 'spenders:42:1', w.fan(1));
    expect(w.sent.map((request) => request.attachments)).toEqual([[{ contentType: 2, contentId: BUNDLE }]]);
  });
});
