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
//
// WebDriver cannot click faster than our insert path runs, so in the two
// hundred switches every press is answered before the chat changes. The
// overtaken press is therefore staged, at the two moments a switch can fall
// into:
// - `under` — the page itself opens another chat while the click on
//   «Вставить» is being delivered (the click's own task): our side sees the
//   other chat before it builds the write, and refuses it itself;
// - `held` (its own test) — the write passed our side's check and is held
//   on its way to MAIN (the TEST build's hook, tab/probe.ts `holdWrite`),
//   and the chat changes in that time. The two fields are both untouched —
//   empty, the same draft revision — so the draft's own compare-and-set
//   cannot tell them apart: only MAIN's check of the chat and of the
//   composer, made in the one step with the write, stands between the text
//   and the field of the chat that opened.
// Both must write nothing (CG-INSERT-CHAT-CHANGED) — and never into the
// chat that opened under them. Without the adapter's checks of the chat
// (MAIN `insertGuarded`) the held presses write into that chat and this
// spec fails.
// The adapter's own race — intents aimed at a chat that is no longer open —
// has its spec without the extension too (host-adapter.e2e.ts, 200 switches).

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';

import { callsTo } from '../../src/fake-hub/journal';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { bridgeWrites, composerText, pageJournal, pageJournalMark } from '../support/chat';
import { holdWrites, readReport, waitForReport } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, pressOurs, pressOursNow } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4 } = STAND_IDS.fans;
const FANS = [a1, a2, a4] as const;
const SWITCHES = 200;
/** Presses of «Вставить» a switch overtakes under the click. */
const OVERTAKEN = 6;
/** Chats nobody typed in, opened one after another in one ChatSpace tab: each press is held while the next one opens. */
const UNTOUCHED = [STAND_IDS.fans.a5, STAND_IDS.fans.a6, STAND_IDS.fans.a7, STAND_IDS.fans.a8, '74001009', '74001010', '74001011'] as const;
/** How long a held write waits between our check and MAIN's: the switch is made in that time. */
const HOLD_MS = 1200;
const INSERTABLE = '.cg-part.is-next .cg-ins:not([aria-disabled="true"])';

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

  it('[RB-014] [RB-015] [NEW-06] not one insert lands in a chat it was not written for — a press the switch overtakes is refused; the P1 counter stays at zero', async function () {
    this.timeout(300_000);
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

    // The presses a switch overtakes under the click (see the head of this file): the page opens the next chat the
    // moment a click on our dock is delivered — before our own handler runs.
    await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 30_000, timeoutMsg: 'generations are still running at the hub' });
    const overtaken = { pressed: 0, writes: 0, reachedMain: 0 };
    for (let round = 0; round < OVERTAKEN; round += 1) {
      const from = FANS[round % FANS.length] ?? a1;
      const next = FANS[(round + 1) % FANS.length] ?? a2;
      await callStand('openChat', ACC, from);
      await dockIs((d) => d.target?.endsWith(`:${from}`) === true && d.status === 'ready', `the dock of chat ${from} before an overtaken press`);
      if (!(await oursExists('dock', INSERTABLE))) {
        // Its result is used up: a new one.
        if (!(await pressOursNow('dock', '.cg-again:not([aria-disabled="true"])'))) await pressOurs('dock', '.cg-strip button', /^Reply/);
        await browser.waitUntil(() => oursExists('dock', INSERTABLE), { timeout: 30_000, timeoutMsg: `chat ${from} offers nothing to insert` });
      }
      const before = await pageJournalMark();
      const reached = (await readReport())?.writesReached ?? 0;
      await browser.execute(
        (account: string, fan: string) => {
          const stand = (window as unknown as { __stand: { openChat(account: string, fan: string): unknown } }).__stand;
          const onClick = (event: Event): void => {
            // A click inside our closed root reaches the page as a click on its host.
            if (!(event.target instanceof Element) || event.target.closest('[data-cg="dock"]') === null) return;
            window.removeEventListener('click', onClick, true);
            void stand.openChat(account, fan);
          };
          window.addEventListener('click', onClick, true);
        },
        ACC,
        next,
      );
      expect([round, await pressOursNow('dock', INSERTABLE)]).toEqual([round, true]);
      overtaken.pressed += 1;
      await browser.waitUntil(async () => (await callStand('route')).chatId === next, { timeout: 5000, timeoutMsg: `chat ${next} did not open under the press` });
      await dockIs((d) => d.target?.endsWith(`:${next}`) === true && d.status === 'ready', `the dock of chat ${next} after an overtaken press`);
      // The insert that was on its way has ended one way or the other.
      await browser.pause(200);
      const landed = bridgeWrites(await pageJournal(before));
      // Whatever was written went into the field of the chat the part was made for — never into the one that opened.
      expect([round, landed.filter((write) => write.chatId !== from)]).toEqual([round, []]);
      overtaken.writes += landed.length;
      if (((await readReport())?.writesReached ?? 0) > reached) overtaken.reachedMain += 1;
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

    const evidence = { switches: SWITCHES, pressed, overtaken, generations: generations.length, writes: writes.length, writesByChat: Object.fromEntries(FANS.map((fan) => [fan, writes.filter((write) => write.chatId === fan).length])), frames: watch.frames, seen: watch.seen, counters };
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    writeFileSync(`${E2E_EVIDENCE_DIR}suite-switches.json`, `${JSON.stringify(evidence, null, 2)}\n`);

    // The race was real: the person pressed «Вставить» many times, parts were written — and some presses were
    // overtaken by the switch and wrote nothing —, generations ended under other chats.
    expect(pressed.insert).toBeGreaterThanOrEqual(20);
    expect(writes.length).toBeGreaterThanOrEqual(10);
    expect(writes.length).toBeLessThanOrEqual(pressed.insert + overtaken.pressed);
    // The overtaken presses were real and the switch won every one of them: nothing was written, and our own side
    // refused each before a write was even on its way to MAIN.
    expect(overtaken).toEqual({ pressed: OVERTAKEN, writes: 0, reachedMain: 0 });
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

  it('[RB-014] [NEW-06] a write that is already on its way when the chat changes is stopped by MAIN’s own check of the chat — the two fields are both untouched, nothing else tells them apart', async function () {
    this.timeout(180_000);
    const held = { pressed: 0, reachedMain: 0, writes: 0 };
    try {
      for (let round = 0; round + 1 < UNTOUCHED.length; round += 1) {
        const from = UNTOUCHED[round] ?? '';
        const next = UNTOUCHED[round + 1] ?? '';
        // The chat replaces the one in the active ChatSpace tab: its message field is new and empty.
        await callStand('openChat', ACC, from);
        await waitForChatReady(ACC, from);
        await dockIs((d) => d.target?.endsWith(`:${from}`) === true && d.status === 'ready' && d.actions['reply'] === true, `the dock of chat ${from}`);
        expect([from, await composerText(ACC, from)]).toEqual([from, '']);
        await pressOurs('dock', '.cg-strip button', /^Reply/);
        await browser.waitUntil(() => oursExists('dock', INSERTABLE), { timeout: 30_000, timeoutMsg: `chat ${from} offers nothing to insert` });

        const before = await pageJournalMark();
        const reached = (await readReport())?.writesReached ?? 0;
        await holdWrites(HOLD_MS);
        expect([round, await pressOursNow('dock', INSERTABLE)]).toEqual([round, true]);
        held.pressed += 1;
        // Our side checked the chat and let the write go; it waits on its way to MAIN — and the chat changes.
        await waitForReport((report) => (report.writesReached ?? 0) > reached, `the write of round ${round} did not reach the hold`, 5000);
        held.reachedMain += 1;
        await callStand('openChat', ACC, next);
        await waitForChatReady(ACC, next);
        await dockIs((d) => d.target?.endsWith(`:${next}`) === true && d.status === 'ready', `the dock of chat ${next}`);
        await browser.pause(HOLD_MS + 300);
        await holdWrites(0);
        const landed = bridgeWrites(await pageJournal(before));
        held.writes += landed.length;
        // Nothing was written anywhere — least of all into the empty field of the chat that opened.
        expect([round, landed]).toEqual([round, []]);
        expect([next, await composerText(ACC, next)]).toEqual([next, '']);
      }
    } finally {
      await holdWrites(0);
    }
    expect(held).toEqual({ pressed: UNTOUCHED.length - 1, reachedMain: UNTOUCHED.length - 1, writes: 0 });
    const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
    expect(Object.entries(diagnostics.ok ? diagnostics.payload.counters : { missing: 1 }).filter(([name, count]) => (name.startsWith('p1.') || name === 'CG-INSERT-MISPLACED' || name === 'missing') && count > 0)).toEqual([]);
  });

  it('[RB-015] [RB-008] a chat opened and left again at once: MAIN is asked nothing in the middle of a chat switch, and the dock is back over the first chat’s field with «Вставить»', async () => {
    // CI on PR #16 (this spec and suite-dock, under load). ChatSpace shows the other chat's field before MAIN's report
    // of it arrives; the dock went over it, that was taken for a re-render of the field, and MAIN was asked for a
    // snapshot at once — on every chat switch. Its answer was taken as the open chat's composer, outside MAIN's event
    // stream: «no composer yet» from the middle of a switch stayed for good when MAIN, back on the first chat, had no
    // new event to send (the dock «copy only», nothing to insert), and an answer that came ahead of MAIN's own event
    // put the dock back in the frame it had left in (ChatSpace's list lost its bottom).
    // Here the page opens the other chat right after a frame and is back 8 ms later — or the moment MAIN answers a
    // snapshot (it sees MAIN's frames leave, §14). A chat switch is MAIN's own news: nothing is asked of it, and the
    // dock ends over the first chat's field with «Вставить». The lost composer itself needs a frame that comes late
    // (a loaded machine): the adapter's own specs stage it (stack.dom.test.ts, host-port.dom.test.ts).
    for (const [from, other] of [
      [a1, a2],
      [a2, a4],
      [a4, a1],
    ] as const) {
      await callStand('openChat', ACC, from);
      await waitForChatReady(ACC, from);
      await dockIs((d) => d.target?.endsWith(`:${from}`) === true && d.status === 'ready' && d.kind === 'in-flow' && d.mode === 'insert', `the dock of chat ${from}`);
      // Nothing of that switch is still on its way.
      await browser.pause(150);
      const asked = await browser.execute(
        async (acc: string, there: string, back: string) => {
          type Frame = { readonly v?: unknown; readonly kind?: unknown; readonly t?: unknown };
          const stand = (window as unknown as { __stand: { openChat(accountId: string, chatId: string): Promise<void> } }).__stand;
          const original = Reflect.get(MessagePort.prototype, 'postMessage') as (this: MessagePort, ...args: unknown[]) => void;
          let snapshots = 0;
          let left = false;
          const goBack = (): void => {
            if (left) return;
            left = true;
            void stand.openChat(acc, back);
          };
          Reflect.set(MessagePort.prototype, 'postMessage', function (this: MessagePort, message: unknown, ...rest: unknown[]): void {
            original.call(this, message, ...rest);
            const frame = message as Frame | null;
            if (typeof frame !== 'object' || frame === null || frame.v !== 1 || frame.kind !== 'res' || frame.t !== 'snapshot') return;
            snapshots += 1;
            goBack();
          });
          try {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => {
                void stand.openChat(acc, there);
                resolve();
              }),
            );
            await new Promise((resolve) => setTimeout(resolve, 8));
            goBack();
            // MAIN's settle time for a field it did not tell of, and more.
            await new Promise((resolve) => setTimeout(resolve, 250));
          } finally {
            Reflect.set(MessagePort.prototype, 'postMessage', original);
          }
          return snapshots;
        },
        ACC,
        other,
        from,
      );
      await waitForChatReady(ACC, from);
      const back = await dockIs((d) => d.target?.endsWith(`:${from}`) === true && d.status === 'ready' && d.kind === 'in-flow' && d.mode === 'insert', `the dock of chat ${from} after a look into ${other} and back`, 5000);
      expect(back).toMatchObject({ banner: null, inFlowFirstChild: true });
      // A chat switch is MAIN's own news: nothing was asked of it.
      expect([from, other, 'snapshots asked of MAIN', asked]).toEqual([from, other, 'snapshots asked of MAIN', 0]);
    }
  });

  // Last in the file: the page keeps renumbering MAIN's frames after it (see `holdRouteFrames`).
  it('[RB-015] [RB-008] the route of a chat already left comes after the composer of the chat now open — the order quick switches give on a busy page; the dock comes back over that chat’s field', async () => {
    // What `pnpm perf` met after ten quick switches (docs/pilot-readiness.md §5 п. 15): the dock stayed «copy only»,
    // CG-HOST-COMPOSER-MISSING, over a field that was there, until the next chat. MAIN and the bridge client coalesce
    // route and composer events each type on its own (≤ 50 per second), so the two types need not keep MAIN's order:
    // after W → X, X's composer may come before W's route — and MAIN never sends an unchanged composer again.
    // WebDriver cannot hit those milliseconds on purpose, so the page holds MAIN's route frames back (it sees the port
    // and may, §14): W's route and X's route both come after X's composer.
    for (const fan of FANS) {
      await callStand('openChat', ACC, fan, { newTab: true });
      await waitForChatReady(ACC, fan);
    }
    const last = FANS.at(-1) ?? a4;
    await dockIs((d) => d.target?.endsWith(`:${last}`) === true && d.status === 'ready', `the dock of chat ${last}`);
    // Nothing of those switches is still on its way.
    await browser.pause(150);
    await holdRouteFrames(ROUTE_LAG_MS);
    try {
      for (const [w, x] of [
        [a2, a1],
        [a4, a2],
        [a1, a4],
      ] as const) {
        // W's route goes out at once and waits in the page; X's 60 ms later (MAIN lets one through per 20 ms), and X's
        // composer a frame after it — both routes come to the isolated side after that composer.
        await browser.execute(
          async (acc: string, first: string, second: string, gap: number) => {
            const stand = (window as unknown as { __stand: { openChat(accountId: string, chatId: string): Promise<void> } }).__stand;
            await stand.openChat(acc, first);
            await new Promise((resolve) => setTimeout(resolve, gap));
            await stand.openChat(acc, second);
          },
          ACC,
          w,
          x,
          SWITCH_GAP_MS,
        );
        await waitForChatReady(ACC, x);
        await dockIs((d) => d.target?.endsWith(`:${x}`) === true && d.status === 'ready' && d.kind === 'in-flow', `the dock of chat ${x} after ${w}`, ROUTE_LAG_MS + 5000);
      }
    } finally {
      await holdRouteFrames(0);
    }
  });
});

