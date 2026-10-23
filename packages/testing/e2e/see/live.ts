// `pnpm see … --live` (tools/see/README.md): the TEST build on the real fansly.com, signed in as the agency's test
// model in a durable headless profile (wdio.conf.ts, CG_SEE_LIVE_PROFILE), against the fake hub — no money, no
// production hub. Not CI, never: it needs the network and the model's sign-in.
//
// Nothing is blocked (the owner, 2026-10-24): the model's chats are real fans, and what a fan would see — a send, a
// post or a story, anything with money — is done only after the owner's «да» in the chat (AGENTS.md). Every write of
// the browser's pages to Fansly is written down as it leaves (writes.json, a `cg-see write` line): a read mark
// (`/message/ack`), «typing», a send, a post, an upload. BiDi does not see the extension's event page (notes,
// `group.create`, X8's send); X8's send stays off — the fake hub's `previewSend` is never switched on here.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { $$, browser } from '@wdio/globals';

import { fanslyPageFlags } from '../../src/fake-hub/config';
import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import { WORLD } from '../../src/scenarios/hub';
import { assignPersona, installTestBuild, pageRpc, writeLocalStorage } from '../support/extension';
import { fakeHubOrigin, QUIET_PAGE, testBuildPage } from '../support/fake-hub';
import { registeredScripts } from '../support/fansly-site';
import { focusTab } from '../support/focus';
import { grantOptional } from '../support/permissions';
import { SHIFT_PASSWORD } from '../support/shift';

export const LIVE = process.env['CG_SEE_LIVE'] === '1';

const SITE = 'https://fansly.com';
const API = 'https://apiv3.fansly.com/api/v1';
/**
 * What «Включить Fansly» grants (apps/extension/src/hosts/runtime/fansly.ts FANSLY_MATCHES, FANSLY_API_MATCHES) —
 * and the stand's `localhost`: the test build's bundle names it too (hosts/index.ts pageMatchesOf), and the background
 * registers Fansly's scripts only once the whole bundle is granted.
 */
const FANSLY_ORIGINS = ['https://fansly.com/*', 'https://apiv3.fansly.com/*', 'http://localhost/*'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface FanslyWrite {
  readonly at: string;
  readonly method: string;
  readonly url: string;
}

/** The writes of the browser's pages to Fansly's hosts, in order (the query left out). */
export const fanslyWrites: FanslyWrite[] = [];

/** Writes down every request of the browser's pages to Fansly that is not a read; nothing is held or failed. */
async function journalWrites(): Promise<void> {
  await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] });
  browser.on('network.beforeRequestSent', (event) => {
    const { method, url } = event.request;
    if (READS.has(method) || !/(?:^|\.)fansly\.com$/.test(new URL(url).hostname)) return;
    const write = { at: new Date().toISOString(), method, url: url.split('?')[0] ?? url };
    fanslyWrites.push(write);
    console.log(`cg-see write ${write.method} ${write.url}`);
  });
}

/** Clicks the first shown element whose own text is exactly `text`, or its parent; false when there is none. */
async function clickText(text: string): Promise<boolean> {
  const own = `//*[normalize-space(.)="${text}"][not(*[normalize-space(.)="${text}"])]`;
  for (const xpath of [own, `${own}/..`]) {
    for (const target of await $$(xpath)) {
      if ((await target.isDisplayed()) && (await target.isClickable())) {
        await target.click();
        await browser.pause(500);
        return true;
      }
    }
  }
  return false;
}

/** The signed-in account of the tab, from the site's own session; null when signed out. */
async function signedInAccount(): Promise<{ readonly id: string; readonly username: string } | null> {
  return browser.execute(async (api: string) => {
    try {
      const token = (JSON.parse(localStorage.getItem('session_active_session') ?? '{}') as { token?: string }).token;
      if (token === undefined) return null;
      const answer = (await (await fetch(`${api}/account/me?ngsw-bypass=true`, { headers: { authorization: token } })).json()) as { response?: { account?: { id: string; username: string } } };
      const account = answer.response?.account;
      return account === undefined ? null : { id: account.id, username: account.username };
    } catch {
      return null;
    }
  }, API);
}

