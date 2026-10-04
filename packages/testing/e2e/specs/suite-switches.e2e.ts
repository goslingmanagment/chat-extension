// §12 п. 4 on the wired extension, part 2 — «200 быстрых переключений, пока
// завершаются генерации, — ноль вставок не туда» (architecture.md §6.4, §18:
// P1 «вставка в чужой чат»). Three chats of one account are open as ChatSpace
// tabs; a Reply runs in each. A person then switches between them two
// hundred times as fast as the browser lets them, pressing «Вставить» (or
// «Ещё раз» when a result is used up) on whatever the dock shows at that
// moment — so generations end, results arrive and inserts are in flight
// while the chat under them changes.
//
// The fake hub's model signs every part with the fan it was written for
// (`aiNameFan`), and a watcher in the page reads every mounted message field
// on each animation frame. What must hold:
// - no message field ever held a text written for another chat — not at the
//   end, not for one frame;
// - what each dock shows belongs to its own chat;
// - the extension's P1 counter of misplaced inserts stays at zero;
// - inserts did happen (the race was real), and nothing of ours talked to
//   the stand's server.
// The adapter's own race — intents aimed at a chat that is no longer open —
// has its spec without the extension (host-adapter.e2e.ts, 200 switches).

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { bridgeWrites, composerText, pageJournal, pageJournalMark } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursText, pressOurs, pressOursNow } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4 } = STAND_IDS.fans;
const FANS = [a1, a2, a4] as const;
const SWITCHES = 200;

interface Watch {
  /** Frames the watcher looked at. */
  readonly frames: number;
  /** A message field that held a text signed for another chat: the field's chat, the signature, the frame. */
  readonly misplaced: ReadonlyArray<{ readonly field: string; readonly signedFor: string; readonly frame: number }>;
  /** Distinct texts each field held over the run (signatures only). */
  readonly seen: Readonly<Record<string, readonly string[]>>;
}

