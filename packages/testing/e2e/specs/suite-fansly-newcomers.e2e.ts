// «Новые» on Fansly in Firefox (R20; docs/project-unite/architecture.md §8.7, §8.15; FS-NEW-*; plan.md §3
// `suite-fansly-newcomers`): the extension's test build on the Fansly stand against the fake hub, a chatter signed in,
// the Fansly page's own switches on (`newcomers` among them).
// - P10a — the window: the popup's «Новые» opens Fansly's own window over the background's pass (Fansly's boards and
//   its `newcomers` chunk, never the hub's list of ChatSpace); until the background serves the pass (P10b1) it asks
//   for it once and says the list was not read — never that nobody followed (FX-017); Esc closes it; nothing of ours
//   asks the Fansly stand or the hub for the list.
// The pass, «Нельзя написать», the three admissions of a greeting, two clients and the person's own send are the
// blocks of P10b1…P10d.

import { browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { WORLD } from '../../src/scenarios/hub';
import { pageRpc } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { fakeFansly, fanslyStandServer } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, oursText, waitOursText } from '../support/ours';
import { dockIs } from '../support/shift';

const A = WORLD.fansly.chats.a;
const WINDOW = '.cg-fnw';

async function picture(name: string): Promise<void> {
  mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
  await browser.saveScreenshot(`${E2E_EVIDENCE_DIR}suite-fansly-newcomers-${name}.png`);
}

describe('[host:fansly] «Новые» on Fansly — the window over the background’s pass (R20 P10a)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: FanslyShift;
  let standStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    standStart = await fanslyStandServer.mark();
    shift = await startFanslyShift(hub(), { path: `/messages/${A.group}`, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${A.fan}`) === true, 'the dock of the first Fansly chat, ready', 20_000);
  });

  after(async () => {
    // Nothing of the extension asked the Fansly stand for anything (the page's own calls go to the fake Fansly).
    expect((await fanslyStandServer.journal(standStart)).filter((entry) => entry.origin !== 'asset')).toEqual([]);
  });

  it('[NF-001] [NF-002] [FX-017] the popup’s «Новые» opens Fansly’s own window; the background does not serve the pass yet — «Список не загружен», never «nobody new»; Esc closes it', async () => {
    const mark = await hub().mark();
    // The popup's click: `tab.command` is the popup's (and the settings') own request.
    await shift.toPages();
    await browser.url(testBuildPage('popup.html'));
    expect(await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } })).toEqual({ ok: true, payload: { delivered: true } });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toFansly();
    await waitOursText('modal', 'Список не загружен', 'Fansly’s window says the list was not read', { timeout: 20_000, selector: WINDOW });
    // After the window's entrance (≤ 150 ms, ui-design §2.9).
    await browser.pause(400);
    await picture('failed');
    const text = await oursText('modal', WINDOW);
    expect(text).toMatch(/ChatGoose · CG-RUNTIME-UNREACHABLE/);
    expect(text).toMatch(/«Fansly через вкладку»/);
    expect(text).not.toMatch(/новых фоловеров нет/i);
    expect(await oursExists('modal', `${WINDOW} [data-cg-list="failed"]`)).toBe(true);
    // Fansly's window, not the hub's list of ChatSpace: nothing of «Новые» is asked of the hub.
    const { entries } = await hub().journal(mark);
    expect(entries.filter((entry) => entry.route === 'clientAudienceNew' || entry.route === 'clientFanClaim')).toEqual([]);

    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await oursExists('modal', WINDOW)), { timeout: 5_000, timeoutMsg: 'Esc did not close «Новые»' });
  });
});
