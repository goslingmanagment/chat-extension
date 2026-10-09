// Decision X25 on the wired extension: the owner lets X8 run on any ChatSpace
// build — the hub lists the «any build» sentinel instead of per-build profiles
// — and the fuse watches what a send does. The TEST build on the stand
// against the fake hub, the whole chain real: the hub's value, the
// background's bootstrap, the tab's adapter, the preview, the custody, MAIN,
// ChatSpace's queue, the background's fuse, «Статус».
//
// What it proves: X8 is admitted by the sentinel on the stand's build and
// «Статус» says the build was not reviewed; a text the platform did not keep
// trips the fuse — the part stays sent, nothing is sent again, X8 is off in
// the preview with CG-SEND-FUSE and in «Статус» with the reason; the person's
// «Сбросить предохранитель» turns it on again and the next part goes.
// Its own spec file: the fuse is kept in the browser's storage, and no other
// spec should start with it.

import { browser, expect } from '@wdio/globals';

import { ADAPTER_VERSION } from '@cg/host-chatspace/isolated';

import { callsTo } from '../../src/fake-hub/journal';
import { pageJournal, pageJournalMark, PANEL, queueAdds, sendsOf, serverSince } from '../support/chat';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { pageRpc } from '../support/extension';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, pressOurs, readOurs, waitOursText } from '../support/ours';
import { press, waitForOptions, type StatusRow } from '../support/pages';
import { dockIs, startShift, type Shift } from '../support/shift';
import { foreignCalls, STAND_IDS, standServer } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a4 } = STAND_IDS.fans;
/** The hub value the owner sets for this adapter (docs/pilot-readiness.md §2). */
const SENTINEL = { id: 'any-build', adapterVersion: ADAPTER_VERSION, modules: { '*': '*' } };
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];

interface FuseState {
  readonly fuse: { readonly trippedAt: number; readonly reason: string; readonly where: string; readonly build: string | null; readonly attemptId: string | null } | null;
  readonly resetAt: number | null;
}
interface Diagnostics {
  readonly tabs: ReadonlyArray<{ readonly host: { readonly build: string | null; readonly receiptMatch?: { readonly profile: string; readonly kind: string } } | null }>;
  readonly sendFuse?: FuseState;
}