/** The test model signed in on this tab: the profile's session, else the sign-in form with the env's credentials. */
async function signInToFansly(): Promise<{ readonly id: string; readonly username: string }> {
  await browser.url(`${SITE}/`);
  await browser.pause(3000);
  // The age gate and the cookie banner come once per profile.
  await clickText('Enter');
  await clickText('Essential Only');
  const already = await signedInAccount();
  if (already !== null) return already;
  const login = process.env['FANSLY_TEST_MODEL_EMAIL'];
  const password = process.env['FANSLY_TEST_MODEL_PASSWORD'];
  if (!login || !password) throw new Error('the live profile is signed out and FANSLY_TEST_MODEL_EMAIL / FANSLY_TEST_MODEL_PASSWORD are not set (set -a; . ~/.config/agency/secrets.env; set +a)');
  if (!(await clickText('Login'))) throw new Error('fansly.com shows no «Login» button');
  await (await browser.$('#fansly_login')).setValue(login);
  await (await browser.$('#fansly_password')).setValue(password);
  await browser.keys('Enter');
  let account: { readonly id: string; readonly username: string } | null = null;
  await browser.waitUntil(async () => (account = await signedInAccount()) !== null, { timeout: 30_000, timeoutMsg: 'fansly.com did not sign the test model in (a captcha or a code by mail? take a picture)' });
  return account as unknown as { readonly id: string; readonly username: string };
}

export interface LiveShiftOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  /** A chat to open (`/messages/<group>`); none — the list of chats. */
  readonly group?: string;
  readonly generation?: Partial<SettingsV1['generation']>;
}

export interface LiveShift {
  readonly account: { readonly id: string; readonly username: string };
  toFansly(): Promise<void>;
  toPages(): Promise<void>;
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
}

/**
 * The shift of support/fansly-shift.ts on the real site: the journal of writes first, the test model signed in on a Fansly tab,
 * the fake hub's Fansly page bound to that account (before the chatter signs in), the test build pointed at the fake
 * hub and the real Fansly API, Fansly switched on, and the Fansly tab on `/messages`.
 */
export async function startLiveShift(hub: FakeHubControlClient, options: LiveShiftOptions = {}): Promise<LiveShift> {
  await journalWrites();
  const pagesTab = await browser.getWindowHandle();
  const fanslyTab = (await browser.createWindow('tab')).handle;
  await browser.switchToWindow(fanslyTab);
  if (options.viewport !== undefined) await browser.browsingContextSetViewport({ context: fanslyTab, viewport: { ...options.viewport } });
  const account = await signInToFansly();
  console.log(`cg-see fansly: signed in as @${account.username}`);
  await clickText('Maybe Later');

  await hub.command({ op: 'config', patch: fanslyPageFlags() });
  await hub.command({ op: 'pageAccount', pageLabel: WORLD.pages.fansly.pageLabel, platformAccountId: account.id });
  await browser.switchToWindow(pagesTab);
  await installTestBuild();
  await browser.url(testBuildPage(QUIET_PAGE));
  const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: fakeHubOrigin() }, generation: { ...DEFAULT_SETTINGS.generation, ...options.generation } };
  await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
  await browser.waitUntil(
    async () => {
      const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
      return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
    },
    { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
  );
  await browser.url(testBuildPage('options.html'));
  const signedIn = await pageRpc('session.signIn', { login: WORLD.user.username, password: SHIFT_PASSWORD });
  if (!signedIn.ok) throw new Error(`sign-in to the fake hub: ${signedIn.error.code}`);
  await assignPersona(WORLD.pages.fansly.pageLabel);
  await grantOptional({ origins: FANSLY_ORIGINS, permissions: ['webRequest'] });
  await browser.url(testBuildPage());
  await browser.waitUntil(async () => (await registeredScripts()).some((script) => script.id === 'fansly'), { timeout: 15_000, timeoutMsg: 'background registers Fansly after the grant' });
  await browser.url(testBuildPage(QUIET_PAGE));

  const toFansly = async (): Promise<void> => {
    await browser.switchToWindow(fanslyTab);
    await focusTab();
  };
  const toPages = (): Promise<void> => browser.switchToWindow(pagesTab);
  await toFansly();
  // A new document: the registered scripts run from its start.
  await browser.url(`${SITE}/messages${options.group === undefined ? '' : `/${options.group}`}`);
  return {
    account,
    toFansly,
    toPages,
    async rpc(type, payload = {}) {
      await toPages();
      try {
        return await pageRpc(type, payload);
      } finally {
        await toFansly();
      }
    },
  };
}
