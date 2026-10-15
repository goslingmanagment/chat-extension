// R20 P3b — the release gate's check of SIGNED builds (docs/project-unite/
// spike.md «Что должен проверить P3b», items 1–5; «P3b: как прогнать»): how
// Firefox treats the release build of this tree when it is signed, installed
// permanently, updated by Firefox's own update check, restarted and granted
// Fansly — what a temporary install on the stand (P3a, P9a) cannot show.
//
// Input: the test builds of `pnpm release test-builds` (a separate test add-on,
// tools/release/test-builds.ts), as signed by the owner's
// `pnpm release sign --test-builds`:
//   CG_P3B_XPI_N, CG_P3B_XPI_N1, CG_P3B_XPI_CONTROL   paths (relative to the repository root, or absolute)
//   CG_P3B_XPI_N0 (optional)                          the build before Fansly: the update N0 → N adds its permissions
// Without them the spec skips, saying so: CI never has them. With the same
// builds UNSIGNED (the set's own XPIs) and CG_P3B_UNSIGNED=1 it runs as a
// stand-in: the same steps in a Firefox told it is under automation, which
// lets a release build install an unsigned add-on permanently
// (support/p3b.ts). What only signed builds exercise is listed in the report.
//
// The world: the Fansly-like page and the fake Fansly under fansly.com,
// apiv3.fansly.com and wsv3.fansly.com, reached through our own proxy and TLS
// front, an update feed on loopback, nothing else (src/p3b/world.ts). Each
// Firefox is its own, with a profile folder that survives a restart. The
// measurements go to .cache/e2e/p3b-report.json and to the log.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { expect } from '@wdio/globals';

import type { SiteAccessState } from '@cg/contracts/site-access';