/** How long the page holds MAIN's route frames in the last case: far longer than a switch takes to reach the composer. */
const ROUTE_LAG_MS = 400;
/** Between the two switches of a round there: more than MAIN's 20 ms between two route events, far less than the lag. */
const SWITCH_GAP_MS = 60;

/**
 * The page holds MAIN's route frames `ms` before they go to the isolated side, and lets every other frame through at
 * once (0 — none held from now on). The bridge client drops a frame whose sequence number is not above the last one's
 * (a stale frame), so the frames are renumbered in the order they leave — the order the client's own coalescing would
 * hand them on. MAIN's own numbers stay behind from then on: the renumbering stays for the rest of the page's life.
 */
async function holdRouteFrames(ms: number): Promise<void> {
  await browser.execute((lag: number) => {
    type Frame = { readonly v?: unknown; readonly kind?: unknown; readonly t?: unknown; readonly seq?: unknown };
    const page = window as unknown as { __cgRouteLag?: { ms: number } };
    if (page.__cgRouteLag !== undefined) {
      page.__cgRouteLag.ms = lag;
      return;
    }
    const state = { ms: lag };
    page.__cgRouteLag = state;
    const original = Reflect.get(MessagePort.prototype, 'postMessage') as (this: MessagePort, ...args: unknown[]) => void;
    const next = new WeakMap<MessagePort, number>();
    const send = (port: MessagePort, frame: Frame, rest: unknown[]): void => {
      const seq = Math.max(next.get(port) ?? 0, frame.seq as number);
      next.set(port, seq + 1);
      original.call(port, { ...frame, seq }, ...rest);
    };
    Reflect.set(MessagePort.prototype, 'postMessage', function (this: MessagePort, message: unknown, ...rest: unknown[]): void {
      const frame = message as Frame;
      // Only MAIN's frames to the isolated side carry a protocol version, a kind and a sequence number.
      if (typeof frame !== 'object' || frame === null || frame.v !== 1 || typeof frame.seq !== 'number' || (frame.kind !== 'evt' && frame.kind !== 'res')) {
        original.call(this, message, ...rest);
        return;
      }
      if (frame.kind === 'evt' && frame.t === 'route' && state.ms > 0) setTimeout(() => send(this, frame, rest), state.ms);
      else send(this, frame, rest);
    });
  }, ms);
}
