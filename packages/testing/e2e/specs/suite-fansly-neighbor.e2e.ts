// Our extension next to FBuddy in every mode of the stand's neighbour (R20 P7i;
// FS-CO-4, X34: FBuddy runs for every chatter; plan.md §3 `suite-fansly-neighbor`,
// the last PR of the chain tap → dock → insert → send). The extension's test
// build with Fansly switched on, a chatter signed in, the Fansly page's own
// switches on; for each mode of the neighbour — off, after, its hook after the
// page's first answer, before, reinject, the old FBuddy, its fan panel in the
// header or beside the chat, a third party's Proxy or subclass over the
// constructors:
// - our tap: MAIN answered through the bridge, the open chat named by its
//   observation (the dock shows it);
// - our dock right before Fansly's composer, the neighbour's widgets after the
//   composer's actions, both in place;
// - a Reply by its key and its part inserted by Enter: Fansly's field and the
//   page's model have the text; the person's Enter sends it — Fansly's own
//   request — and that send of our part is taken for known: the hub hears
//   `sent` of the operation (the person allowed the measurements);
// - the neighbour's hooks saw the page's answers as the server served them —
//   our Proxies changed nothing for it —, and nothing of ours asked Fansly;
// and with the neighbour's word filter (`+guard`): after our insert, a send
// with a restricted word is swallowed — no request, no `sent` — and the text is
// back, the next one goes. How MAIN tells a person's send and links it to our
// insert is suite-fansly-send-observe's (P7f); the keys next to it, suite-fansly-host's;
// the tap's frames mode by mode without our extension, suite-fansly-tap's;
// the stand's neighbour without us, fansly-stand-neighbor's.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import type { NeighborConfig } from '../../src/fake-fansly/neighbor/protocol';
import { setOptionalPermissionPrompts } from '../support/background';
import { MOD } from '../support/chat';
import { readReport } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { callNeighbor, neighborState, openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { FANSLY_MAIN, callFansly, fakeFansly, fanslyIds, fanslyStandServer, waitForFanslyStandIdle } from '../support/fansly-stand';
import { focusTab } from '../support/focus';
import { useNetworkTrap } from '../support/network-trap';
import { readOurs } from '../support/ours';
import { openOptions, press, waitForOptions } from '../support/pages';
import { dockIs } from '../support/shift';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

/** The modes of the neighbour (packages/testing/src/fake-fansly/neighbor, S5 §6) our whole extension must live next to. */
const MODES: ReadonlyArray<{ readonly label: string; readonly config: Partial<NeighborConfig> }> = [
  { label: 'off', config: { mode: 'off' } },
  { label: 'after', config: { mode: 'after' } },
  { label: 'after, its hook after the page’s first answer', config: { mode: 'after', timing: 'first-xhr' } },
  { label: 'before', config: { mode: 'before' } },
  { label: 'reinject', config: { mode: 'reinject', reinjectMs: 1500 } },
  { label: 'legacy', config: { mode: 'legacy' } },
  { label: 'before, its fan panel in the header', config: { mode: 'before', panel: 'mobile' } },
  { label: 'after, its fan panel beside the chat', config: { mode: 'after', panel: 'desktop' } },
  { label: 'a third party’s Proxy over the constructors', config: { mode: 'after', generic: 'proxy' } },
  { label: 'a third party’s subclass over the constructors', config: { mode: 'off', generic: 'subclass' } },
];

/** A call as the server answered it, as the neighbour's hook reported it: `METHOD path → status`. */
const line = (method: string, address: string, status: number): string => `${method} ${address} → ${status}`;

/** The page's own API calls since `since`, as the server journaled them (no CORS preflight: no XHR of the page). */
async function pageCalls(since: number): Promise<string[]> {
  return (await fakeFansly().calls('page', since)).filter((entry) => entry.method !== 'OPTIONS').map((entry) => line(entry.method ?? '', entry.path ?? '', entry.status ?? 0));
}

/** The page's API answers the neighbour's hook reported since `mark`. */
async function neighbourSaw(mark: number): Promise<string[]> {
  const api = fakeFansly().apiOrigin;
  return (await callNeighbor('log', mark))
    .filter((entry) => entry.kind === 'xhr' && entry.url.startsWith(`${api}/api/`))
    .map((entry) => line(entry.method, `${new URL(entry.url).pathname}${new URL(entry.url).search}`, entry.status));
}

const fieldValue = (): Promise<string> => browser.execute((selector: string) => document.querySelector<HTMLTextAreaElement>(selector)?.value ?? '', FANSLY_MAIN.field);
/** What the page's own model of the main composer holds (Angular's `ngModel`, the stand's journal of it). */
const modelValue = async (): Promise<string | null> => (await callFansly('composers')).find((composer) => composer.place === 'main' && composer.connected)?.model ?? null;

async function intoField(): Promise<void> {
  await $(FANSLY_MAIN.field).click();
  await browser.keys([MOD, 'a']);
  await browser.keys(Key.Backspace);
  await browser.waitUntil(async () => (await fieldValue()) === '', { timeout: 5000, timeoutMsg: 'Fansly’s field did not empty' });
}

/** Where our dock host stands: right before Fansly's composer in its container. */
const place = (): Promise<{ parent: string | null; next: string | null; hosts: number }> =>
  browser.execute(() => {
    const hosts = document.querySelectorAll('[data-host="dock"]');
    const host = hosts[0];
    return { parent: host?.parentElement?.localName ?? null, next: host?.nextElementSibling?.localName ?? null, hosts: hosts.length };
  });

/** A Reply of the open chat by its key, its first part inserted by Enter: the operation, and the text Fansly's field got. */
async function replyAndInsert(): Promise<{ readonly opId: string; readonly text: string }> {
  const before = (await readReport())?.dock?.result?.opId ?? null;
  await intoField();
  await browser.keys([MOD, 'e']);
  const done = await dockIs((d) => d.result !== null && d.result.opId !== before && d.result.state === 'done' && d.result.parts >= 1, 'a Reply of the open chat', 30_000);
  expect(await readOurs('dock', '[data-cg-part="0"]', (node) => (node.focus(), true))).toBe(true);
  await browser.keys(Key.Enter);
  await dockIs((d) => (d.result?.inserted ?? 0) >= 1, 'its first part inserted');
  await browser.waitUntil(async () => (await fieldValue()).length > 0, { timeout: 5000, timeoutMsg: 'the part did not reach Fansly’s field' });
  return { opId: done.result?.opId ?? '', text: await fieldValue() };
}

describe('our extension next to the FBuddy-like neighbour in every mode: tap, dock, insert (R20 P7i, FS-CO-4)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let ids: Ids;
  let group = '';
  let journalStart = 0;
  let shift: FanslyShift;

  /** The `ai_acceptance` lifecycles of `opId` the hub ingested since `mark`, in order. */
  const lifecycles = async (mark: number, opId: string): Promise<string[]> =>
    callsTo((await hub().journal(mark)).entries, 'ingestObservations')
      .filter((call) => call.status === 200)
      .flatMap((call) => (call.request as { events: Array<{ kind: string; payload: { lifecycle: string; opId: string } }> }).events)
      .filter((event) => event.kind === 'ai_acceptance' && event.payload.opId === opId)
      .map((event) => event.payload.lifecycle);

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: '/messages', settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    ids = await fanslyIds();
    group = String(ids.groups[1]);
    // The person allows the technical measurements on the settings page (ST-034): `sent` leaves the browser only then.
    await shift.toPages();
    await setOptionalPermissionPrompts(false);
    await openOptions('status');
    await waitForOptions((state) => state.rows['consent']?.level === 'warn', 'the consent row asks');
    await press('Разрешить замеры', '[data-pg-row="consent"]');
    await waitForOptions((state) => state.rows['consent']?.level === 'ok', 'the consent is on');
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
  });

  after(async () => {
    await setOptionalPermissionPrompts(null);
    expect((await fanslyStandServer.journal(journalStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
  });

  for (const { label, config } of MODES) {
    it(`[FS-CO-4] next to the neighbour (${label}): our tap and our dock before Fansly’s composer, its widgets after the actions; a Reply’s part inserted — the page’s model has it — and sent by the person: the hub hears \`sent\`; the neighbour saw the page’s answers as served; nothing of ours asked Fansly`, async () => {
      const fake = fakeFansly();
      const hooked = config.mode !== 'off';
      await openWithNeighbor(`/messages/${group}`, config);
      if (hooked) await waitForNeighborComposer();
      await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, `our dock next to the neighbour (${label})`, 20_000);
      await focusTab();
      const report = await readReport();
      // Our tap: MAIN answered through the bridge (and its observation named the open chat: the dock is ready for it).
      expect([report?.main !== undefined, report?.mainError]).toEqual([true, undefined]);
      expect(await place()).toEqual({ parent: 'app-group-message-container', next: 'app-group-message-input', hosts: 1 });
      await waitForFanslyStandIdle();
      const since = await fake.mark();
      const logMark = hooked ? ((await callNeighbor('log')).at(-1)?.seq ?? 0) : 0;

      const { opId, text: inserted } = await replyAndInsert();
      expect(inserted.trim().length).toBeGreaterThan(0);
      await browser.waitUntil(async () => (await modelValue()) === inserted, { timeout: 5000, timeoutMsg: `the page’s model holds «${String(await modelValue())}», not the inserted part` });
      // The person sends it with Enter in Fansly's field (the insert left the focus there): Fansly's own request, and
      // our part's `sent` for the hub — the send seen by MAIN, taken for known by Fansly's own rule (`human-send`).
      const hubMark = await hub().mark();
      await browser.keys(Key.Enter);
      await browser.waitUntil(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), { timeout: 10_000, timeoutMsg: 'the person’s send' });
      await browser.waitUntil(async () => (await lifecycles(hubMark, opId)).includes('sent'), { timeout: 15_000, interval: 250, timeoutMsg: `the hub was not told «sent» of ${opId} (${label})` });
      // The neighbour is where it was: its widgets after the composer's actions, its hooks on (a reinject re-installs them).
      if (hooked) {
        await waitForNeighborComposer();
        expect((await neighborState()).hook.installs).toBeGreaterThan(0);
      }
      await waitForFanslyStandIdle();
      await fake.assertOursClean(since, `next to the neighbour (${label})`);
      if (hooked) expect((await neighbourSaw(logMark)).sort()).toEqual((await pageCalls(since)).sort());
      await intoField();
    });
  }

  it('[FS-CO-4] +guard: after our insert, a send with a restricted word is swallowed by the neighbour’s filter — no request, no `sent` — and the text is back in the field; the next message goes', async () => {
    const fake = fakeFansly();
    await openWithNeighbor(`/messages/${group}`, { mode: 'after', guard: ['forbidden'] });
    await browser.waitUntil(async () => (await neighborState()).guard.active, { timeout: 10_000, timeoutMsg: 'its guard' });
    await waitForNeighborComposer();
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'our dock next to the guarded neighbour', 20_000);
    await focusTab();
    const { opId, text: inserted } = await replyAndInsert();
    const since = await fake.mark();
    const hubMark = await hub().mark();
    // The person adds a restricted word to our part and sends: the neighbour's filter swallows it.
    await browser.keys([Key.End, ...' forbidden'.split('')]);
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await neighborState()).guard.restored === 1, { timeout: 10_000, timeoutMsg: 'the text written back' });
    await browser.pause(300);
    expect((await fake.calls('page', since)).filter((entry) => entry.route === 'message.send')).toEqual([]);
    expect(await fieldValue()).toBe(`${inserted} forbidden`);
    // Cleaned by the person, the next one goes.
    await intoField();
    await browser.keys('all clean'.split(''));
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await fake.calls('page', since)).some((entry) => entry.route === 'message.send' && entry.status === 200), { timeout: 10_000, timeoutMsg: 'the clean send' });
    // Neither send was our part's: the swallowed one never went, the next is the person's own text. The telemetry
    // queue leaves a second after its first event — by then whatever was to be told has been told.
    await browser.pause(2500);
    expect(await lifecycles(hubMark, opId)).not.toContain('sent');
    await fake.assertOursClean(since, 'next to the guarded neighbour');
  });
});