import { P3B_PAGE_ORIGIN, SECOND_ACCOUNT, startP3bWorld, type P3bWorld } from '../../src/p3b/world';
import { withoutSignature, xpiFacts } from '../../src/p3b/xpi';
import { E2E_EVIDENCE_DIR, REPO_ROOT } from '../../src/stand/paths';
import { backgroundState, suspendBackground } from '../support/background';
import { pageRpc } from '../support/extension';
import { registeredScripts } from '../support/fansly-site';
import { callFansly, fanslyIds, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import {
  actionPopupOpen,
  actionPopupRect,
  addonView,
  allowPrompt,
  armRecorder,
  backgroundUpdateCheck,
  attention,
  chrome,
  declaresFansly,
  clearAutomationEnv,
  clickInWindow,
  fanslyScripts,
  findTab,
  installPermanently,
  openActionPopup,
  P3B_GECKO_ID,
  p3bPage,
  pageProbe,
  pendingInstalls,
  prompts,
  recorded,
  startP3bBrowser,
  stopRecorder,
  type RecordedEvent,
} from '../support/p3b';
import { grantOptional, revokeOptional } from '../support/permissions';
import { inBrowser } from '../support/second';

type Role = 'n' | 'n1' | 'control';
const ENV: Readonly<Record<Role, string>> = { n: 'CG_P3B_XPI_N', n1: 'CG_P3B_XPI_N1', control: 'CG_P3B_XPI_CONTROL' };
/** Optional: the build before Fansly (tools/release/test-builds.ts N0); without it the update that adds the permissions is not checked. */
const ENV_N0 = 'CG_P3B_XPI_N0';
const FANSLY_ORIGINS = ['https://fansly.com/*', 'https://apiv3.fansly.com/*'];
const PAGE = `${P3B_PAGE_ORIGIN}/messages`;

interface Inputs {
  readonly signed: boolean;
  readonly xpi: Readonly<Record<Role, string>> & { readonly n0?: string };
  readonly version: Readonly<Record<Role, string>> & { readonly n0?: string };
}

/** The inputs, or why the spec cannot run: null reason — run. */
function readInputs(): { readonly inputs: Inputs | null; readonly skip: string | null; readonly invalid: string | null } {
  const given = (Object.keys(ENV) as Role[]).filter((role) => (process.env[ENV[role]] ?? '') !== '');
  if (given.length === 0) return { inputs: null, skip: `${Object.values(ENV).join(', ')} are not set — the owner’s signed test builds are the input (docs/project-unite/spike.md «P3b: как прогнать»)`, invalid: null };
  if (given.length < 3) return { inputs: null, skip: null, invalid: `all three of ${Object.values(ENV).join(', ')} are needed, ${given.map((role) => ENV[role]).join(', ')} given` };
  const xpi: Record<string, string> = {};
  const version: Record<string, string> = {};
  const signed: boolean[] = [];
  const roles: Array<readonly [string, string]> = [...(Object.keys(ENV) as Role[]).map((role) => [role, ENV[role]] as const), ...((process.env[ENV_N0] ?? '') === '' ? [] : [['n0', ENV_N0] as const])];
  for (const [role, name] of roles) {
    const raw = process.env[name] ?? '';
    const path = isAbsolute(raw) ? raw : join(REPO_ROOT, raw);
    if (!existsSync(path)) return { inputs: null, skip: null, invalid: `${name}: no file ${path}` };
    const facts = xpiFacts(readFileSync(path));
    if (facts.id !== P3B_GECKO_ID || facts.version === null) return { inputs: null, skip: null, invalid: `${name}: ${path} is not a test build of ${P3B_GECKO_ID} (id ${String(facts.id)})` };
    xpi[role] = path;
    version[role] = facts.version;
    signed.push(facts.signed);
  }
  const all = signed.every(Boolean);
  if (!all && signed.some(Boolean)) return { inputs: null, skip: null, invalid: 'some of the XPIs are signed and some are not' };
  if (!all && process.env['CG_P3B_UNSIGNED'] !== '1') return { inputs: null, skip: null, invalid: 'the XPIs are not signed: a stand-in run of unsigned builds needs CG_P3B_UNSIGNED=1' };
  return { inputs: { signed: all, xpi: xpi as Inputs['xpi'], version: version as Inputs['version'] }, skip: null, invalid: null };
}

const read = readInputs();

interface Report {
  mode: 'signed' | 'unsigned stand-in';
  firefox: string | null;
  versions: Readonly<Record<Role, string>> | null;
  /** What only a signed build exercises: not checked by a stand-in run. */
  signedOnly: readonly string[];
  checks: Record<string, unknown>;
}

const SIGNED_ONLY = [
  'Firefox verifies Mozilla’s signature at the install of N, at the download of each update (N+1, the control) and at every start (signedState 2); a stand-in has signedState 0',
  'the unsigned copy of N is refused (ERROR_SIGNEDSTATE_REQUIRED): the run’s Firefox requires signatures, with no automation switch',
  'every step runs in a Firefox that is NOT under automation (Cu.isInAutomation false): no automation-only behaviour of the add-on manager or the prompts is in play',
];

/** What a page tab saw (src/p3b/world.ts PROBE_SCRIPT): our MAIN before the page's first script — both constructors already ours. */
const oursFirst = (probe: Awaited<ReturnType<typeof pageProbe>>): boolean | null =>
  probe.start === null ? null : probe.start.nativeWebSocket === false && probe.start.nativeXhr === false;

function firstAt(events: readonly RecordedEvent[], kind: string, version?: string): number | null {
  return events.find((event) => event.kind === kind && (version === undefined || event.version === version))?.at ?? null;
}
const since = (at: number | null, from: number | null): number | null => (at === null || from === null ? null : at - from);

if (read.skip !== null) {
  console.log(`p3b: skipped — ${read.skip}`);
  describe('P3b: signed test builds (spike.md items 1–5)', () => {
    it(`is skipped: ${read.skip}`, function () {
      this.skip();
    });
  });
} else {
  describe('P3b: signed test builds — update, restart, grant, wake-ups (spike.md items 1–5)', () => {
    const inputs = read.inputs;
    let world: P3bWorld | null = null;
    let profiles = '';
    const sessions: WebdriverIO.Browser[] = [];
    const report: Report = { mode: inputs?.signed === false ? 'unsigned stand-in' : 'signed', firefox: null, versions: inputs?.version ?? null, signedOnly: inputs?.signed === true ? [] : SIGNED_ONLY, checks: {} };

    const need = (): { readonly inputs: Inputs; readonly world: P3bWorld } => {
      if (read.invalid !== null || inputs === null) throw new Error(`P3b inputs: ${read.invalid ?? 'none'}`);
      if (world === null) throw new Error('the P3b world did not start');
      return { inputs, world };
    };
    const start = async (profile: string): Promise<WebdriverIO.Browser> => {
      const { inputs: given, world: here } = need();
      // geckodriver writes its prefs into the folder before Firefox starts: it has to be there.
      mkdirSync(join(profiles, profile), { recursive: true });
      const instance = await startP3bBrowser(here, { profile: join(profiles, profile), unsigned: !given.signed });
      sessions.push(instance);
      report.firefox ??= String((instance.capabilities as { browserVersion?: string }).browserVersion ?? '');
      return instance;
    };
    const quit = async (instance: WebdriverIO.Browser): Promise<void> => {
      sessions.splice(sessions.indexOf(instance), 1);
      await instance.deleteSession();
    };
    /** The add-on's own page in a new tab of `instance`, the session switched to it. */
    const openPage = async (instance: WebdriverIO.Browser, url: string): Promise<string> => {
      await instance.newWindow(url);
      return instance.getWindowHandle();
    };
    const access = async (): Promise<SiteAccessState> => {
      const answer = await pageRpc<SiteAccessState>('site.access', { host: 'fansly-web' });
      if (!answer.ok) throw new Error(`site.access: ${answer.error.code}`);
      return answer.payload;
    };
    const session = async (instance: WebdriverIO.Browser): Promise<{ templates: Array<{ legacyId: string; headers: Record<string, string>; checks: Record<string, string> }>; tabs: Array<[number, string]> } | null> =>
      instance.execute(async () => {
        const api = (globalThis as unknown as { browser: { storage: { session: { get(key: string): Promise<Record<string, unknown>> } } } }).browser;
        return ((await api.storage.session.get('fansly.session'))['fansly.session'] ?? null) as never;
      });

    before(async () => {
      if (read.invalid !== null) throw new Error(`P3b inputs: ${read.invalid}`);
      profiles = mkdtempSync(join(tmpdir(), 'cg-p3b-profiles-'));
      world = await startP3bWorld();
      console.log(`p3b: ${report.mode} run of ${JSON.stringify(inputs?.version)}`);
    });

    after(async () => {
      for (const instance of [...sessions]) await quit(instance).catch(() => undefined);
      clearAutomationEnv();
      report.checks['egress'] = world?.egress() ?? [];
      await world?.close();
      if (profiles !== '') rmSync(profiles, { recursive: true, force: true });
      mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(E2E_EVIDENCE_DIR, 'p3b-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`p3b report (${join(E2E_EVIDENCE_DIR, 'p3b-report.json')}):\n${JSON.stringify(report, null, 2)}`);
    });

    it('[P3b] signatures: N is installed signed; the same build without the signature is refused', async function () {
      const { inputs: given } = need();
      const browser = await start('signatures');
      const automation = await chrome<boolean>(browser, 'return Cu.isInAutomation;');
      await installPermanently(browser, given.xpi.n);
      const view = await addonView(browser);
      report.checks['signatures'] = { automation, signedState: view?.signedState ?? null };
      expect(view?.version).toBe(given.version.n);
      expect(view?.temporary).toBe(false);
      if (!given.signed) {
        expect(automation).toBe(true);
        expect(view?.signedState).toBe(0);
        await quit(browser);
        this.skip();
      }
      expect(automation).toBe(false);
      expect(view?.signedState).toBe(2);
      // The same Firefox, the same profile: the build without Mozilla's signature does not install.
      const stripped = join(profiles, 'n-unsigned.xpi');
      writeFileSync(stripped, withoutSignature(readFileSync(given.xpi.n)));
      await expect(installPermanently(browser, stripped)).rejects.toThrow(/ERROR_SIGNEDSTATE_REQUIRED/);
      await quit(browser);
    });

    describe('item 1 — the updates N0 → N (adds the optional Fansly hosts and webRequest) and N → N+1', () => {
      let browser: WebdriverIO.Browser;
      let pageTab = '';

      /** Firefox's own update check offered `role`: applied at once, no prompt, nothing of Fansly granted, no attention dot. */
      const updateTo = async (role: 'n' | 'n1'): Promise<void> => {
        const { inputs: given, world: here } = need();
        const version = given.version[role];
        here.offer(P3B_GECKO_ID, { version, file: given.xpi[role] });
        await armRecorder(browser);
        const asked = await backgroundUpdateCheck(browser);
        await browser.waitUntil(async () => (await addonView(browser))?.version === version, { timeout: 30_000, interval: 100, timeoutMsg: `${version} was not applied within 30 s of the update check` });
        await browser.waitUntil(async () => (await addonView(browser))?.background === 'running', { timeout: 15_000, interval: 100 });
        const events = await recorded(browser);
        await stopRecorder(browser);
        here.offer(P3B_GECKO_ID, null);
        await browser.switchToWindow(pageTab);
        const after = { view: await addonView(browser), attention: await attention(browser), pending: await pendingInstalls(browser), declared: await declaresFansly(browser) };
        report.checks[`item1.update.${role}`] = {
          applyMs: since(firstAt(events, 'version', version), asked),
          installStartedMs: since(firstAt(events, 'onInstallStarted'), asked),
          prompts: events.filter((event) => event.kind.endsWith('permission-prompt')).map((event) => event.kind),
          postponed: events.some((event) => event.kind === 'onInstallPostponed'),
          pending: after.pending,
          declaresFansly: after.declared,
          granted: after.view?.granted,
          reaches: after.view?.reaches,
          attention: after.attention,
          feed: here.feedStats(),
        };
        expect(events.filter((event) => event.kind.endsWith('permission-prompt'))).toEqual([]);
        expect(events.some((event) => event.kind === 'onInstallPostponed')).toBe(false);
        expect(after.pending).toEqual([]);
        expect(after.view?.startupReason).toBe('ADDON_UPGRADE');
        // The new version asks for Fansly on request; nothing of it is granted, and nothing points at fansly.com.
        expect(after.declared).toBe(true);
        expect(after.view?.granted.origins.filter((origin) => FANSLY_ORIGINS.includes(origin))).toEqual([]);
        expect(after.view?.granted.permissions).not.toContain('webRequest');
        expect(after.view?.reaches).toEqual({ page: false, api: false });
        expect(after.attention).toMatchObject({ url: PAGE, attention: false, button: false });
      };

      it('[P3b-1] N0 → N, the update that ADDS the optional hosts and webRequest (a chatter’s 0.2.x → Fansly): applied at once, no prompt, nothing granted, no attention dot', async function () {
        const { inputs: given } = need();
        browser = await start('item1');
        pageTab = await openPage(browser, PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
        const first = given.xpi.n0 ?? given.xpi.n;
        await installPermanently(browser, first);
        // A fresh install opens the onboarding (settings) in a tab of its own.
        expect(await findTab(browser, '/options.html')).not.toBeNull();
        await browser.switchToWindow(pageTab);
        const before = { view: await addonView(browser), attention: await attention(browser), declared: await declaresFansly(browser) };
        expect(before.attention).toMatchObject({ url: PAGE, attention: false });
        if (given.xpi.n0 === undefined) {
          report.checks['item1.update.n'] = `skipped: CG_P3B_XPI_N0 is not set — the run starts at N`;
          this.skip();
        }
        expect(before.view?.version).toBe(given.version.n0);
        expect(before.declared).toBe(false);
        await updateTo('n');
      });

      it('[P3b-1] N → N+1: applied at once, no prompt, no postponing; nothing of Fansly granted; no attention dot on fansly.com', async () => {
        const { inputs: given } = need();
        expect((await addonView(browser))?.version).toBe(given.version.n);
        await updateTo('n1');
      });

      it('[P3b-1] the control with the hosts in host_permissions: the same update asks nothing either, grants nothing, and puts the attention dot on fansly.com; a new install would hold fansly.com at once', async () => {
        const { inputs: given, world: here } = need();
        here.offer(P3B_GECKO_ID, { version: given.version.control, file: given.xpi.control });
        await armRecorder(browser);
        const asked = await backgroundUpdateCheck(browser);
        let applied = true;
        try {
          await browser.waitUntil(async () => (await addonView(browser))?.version === given.version.control, { timeout: 30_000, interval: 100 });
        } catch {
          applied = false;
        }
        const events = await recorded(browser);
        await stopRecorder(browser);
        await browser.switchToWindow(pageTab);
        const after = { view: await addonView(browser), attention: await attention(browser), pending: await pendingInstalls(browser) };
        // A fresh profile: the control installed first, as a new chatter would get it.
        const fresh = await start('item1-control-fresh');
        await installPermanently(fresh, given.xpi.control);
        const freshView = await addonView(fresh);
        await quit(fresh);
        report.checks['item1.control'] = {
          applied,
          applyMs: since(firstAt(events, 'version', given.version.control), asked),
          prompts: events.filter((event) => event.kind.endsWith('permission-prompt')).map((event) => ({ kind: event.kind, detail: event.detail })),
          pending: after.pending,
          granted: after.view?.granted,
          reaches: after.view?.reaches,
          attention: after.attention,
          freshInstall: { granted: freshView?.granted, reaches: freshView?.reaches },
        };
        here.offer(P3B_GECKO_ID, null);
        await quit(browser);
        // The positive control of the checks above: hosts in the manifest are what they would have caught.
        expect(applied).toBe(true);
        expect(after.view?.reaches.page).toBe(false);
        expect(after.attention).toMatchObject({ url: PAGE, attention: true });
        expect(freshView?.reaches).toEqual({ page: true, api: true });
      });
    });

    describe('items 4, 2, 5, 3 — one chatter’s Firefox: «Включить Fansly», the real update, the wake-up chains, a restart', () => {
      let browser: WebdriverIO.Browser;
      let fanslyTab = '';
      let pagesTab = '';

      const clickEnable = async (): Promise<void> => {
        const button = browser.$('.pg-site-access button');
        await button.waitForDisplayed({ timeout: 15_000 });
        await browser.waitUntil(async () => (await button.getAttribute('aria-busy')) !== 'true', { timeout: 10_000 });
        await button.click();
      };
      const waitPrompt = async (what: string): Promise<readonly { url: string; lines: readonly string[] }[]> => {
        await browser.waitUntil(async () => (await prompts(browser)).length > 0, { timeout: 15_000, interval: 100, timeoutMsg: `no permission prompt after «Включить Fansly» ${what}` });
        await browser.pause(300);
        return prompts(browser);
      };
      const optionalPrompts = (events: readonly RecordedEvent[]): readonly RecordedEvent[] => events.filter((event) => event.kind === 'webextension-optional-permission-prompt');
      const registeredWithin = async (ms: number, message: string): Promise<void> => {
        await browser.waitUntil(async () => {
          const view = await addonView(browser);
          return view !== null && view.scripts.includes('fansly-main.js') && view.scripts.includes('fansly.js');
        }, { timeout: ms, interval: 100, timeoutMsg: message });
      };
      const revoke = async (): Promise<void> => {
        await inBrowser(browser, () => revokeOptional({ origins: FANSLY_ORIGINS, permissions: ['webRequest'] }, P3B_GECKO_ID));
        await browser.waitUntil(async () => fanslyScripts(await addonView(browser)).length === 0, { timeout: 10_000, timeoutMsg: 'the registrations stayed after the revocation' });
      };

      it('[P3b-4] «Включить Fansly» in the settings: ONE prompt with both addresses and webRequest; on «Allow» the background registers MAIN then ISOLATED and notices the open tab', async () => {
        const { inputs: given } = need();
        browser = await start('chatter');
        fanslyTab = await openPage(browser, PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
        await installPermanently(browser, given.xpi.n);
        expect(oursFirst(await pageProbe(browser))).toBe(false);
        // The onboarding the install opened: the settings, where the person switches Fansly on.
        const onboarding = await findTab(browser, '/options.html');
        expect(onboarding).not.toBeNull();
        pagesTab = onboarding ?? '';
        await armRecorder(browser);
        await clickEnable();
        const shown = await waitPrompt('in the settings');
        const asked = optionalPrompts(await recorded(browser));
        expect(await allowPrompt(browser)).toBe(1);
        await registeredWithin(15_000, 'not registered after «Allow»');
        const events = await recorded(browser);
        await stopRecorder(browser);
        const order = await inBrowser(browser, () => registeredScripts());
        const state = await inBrowser(browser, () => access());
        report.checks['item4.options'] = { prompts: shown, asked: asked.map((event) => event.detail), registeredMs: since(firstAt(events, 'registered'), asked[0]?.at ?? null), state };
        expect(shown).toHaveLength(1);
        expect(asked).toHaveLength(1);
        expect(asked[0]?.detail).toEqual({ addon: P3B_GECKO_ID, permissions: { origins: FANSLY_ORIGINS, permissions: ['webRequest'] } });
        expect(order.filter((script) => script.id.startsWith('fansly')).map((script) => [script.id, script.world, script.runAt])).toEqual([
          ['fansly-main', 'MAIN', 'document_start'],
          ['fansly', 'ISOLATED', 'document_start'],
        ]);
        expect(state).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: 1 });
        await browser.switchToWindow(fanslyTab);
        await browser.waitUntil(async () => (await pageProbe(browser)).notice !== null, { timeout: 10_000, timeoutMsg: 'no reload notice in the tab open before the grant' });
      });

      it('[P3b-4] the same from the popup page: one prompt, registered', async () => {
        await browser.switchToWindow(pagesTab);
        await revoke();
        await browser.url(p3bPage('popup.html'));
        await armRecorder(browser);
        await clickEnable();
        const shown = await waitPrompt('in the popup page');
        const asked = optionalPrompts(await recorded(browser));
        expect(await allowPrompt(browser)).toBe(1);
        await registeredWithin(15_000, 'not registered after «Allow» from the popup page');
        await stopRecorder(browser);
        report.checks['item4.popupPage'] = { prompts: shown.length, asked: asked.map((event) => event.detail) };
        expect(shown).toHaveLength(1);
        expect(asked).toHaveLength(1);
      });

      it('[P3b-4] the real toolbar popup: it closes while Firefox asks and the background sleeps; «Allow» alone finishes the switch-on (onAdded) and notices the open tab', async () => {
        await browser.switchToWindow(pagesTab);
        await revoke();
        // The Fansly tab open across the grant: a document of its own without our scripts and without a notice yet.
        await browser.switchToWindow(fanslyTab);
        await browser.refresh();
        await inBrowser(browser, () => waitForFanslyStandReady());
        expect(await pageProbe(browser)).toMatchObject({ notice: null });
        expect(oursFirst(await pageProbe(browser))).toBe(false);
        await browser.switchToWindow(pagesTab);
        // An extension tab is the selected tab: the popup opens over it, and its own page can see the popup's document.
        await browser.url(p3bPage('debug-journal.html'));
        const popup = await openActionPopup(browser);
        let how: string;
        let popupClosedByFirefox: boolean | null = null;
        if (popup !== null) {
          // The popup's own button, once the card has its state (not busy) and the panel stands still: where to click.
          let target: { readonly x: number; readonly y: number } | null = null;
          let placed: Awaited<ReturnType<typeof actionPopupRect>> = null;
          await browser.waitUntil(
            async () => {
              const inside = await browser.execute((): { x: number; y: number; busy: string | null } | null => {
                const api = (globalThis as unknown as { browser: { extension: { getViews(filter: { type: string }): Window[] } } }).browser;
                const button = api.extension.getViews({ type: 'popup' })[0]?.document.querySelector('.pg-site-access button');
                if (button === null || button === undefined) return null;
                const rect = button.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, busy: button.getAttribute('aria-busy') };
              });
              const before = await actionPopupRect(browser);
              await browser.pause(150);
              placed = await actionPopupRect(browser);
              if (inside === null || inside.busy === 'true' || placed === null || JSON.stringify(before) !== JSON.stringify(placed)) return false;
              target = { x: placed.left + inside.x, y: placed.top + inside.y };
              return true;
            },
            { timeout: 15_000, interval: 100, timeoutMsg: 'the popup’s «Включить Fansly» never stood ready' },
          );
          const point = target as { readonly x: number; readonly y: number } | null;
          expect(point).not.toBeNull();
          await armRecorder(browser);
          await clickInWindow(browser, point?.x ?? 0, point?.y ?? 0);
          await waitPrompt('in the toolbar popup');
          how = 'the toolbar popup, a real click in it';
          // The person's eyes go to Firefox's question: the popup is gone (Firefox closes it when the panel opens; if not, as the focus would).
          popupClosedByFirefox = !(await actionPopupOpen(browser));
          if (!popupClosedByFirefox) {
            await chrome(browser, `const { ViewPopup } = ChromeUtils.importESModule('resource:///modules/ExtensionPopups.sys.mjs'); const win = Services.wm.getMostRecentWindow('navigator:browser'); ViewPopup.for(WebExtensionPolicy.getByID(arguments[0]).extension, win)?.closePopup(); return true;`, [P3B_GECKO_ID]);
          }
        } else {
          // Headless Firefox would not open the popup: the closest a run gets — no page of ours open at all, the grant
          // made exactly as «Allow» makes it (ExtensionPermissions.add with the extension).
          how = 'no popup (headless Firefox did not open it): the grant as «Allow» makes it, with no page of ours open';
          await armRecorder(browser);
        }
        expect(await actionPopupOpen(browser)).toBe(false);
        await inBrowser(browser, async () => expect(await suspendBackground(P3B_GECKO_ID)).toBe('stopped'));
        const asleepAt = Date.now();
        if (popup !== null) expect(await allowPrompt(browser)).toBe(1);
        else await inBrowser(browser, () => grantOptional({ origins: FANSLY_ORIGINS, permissions: ['webRequest'] }, P3B_GECKO_ID));
        await registeredWithin(15_000, 'the sleeping background did not finish the switch-on on onAdded');
        const events = await recorded(browser);
        await stopRecorder(browser);
        // site.access answers the settings and the popup alone.
        await browser.url(p3bPage('options.html'));
        const state = await inBrowser(browser, () => access());
        // §4: on onAdded the background notices the Fansly tabs open across the grant, and counts them «ждут перезагрузки».
        await browser.switchToWindow(fanslyTab);
        const notice = await browser
          .waitUntil(async () => (await pageProbe(browser)).notice !== null, { timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        await browser.switchToWindow(pagesTab);
        report.checks['item4.toolbarPopup'] = {
          how,
          popupClosedByFirefox,
          prompts: optionalPrompts(events).map((event) => event.detail),
          wokeMs: since(events.find((event) => event.kind === 'background' && event.detail === 'running' && event.at >= asleepAt)?.at ?? null, asleepAt),
          registeredMs: since(firstAt(events, 'registered'), asleepAt),
          state,
          openTabNoticed: notice,
        };
        if (popup !== null) expect(optionalPrompts(events)).toHaveLength(1);
        expect(state).toMatchObject({ enabled: true, granted: true, registered: true });
        expect({ notice, waitingReload: state.waitingReload }).toEqual({ notice: true, waitingReload: 1 });
      });

      it('[P3b-5] grant → reload → capture: the reloaded tab gets our scripts first, and its 2xx API requests make the session template', async () => {
        await browser.switchToWindow(fanslyTab);
        await browser.refresh();
        await inBrowser(browser, () => waitForFanslyStandReady());
        await inBrowser(browser, () => waitForFanslyStandIdle());
        expect(oursFirst(await pageProbe(browser))).toBe(true);
        await browser.switchToWindow(pagesTab);
        await browser.waitUntil(async () => ((await session(browser))?.templates.length ?? 0) > 0, { timeout: 15_000, timeoutMsg: 'no template after the reload' });
        const captured = await session(browser);
        report.checks['item5.grantReloadCapture'] = { templates: captured?.templates.map((template) => template.legacyId), tabs: captured?.tabs.length };
        expect(captured?.templates[0]?.headers['authorization']).toBeTruthy();
        expect((await inBrowser(browser, () => access())).waitingReload).toBe(0);
      });

      it('[P3b-5] sleep → a page request → the top-level listener wakes the background → capture', async () => {
        await browser.switchToWindow(fanslyTab);
        const groupId = (await inBrowser(browser, () => fanslyIds())).groups[0] ?? '';
        await inBrowser(browser, () => callFansly('forget', groupId));
        await browser.switchToWindow(pagesTab);
        expect((await session(browser))?.templates[0]?.checks['group']).toBeUndefined();
        await inBrowser(browser, async () => expect(await suspendBackground(P3B_GECKO_ID)).toBe('stopped'));
        const asleepAt = Date.now();
        await armRecorder(browser);
        await browser.switchToWindow(fanslyTab);
        await inBrowser(browser, () => callFansly('open', groupId));
        await inBrowser(browser, () => waitForFanslyStandIdle());
        await browser.waitUntil(async () => (await inBrowser(browser, () => backgroundState(P3B_GECKO_ID))) === 'running', { timeout: 10_000, timeoutMsg: 'the page request did not wake the background' });
        await browser.switchToWindow(pagesTab);
        await browser.waitUntil(async () => (await session(browser))?.templates[0]?.checks['group'] !== undefined, { timeout: 10_000, timeoutMsg: 'the request that woke the background was not captured' });
        const events = await recorded(browser);
        await stopRecorder(browser);
        report.checks['item5.sleepRequestWake'] = { wokeMs: since(events.find((event) => event.kind === 'background' && event.detail === 'running')?.at ?? null, asleepAt) };
      });

      it('[P3b-5] an account change in the tab binds it to the other account', async () => {
        await browser.switchToWindow(fanslyTab);
        await browser.url(`${PAGE}?p3b-account=b`);
        await inBrowser(browser, () => waitForFanslyStandReady());
        await inBrowser(browser, () => waitForFanslyStandIdle());
        await browser.switchToWindow(pagesTab);
        await browser.waitUntil(async () => (await session(browser))?.tabs.some(([, legacy]) => legacy === SECOND_ACCOUNT) === true, { timeout: 15_000, timeoutMsg: 'the tab was not bound to the second account' });
        const captured = await session(browser);
        report.checks['item5.accountChange'] = { templates: captured?.templates.map((template) => template.legacyId), tabs: captured?.tabs };
        expect(captured?.templates.map((template) => template.legacyId)).toEqual([SECOND_ACCOUNT]);
        await browser.switchToWindow(fanslyTab);
        await browser.url(PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
      });

      it('[P3b-5] revocation removes the registrations and the session material; a new grant registers again and a reload captures', async () => {
        await browser.switchToWindow(pagesTab);
        await revoke();
        await browser.waitUntil(async () => ((await session(browser))?.templates.length ?? 0) === 0, { timeout: 10_000, timeoutMsg: 'the session material stayed after the revocation' });
        await inBrowser(browser, () => grantOptional({ origins: FANSLY_ORIGINS, permissions: ['webRequest'] }, P3B_GECKO_ID));
        await registeredWithin(15_000, 'not registered after the new grant');
        await browser.switchToWindow(fanslyTab);
        await browser.refresh();
        await inBrowser(browser, () => waitForFanslyStandReady());
        await inBrowser(browser, () => waitForFanslyStandIdle());
        expect(oursFirst(await pageProbe(browser))).toBe(true);
        await browser.switchToWindow(pagesTab);
        await browser.waitUntil(async () => ((await session(browser))?.templates.length ?? 0) > 0, { timeout: 15_000, timeoutMsg: 'no template after the new grant and a reload' });
        report.checks['item5.revokeRegrant'] = { ok: true };
      });

      it('[P3b-2] the real update N → N+1 wipes the registrations: how long until they are back and the open tabs show the notice; a tab loaded in the gap', async () => {
        const { inputs: given, world: here } = need();
        // A second Fansly tab open before the update, with N's scripts.
        const second = await openPage(browser, PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
        expect(oursFirst(await pageProbe(browser))).toBe(true);
        here.offer(P3B_GECKO_ID, { version: given.version.n1, file: given.xpi.n1 });
        await armRecorder(browser, { gapUrl: `${PAGE}?p3b=gap` });
        const asked = await backgroundUpdateCheck(browser);
        await browser.waitUntil(async () => (await addonView(browser))?.version === given.version.n1, { timeout: 30_000, interval: 100, timeoutMsg: 'N+1 was not applied' });
        await registeredWithin(20_000, 'the new version did not register the scripts again');
        const notices: Record<string, number | null> = {};
        for (const [name, handle] of [['first', fanslyTab], ['second', second]] as const) {
          await browser.switchToWindow(handle);
          await browser.waitUntil(async () => (await pageProbe(browser)).notice !== null, { timeout: 20_000, timeoutMsg: `no reload notice in the ${name} tab open before the update` });
          notices[name] = (await pageProbe(browser)).notice;
        }
        const events = await recorded(browser);
        await stopRecorder(browser);
        // The gap tab: opened the moment the new version stood without its registrations.
        let gap: { readonly openedMs: number | null; readonly startedMs: number | null; readonly oursFirst: boolean | null; readonly noticeMs: number | null } | null = null;
        for (const handle of await browser.getWindowHandles()) {
          await browser.switchToWindow(handle);
          if (!(await browser.getUrl()).includes('p3b=gap')) continue;
          await inBrowser(browser, () => waitForFanslyStandReady());
          const probe = await pageProbe(browser);
          gap = {
            openedMs: since(firstAt(events, 'gap-tab'), firstAt(events, 'onInstallStarted')),
            startedMs: since(probe.start?.at ?? null, firstAt(events, 'onInstallStarted')),
            oursFirst: oursFirst(probe),
            noticeMs: since(probe.notice, firstAt(events, 'onInstallStarted')),
          };
          await browser.closeWindow();
        }
        // A tab loaded after the registration is back gets our scripts first.
        await openPage(browser, PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
        const late = oursFirst(await pageProbe(browser));
        await browser.closeWindow();
        // Firefox closes the add-on's own tabs when it is replaced: the settings again.
        pagesTab = await openPage(browser, p3bPage('options.html'));
        const waiting = (await inBrowser(browser, () => access())).waitingReload;
        await browser.switchToWindow(second);
        await browser.closeWindow();
        await browser.switchToWindow(pagesTab);
        const installed = firstAt(events, 'onInstallStarted');
        const timeline = {
          checkToInstallMs: since(installed, asked),
          newVersionMs: since(firstAt(events, 'version', given.version.n1), installed),
          backgroundMs: since(events.find((event) => event.kind === 'background' && event.version === given.version.n1 && event.detail === 'running')?.at ?? null, installed),
          registeredMs: since(firstAt(events, 'registered', given.version.n1), installed),
          noticeFirstTabMs: since(notices['first'] ?? null, installed),
          noticeSecondTabMs: since(notices['second'] ?? null, installed),
          gap,
          lateTabOursFirst: late,
          waitingReload: waiting,
          prompts: events.filter((event) => event.kind.endsWith('permission-prompt')).map((event) => event.kind),
        };
        report.checks['item2.realUpdate'] = timeline;
        here.offer(P3B_GECKO_ID, null);
        expect(timeline.prompts).toEqual([]);
        // The registrations were gone for a while: the update wiped them, the new version's start put them back.
        expect(events.some((event) => event.kind === 'unregistered')).toBe(true);
        expect(late).toBe(true);
        expect(waiting).toBeGreaterThanOrEqual(2);
      });

      it('[P3b-3] persistAcrossSessions: after a restart with the same profile the first Fansly load has our scripts before the page’s; the restored tab and the early window are recorded', async () => {
        const { inputs: given } = need();
        // The Fansly tab selected, so the restored session loads it at once (the others wait to be selected).
        await browser.switchToWindow(fanslyTab);
        await browser.refresh();
        await inBrowser(browser, () => waitForFanslyStandReady());
        await quit(browser);
        const startedAt = Date.now();
        browser = await start('chatter');
        const view = await addonView(browser);
        const restored: Array<{ readonly url: string; readonly oursFirst: boolean | null; readonly startedMs: number | null }> = [];
        for (const handle of await browser.getWindowHandles()) {
          await browser.switchToWindow(handle);
          const url = await browser.getUrl();
          if (!url.startsWith(P3B_PAGE_ORIGIN)) continue;
          await browser.waitUntil(async () => (await pageProbe(browser)).start !== null, { timeout: 15_000 }).catch(() => undefined);
          const probe = await pageProbe(browser);
          restored.push({ url, oursFirst: oursFirst(probe), startedMs: since(probe.start?.at ?? null, startedAt) });
        }
        pagesTab = await openPage(browser, p3bPage('options.html'));
        // Whatever the restored tab asked while Firefox was starting: captured or not (the early window, §8.2).
        const early = await session(browser);
        // The restored tab's next request, made once the browser is up: the chain recovers without a reload.
        let restoredCaptured: boolean | null = null;
        for (const handle of await browser.getWindowHandles()) {
          await browser.switchToWindow(handle);
          if (!(await browser.getUrl()).startsWith(P3B_PAGE_ORIGIN)) continue;
          await inBrowser(browser, () => waitForFanslyStandReady());
          const groupId = (await inBrowser(browser, () => fanslyIds())).groups[1] ?? '';
          await inBrowser(browser, () => callFansly('open', groupId));
          await inBrowser(browser, () => waitForFanslyStandIdle());
          await browser.switchToWindow(pagesTab);
          restoredCaptured = await browser
            .waitUntil(async () => ((await session(browser))?.templates.length ?? 0) > 0, { timeout: 10_000 })
            .then(() => true)
            .catch(() => false);
          break;
        }
        // The first new load of Fansly after the restart.
        fanslyTab = await openPage(browser, PAGE);
        await inBrowser(browser, () => waitForFanslyStandReady());
        await inBrowser(browser, () => waitForFanslyStandIdle());
        const first = oursFirst(await pageProbe(browser));
        await browser.switchToWindow(pagesTab);
        await browser.waitUntil(async () => ((await session(browser))?.templates.length ?? 0) > 0, { timeout: 15_000, timeoutMsg: 'no template from the first Fansly load after the restart' });
        report.checks['item3.restart'] = {
          startupReason: view?.startupReason,
          version: view?.version,
          registeredAtFirstLook: view?.scripts,
          restoredTabs: restored,
          templatesBeforeAnyNewLoad: early?.templates.length ?? 0,
          restoredTabNextRequestCaptured: restoredCaptured,
          firstLoadOursFirst: first,
        };
        expect(view).toMatchObject({ version: given.version.n1, startupReason: 'APP_STARTUP' });
        expect(first).toBe(true);
        expect((await inBrowser(browser, () => access())).registered).toBe(true);
      });
    });

    describe('the end', () => {
      it('[P3b] nothing left the machine: the proxy dropped no request', () => {
        const { world: here } = need();
        expect(here.egress()).toEqual([]);
      });
    });
  });
}