describe('decision X25 on the wired extension — X8 on any ChatSpace build, and the fuse after a send', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  const openPreview = async (name: string): Promise<void> => {
    if (!(await oursExists('modal', '[aria-label="Spenders"]'))) await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', name, `the board lists ${name}`, { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', new RegExp(`^${name}`));
    await waitOursText('modal', name, `the preview of ${name}`, { selector: '.cg-pv' });
  };
  const generate = async (fan: string): Promise<void> => {
    await pressOurs('modal', '.cg-pv .cg-pvm button, .cg-pv button', /^Reply/);
    await waitOursText('modal', reply(fan)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
  };
  const part = (index: number): string => `.cg-pv [data-cg-part="${index}"]`;
  const sendState = async (index: number): Promise<string> => {
    const drawn = await readOurs('modal', part(index), (node) => [node.getAttribute('data-cg-send-state'), node.querySelector('.cg-pvs')?.getAttribute('data-cg-send') ?? null] as const);
    if (drawn === null) return 'no-part';
    const [own, row] = drawn;
    return row === null || row === own ? String(own) : `${String(own)}/${row}`;
  };
  const waitSend = async (index: number, wanted: string | RegExp, message: string, timeout = 15_000): Promise<string> => {
    let last = '';
    try {
      await browser.waitUntil(
        async () => {
          last = await sendState(index);
          return typeof wanted === 'string' ? last === wanted : wanted.test(last);
        },
        { timeout, interval: 100 },
      );
    } catch {
      throw new Error(`${message}: part ${index + 1} is «${last}», not «${String(wanted)}», after ${timeout} ms; the result shows: ${(await oursText('modal', '.cg-pvr')).slice(0, 500)}`);
    }
    return last;
  };
  const pressSendOf = (index: number): Promise<void> => pressOurs('modal', `${part(index)} .cg-pvs__send`, /^Отправить/);
  const custody = async (mark: number, fan: string): Promise<string[]> =>
    callsTo((await hub().journal(mark)).entries, 'clientFanClaim')
      .filter((call) => (call.request as { fanRef?: string }).fanRef === fan)
      .map((call) => `${(call.request as { body: { action: string } }).body.action}:${call.status}`);
  const fuseState = async (): Promise<FuseState> => {
    const answer = await shift.rpc<FuseState>('send.fuseState');
    if (!answer.ok) throw new Error(`send.fuseState: ${answer.error.code}`);
    return answer.payload;
  };
  const diagnostics = async (): Promise<Diagnostics> => {
    const answer = await shift.rpc<Diagnostics>('diagnostics.get');
    if (!answer.ok) throw new Error(`diagnostics.get: ${answer.error.code}`);
    return answer.payload;
  };
  /** The X8 row of «Статус» once `wanted` holds; the ChatSpace tab is in front again after it. */
  const x8Row = async (wanted: (row: StatusRow) => boolean, message: string, act?: () => Promise<void>): Promise<StatusRow> => {
    await shift.toPages();
    try {
      await browser.url('about:blank');
      await browser.url(testBuildPage('options.html#status'));
      const state = await waitForOptions((options) => {
        const row = options.rows['preview-send'];
        return row !== undefined && wanted(row);
      }, message);
      await act?.();
      return state.rows['preview-send'] as StatusRow;
    } finally {
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
    }
  };

  before(async () => {
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { previewSend: true, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready', 'the dock of the open chat is ready');
    // The owner's value: the sentinel instead of the stand build's exact profile. The background reads it, the tab follows.
    await hub().command({ op: 'config', patch: { limits: { previewSendReceiptProfiles: [SENTINEL] } } });
    expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
  });

  after(async () => {
    const entries = await serverSince(journalStart);
    // §6.7.13 «изоляция трафика»: every POST of a message was ChatSpace's own client's, and nothing of ours talked to the stand.
    expect(sendsOf(entries).filter((entry) => entry.origin !== 'native')).toEqual([]);
    expect(foreignCalls(entries)).toEqual([]);
    // Nothing of the fuse stays for whatever runs in this browser next: «Сбросить предохранитель» is the settings page's.
    await shift.toPages();
    try {
      await browser.url(testBuildPage('options.html#status'));
      expect(await pageRpc('send.fuseReset')).toMatchObject({ ok: true });
    } finally {
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
    }
  });

  it('[X8-06] the sentinel admits X8 on the stand’s build: the tab says the match was «any build», and «Статус» says the build was not reviewed', async () => {
    await browser.waitUntil(async () => (await diagnostics()).tabs.some((tab) => tab.host?.receiptMatch?.kind === 'anyBuild'), {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'the tab did not report the «any build» match',
    });
    expect((await diagnostics()).tabs.map((tab) => tab.host?.receiptMatch)).toContainEqual({ profile: 'any-build', kind: 'anyBuild' });
    const row = await x8Row((candidate) => candidate.text.includes('не проверена'), '«Статус» shows X8 on a build nobody reviewed');
    expect(row).toMatchObject({ level: 'ok', action: null });
    expect(row.text).toBe(
      'включена · сборка ChatSpace не проверенаХаб пропускает любую сборку ChatSpace (профиль «any-build»). Если после отправки что-то пойдёт не так, предохранитель выключит её сам. Открытых попыток: 0, с неизвестным исходом: 0.',
    );
  });

  it('[X8-06] a text the platform did not keep trips the fuse: the part stays sent, nothing is sent again, «Отправить» is off with CG-SEND-FUSE — and «Сбросить предохранитель» turns it on again', async () => {
    const hubMark = await hub().mark();
    const standMark = await standServer.mark();
    const mark = await pageJournalMark();
    await openPreview('Fan Dune');
    await generate(a4);
    expect([await sendState(0), await sendState(1)]).toEqual(['available', 'available/after']);

    // The stand's platform keeps and echoes another text than the one the preview sent.
    await standServer.script(ACC, a4, [{ kind: 'ok', echoContent: '<p>Not what the preview sent</p>' }]);
    await pressSendOf(0);
    await waitSend(0, 'sent', 'the first part is sent (the pair was made by id)');
    // X8 is off at once in this tab: the next part says why, and only that.
    await waitSend(1, /^unavailable/, 'the fuse turned the preview send off');
    expect(await oursText('modal', part(1))).toContain('CG-SEND-FUSE');
    expect(await oursExists('modal', `${part(1)} .cg-pvs__open`)).toBe(true);

    // The background keeps it for the browser: when, why, on which build, which attempt — no text.
    await browser.waitUntil(async () => (await fuseState()).fuse !== null, { timeout: 10_000, interval: 200, timeoutMsg: 'the background did not keep the fuse' });
    const kept = await fuseState();
    const build = (await diagnostics()).tabs.find((tab) => tab.host !== null)?.host?.build ?? null;
    // The stand's response carries the message as the platform kept it: that is where the fuse saw it first.
    expect(kept.fuse).toMatchObject({ reason: 'text', where: 'response', build });
    expect(JSON.stringify(kept)).not.toContain('preview sent');

    // Nothing was sent again: one click, one queue call, one POST, one custody from dispatch to sent.
    await browser.pause(1000);
    expect(sendsOf(await serverSince(standMark), a4)).toHaveLength(1);
    expect(queueAdds(await pageJournal(mark))).toHaveLength(1);
    expect(await custody(hubMark, a4)).toEqual(['dispatch:200', 'sent:200']);
    // A click on the held part starts nothing: no dispatch, no queue call.
    await pressSendOf(1);
    await browser.pause(500);
    expect(await custody(hubMark, a4)).toEqual(['dispatch:200', 'sent:200']);
    expect(sendsOf(await serverSince(standMark), a4)).toHaveLength(1);

    // «Статус»: off by the fuse, why and on which build, with the person's button — which clears it.
    const fused = await x8Row(
      (row) => row.text.startsWith('выключена предохранителем'),
      '«Статус» shows the fuse',
      () => press('Сбросить предохранитель', '[data-pg-row="preview-send"]'),
    );
    expect(fused.level).toBe('warn');
    expect(fused.action).toBe('Сбросить предохранитель');
    expect(fused.text).toContain('Текст отправленного сообщения не совпал с тем, что мы отправляли.');
    expect(fused.text).toContain(`сборка ${String(build)}`);
    await browser.waitUntil(async () => (await fuseState()).fuse === null, { timeout: 10_000, timeoutMsg: 'the reset did not reach the background' });
    const back = await x8Row((row) => row.text.includes('не проверена'), '«Статус» shows X8 on again');
    expect(back.level).toBe('ok');

    // The tab heard the reset: the next part can go, and goes — the platform keeps its text this time, the fuse is quiet.
    await waitSend(1, 'available', 'the next part can be sent after the reset');
    await pressSendOf(1);
    await waitSend(1, 'sent', 'the next part is sent');
    expect(sendsOf(await serverSince(standMark), a4).map((entry) => entry.detail?.['plain'])).toEqual([...reply(a4)]);
    await browser.pause(500);
    expect((await fuseState()).fuse).toBeNull();
  });
});
