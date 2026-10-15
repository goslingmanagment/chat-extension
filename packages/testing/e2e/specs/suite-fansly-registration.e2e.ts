// P11a: the actual MV3 extension, the page's XHR/MAIN and the background's
// real API/pacer, all on loopback. A valid oversized group answer is read by
// the page but not MAIN: this exercises the genuine unknown-fan fallback.
import type { DiagnosticsSnapshot } from '@cg/contracts/tab-messages';
import { mkdirSync } from 'node:fs';
import { $, $$, browser, expect } from '@wdio/globals';
import { WORLD } from '../../src/scenarios/hub';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { writeLocalStorage } from '../support/extension';
import { useFakeHub } from '../support/fake-hub';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, waitForFanslyStandIdle } from '../support/fansly-stand';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, readOurs } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const B = WORLD.fansly.chats.b;
const SLOT = '[data-header-order="10"]';
const control = () => $(SLOT).shadow$('.cg-reg');
const button = () => $(SLOT).shadow$('button');
const state = async () => (await $(SLOT).isExisting()) ? control().getAttribute('data-registration') : null;
const waitState = (expected: string) => browser.waitUntil(async () => (await state()) === expected, { timeout: 20_000, timeoutMsg: `registration did not become ${expected}` });
const dateOf = (id: string) => new Date(Number(BigInt(id) >> 22n) + 1561494360000).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });

describe('Fansly registration in the header (R20 P11a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let mark = 0;
  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, neighbor: { mode: 'after', panel: 'mobile' }, viewport: { width: 1180, height: 850 } });
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${A.fan}`) === true, 'known fan', 20_000);
    await waitState('idle');
    await shift.toPages();
    await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
    await shift.toFansly();
    mark = await fakeFansly().mark();
  });
  after(async () => {
    try { await fakeFansly().assertOursClean(mark, 'P11a'); }
    finally { await fakeFansly().command({ op: 'reset' }); }
  });

  it('[FX-002] [FS-REG-1] [FS-REG-2] follows Gallery; a known account snowflake needs no request', async () => {
    expect(await browser.execute((selector) => {
      const host = document.querySelector(selector);
      return host?.parentElement?.classList.contains('content-header-sub-row') && host.previousElementSibling?.classList.contains('gallery-hot-icon');
    }, SLOT)).toBe(true);
    await button().click(); await waitState('shown');
    expect(await control().getText()).toContain(dateOf(A.fan));
    expect(dateOf(A.fan)).not.toBe(dateOf(A.group));
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
  });

  it('[FS-REG-3] keeps the answer on A → B → inbox → A; reload clears it; screenshots in both themes', async () => {
    await callFansly('open', B.group, 'router'); await waitState('idle');
    await callFansly('openInbox');
    await browser.waitUntil(async () => !(await $(SLOT).isExisting()));
    await callFansly('open', A.group, 'router'); await waitState('shown');
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    for (const theme of ['bright', 'dark'] as const) {
      await callFansly('setTheme', theme);
      await browser.waitUntil(async () => (await $(SLOT).getAttribute('data-scheme')) === (theme === 'bright' ? 'light' : 'dark'));
      await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}/suite-fansly-registration-${theme}.png`);
    }
    await browser.refresh(); await waitState('idle');
    await button().click(); await waitState('shown');
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
  });

  it('[FS-REG-3] [FS-REG-4] contact rebuilt at the same address: only direct chats; survives panel=mobile and its nodes', async () => {
    const url = await browser.getUrl();
    // Angular's branch replaced with a fresh node, retaining its own listeners
    // is unnecessary here: only its contact slot is under test.
    await browser.execute(() => {
      const contact = document.querySelector('.message-content-header-contact');
      if (!contact) throw new Error('no contact');
      const copy = contact.cloneNode(true) as Element;
      copy.querySelectorAll('[data-header-order]').forEach((node) => node.remove());
      contact.replaceWith(copy);
    });
    await waitState('shown'); expect(await browser.getUrl()).toBe(url);
    expect(await $$(SLOT).length).toBe(1);
    await callFansly('setPartners', A.group, 2);
    await browser.waitUntil(async () => !(await $(SLOT).isExisting()));
    await callFansly('setPartners', A.group, 1); await waitState('shown');
    await callFansly('setGallery', true);
    await browser.waitUntil(async () => !(await $(SLOT).isExisting()));
    await callFansly('setGallery', false); await waitState('shown');
    expect(await fakeFansly().calls('ours', mark)).toEqual([]);
  });

  it('[FS-REG-4] a missing header anchor is reported broken while the panel retains the date', async () => {
    await browser.execute(() => document.querySelector('.message-content-header-contact')?.remove());
    await browser.waitUntil(async () => !(await $(SLOT).isExisting()));
    await browser.waitUntil(async () => {
      const diagnostic = await shift.rpc<DiagnosticsSnapshot>('diagnostics.get');
      return diagnostic.ok && diagnostic.payload.tabs.some((tab) => tab.host?.host === 'fansly-web' && tab.host.extensions?.['fansly-web']?.capabilities.headerSlot?.state === 'contractBroken');
    }, { timeout: 15_000, timeoutMsg: 'missing header not reported in Status' });
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    await browser.keys([']']);
    await browser.waitUntil(() => oursExists('panel', '[data-registration-date]'), { timeout: 15_000 });
    const at = await readOurs('panel', '[data-registration-date]', (node) => node.getAttribute('data-registration-date'));
    expect(at).toBe(new Date(Number(BigInt(A.fan) >> 22n) + 1561494360000).toISOString());
    await browser.keys(['Escape']);
  });

  async function unknownFan(): Promise<void> {
    // Both ways the page can teach MAIN the group are too large for the
    // passive tap, but valid JSON for the page. The account/me stays normal.
    await fakeFansly().command({ op: 'api', rules: ['group.detail', 'messaging.groups'].map((route) => ({ route, caller: 'page' as const, paddingChars: 1_100_000, outcome: { kind: 'delay' as const, ms: 0 } })) });
    await browser.refresh(); await waitState('idle');
    await waitForFanslyStandIdle();
  }

  it('[FS-REG-2] unknown fan: one real GET of this GROUP, with no follow-up account or history request', async () => {
    await unknownFan();
    const before = await fakeFansly().mark();
    await button().click(); await waitState('shown');
    expect(await control().getText()).toContain(dateOf(A.fan));
    const calls = await fakeFansly().calls('ours', before);
    expect(calls.map((call) => call.route)).toEqual(['group.detail']);
    expect(calls[0]?.path).toContain(`/group/${A.group}/`);
    await callFansly('openInbox'); await callFansly('open', A.group, 'router'); await waitState('shown');
    expect((await fakeFansly().calls('ours', before)).length).toBe(1);
  });

  it('[FS-REG-2] a 500 is not retried; a 429 cools the next explicit click before any network', async () => {
    await unknownFan();
    const before = await fakeFansly().mark();
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'status', status: 500 } }] });
    await button().click(); await waitState('failed');
    expect((await fakeFansly().calls('ours', before)).map((call) => call.status)).toEqual([500]);
    await fakeFansly().command({ op: 'api', rules: [{ route: 'group.detail', caller: 'ours', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 60 } }] });
    await button().click();
    await browser.waitUntil(async () => (await control().getText()).includes('паузу'));
    await button().click(); await waitState('failed');
    expect((await fakeFansly().calls('ours', before)).map((call) => call.status)).toEqual([500, 429]);
  });
});