describe('§12 п. 4 on the wired extension — 200 fast chat switches while generations finish', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  let hubStart = 0;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    // A generation takes about a second: it ends while the person is already in another chat.
    await hub().command({ op: 'config', patch: { aiNameFan: true, aiChunkDelayMs: 150 } });
    hubStart = await hub().mark();
    shift = await startShift(hub(), { settings: { generation: { split: true } }, viewport: { width: 1280, height: 800 }, chat: [ACC, a1] });
    for (const fan of [a2, a4]) {
      await callStand('openChat', ACC, fan, { newTab: true });
      await waitForChatReady(ACC, fan);
    }
  });

  after(async () => {
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[RB-014] [RB-015] [NEW-06] not one insert lands in a chat it was not written for; the P1 counter stays at zero', async function () {
    this.timeout(240_000);
    // Every message field the page has mounted, read on each frame: the chat of the field against the signature of its text.
    await browser.execute(() => {
      const state = { frames: 0, misplaced: [] as Array<{ field: string; signedFor: string; frame: number }>, seen: {} as Record<string, string[]>, stop: false };
      Reflect.set(window, '__switchWatch', state);
      const look = (): void => {
        if (state.stop) return;
        state.frames += 1;
        for (const slot of document.querySelectorAll('[data-stand-composer-slot]')) {
          const field = (slot.getAttribute('data-stand-composer-slot') ?? '').split(':').at(-1) ?? '';
          const text = slot.querySelector('.ProseMirror')?.textContent ?? '';
          const signatures = [...text.matchAll(/@(\d+)/g)].map((match) => match[1] ?? '');
          const list = (state.seen[field] ??= []);
          for (const signedFor of signatures) {
            if (!list.includes(signedFor)) list.push(signedFor);
            if (signedFor !== field && state.misplaced.length < 50) state.misplaced.push({ field, signedFor, frame: state.frames });
          }
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });

    // A Reply in each of the three chats: three generations of this tab run at once (§7: the limit is three).
    for (const fan of FANS) {
      await callStand('openChat', ACC, fan);
      await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${fan}`) === true && d.actions['reply'] === true, `the dock of chat ${fan}`);
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      await dockIs((d) => d.target?.endsWith(`:${fan}`) === true && d.result !== null, `the Reply of chat ${fan} started`);
    }

    const mark = await pageJournalMark();
    const pressed = { insert: 0, again: 0, nothing: 0 };
    /**
     * A person in a hurry: the dock of the chat just opened is looked at for at most a quarter of a second, and
     * whatever it offers is pressed the moment it is seen — «Вставить» of the next part, else «Ещё раз» — or nothing.
     */
    const pressWhatIsThere = async (): Promise<void> => {
      const until = Date.now() + 250;
      do {
        if (await pressOursNow('dock', '.cg-part.is-next .cg-ins:not([aria-disabled="true"])')) {
          pressed.insert += 1;
          return;
        }
        if (await pressOursNow('dock', '.cg-again:not([aria-disabled="true"])')) {
          pressed.again += 1;
          return;
        }
      } while (Date.now() < until);
      pressed.nothing += 1;
    };
    for (let step = 0; step < SWITCHES; step += 1) {
      const next = FANS[(step * 2 + 1) % FANS.length] ?? a1;
      if (step % 2 === 0) {
        // The press, then the next chat at once: the insert it started is still on its way.
        await pressWhatIsThere();
        await callStand('openChat', ACC, next);
      } else {
        // The press and the switch together (the click travels by WebDriver's own channel, the switch by BiDi):
        // the chat changes before, under or after the click.
        await Promise.all([pressWhatIsThere(), callStand('openChat', ACC, next)]);
      }
    }

    // Everything that was started ends; then the three chats are looked at one by one.
    await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 30_000, timeoutMsg: 'generations are still running at the hub' });
    await browser.pause(1000);
    const watch = await browser.execute(() => {
      const state = Reflect.get(window, '__switchWatch') as Watch & { stop: boolean };
      state.stop = true;
      return { frames: state.frames, misplaced: state.misplaced, seen: state.seen };
    });
    const writes = bridgeWrites(await pageJournal(mark));
    const generations = callsTo((await hub().journal(hubStart)).entries, 'aiFeatureStream');
    const fields: Record<string, string | null> = {};
    const docks: Record<string, readonly string[]> = {};
    for (const fan of FANS) {
      fields[fan] = await composerText(ACC, fan);
      await callStand('openChat', ACC, fan);
      await dockIs((d) => d.target?.endsWith(`:${fan}`) === true && d.status === 'ready' && (d.result === null || d.result.state !== 'streaming'), `the dock of chat ${fan} after the race`, 20_000);
      docks[fan] = [...new Set([...(await oursText('dock', '.cg-dock')).matchAll(/@(\d+)/g)].map((match) => match[1] ?? ''))];
    }
    const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
    const counters = diagnostics.ok ? diagnostics.payload.counters : null;

    const evidence = { switches: SWITCHES, pressed, generations: generations.length, writes: writes.length, writesByChat: Object.fromEntries(FANS.map((fan) => [fan, writes.filter((write) => write.chatId === fan).length])), frames: watch.frames, seen: watch.seen, counters };
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    writeFileSync(`${E2E_EVIDENCE_DIR}suite-switches.json`, `${JSON.stringify(evidence, null, 2)}\n`);

    // The race was real: the person pressed «Вставить» many times, parts were written — and some presses were
    // overtaken by the switch and wrote nothing —, generations ended under other chats.
    expect(pressed.insert).toBeGreaterThanOrEqual(20);
    expect(writes.length).toBeGreaterThanOrEqual(10);
    expect(writes.length).toBeLessThanOrEqual(pressed.insert);
    expect(generations.length).toBeGreaterThan(FANS.length);
    expect(watch.frames).toBeGreaterThan(100);
    // Not one frame with a text signed for another chat in any message field.
    expect(watch.misplaced).toEqual([]);
    for (const fan of FANS) {
      // What the field holds at the end is its own chat's part, or nothing.
      const text = fields[fan] ?? '';
      expect([fan, text === '' || text.endsWith(`@${fan}`)]).toEqual([fan, true]);
      expect([fan, (watch.seen[fan] ?? []).filter((signedFor) => signedFor !== fan)]).toEqual([fan, []]);
      // What the chat's dock shows was written for this chat.
      expect([fan, docks[fan]?.filter((signedFor) => signedFor !== fan)]).toEqual([fan, []]);
    }
    // Every write ChatSpace's bridge took went into a field of these three chats, and every generation was asked for one of them.
    expect(writes.filter((write) => !(FANS as readonly string[]).includes(write.chatId))).toEqual([]);
    expect(generations.map((call) => (call.request as { body?: { fanRef?: string } }).body?.fanRef).filter((fan) => !(FANS as readonly string[]).includes(fan ?? ''))).toEqual([]);
    // §0.4, §9.6: the P1 counters — the exact proof of an insert into another chat among them — are not there.
    expect(counters).not.toBeNull();
    expect(Object.entries(counters ?? {}).filter(([name, count]) => (name.startsWith('p1.') || name === 'CG-INSERT-MISPLACED') && count > 0)).toEqual([]);
  });
});
