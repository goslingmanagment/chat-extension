// The OLD Fansly extension as a perf subject (R20 P3d): its test build
// (old-build/build.ts — the served release, the stand's addresses compiled in)
// installed as a temporary add-on, signed in to the fake hub and set up as a
// chatter has it — the sounds on, the notes panel «Справа по кнопке» or
// «Всегда справа», the account mapped to a persona — so that its button bar is
// live on every chat, as at work.
//
// The settings are written the way the old extension keeps them (fansly-chat
// 2.12.0, `src/shared/storage.ts`, schema 21): its background lays out the
// state on its first start; this adds the hub address, a device token of the
// fake hub, the mapping of the stand's creator to the fake hub's persona and
// the two switches, and waits for the extension's own persona-catalog refresh
// to land (it fetches the catalog and stamps its source itself).
//
// «At work on the chat» (`ready`): its root stands right before the open
// chat's composer, its button bar is shown and its first button is enabled —
// which needs a captured Fansly session, a token, a persona and the mapping
// (`button-bar.ts`). The overlay cycle alternates its notes panel (the header's
// «Заметки», toggled twice) and its cheatsheet (`?`, closed by Escape).

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

import { $, browser } from '@wdio/globals';
import { Key } from 'webdriverio';

import { fakeHubOrigin } from '../../support/fake-hub';
import { FANSLY_MAIN, fakeFansly } from '../../support/fansly-stand';
import { grantedState, grantOptional } from '../../support/permissions';
import { addonHost, inChrome } from './memory';
import type { PerfSubject } from './scenario';

export const OLD_ADDON_ID = 'chatgoose@gosling.agency';

/** The old extension's `fanNotesView`: `drawer` — «Справа по кнопке» (its default), `docked` — «Всегда справа». */
export type NotesPlacement = 'button' | 'always';
const NOTES_VIEW: Record<NotesPlacement, 'drawer' | 'docked'> = { button: 'drawer', always: 'docked' };

/** The fake hub's chatter and the persona the stand's creator is mapped to (src/fake-hub: auth.ts, ai.ts). */
const HUB_USER = { username: 'chatter1', password: 'synthetic-password' } as const;
const PERSONA_KEY = 'default';
/** The schema the rules of old-build/rules.ts were read against (fansly-chat `SCHEMA_VERSION`). */
const SCHEMA_VERSION = 21;

/** A full device token of the fake hub, issued the way the old extension's sign-in asks for one. */
async function hubToken(): Promise<string> {
  const body = JSON.stringify({ username: HUB_USER.username, password: HUB_USER.password, label: 'P3d old Fansly baseline', mode: 'active' });
  const text = await new Promise<string>((resolve, reject) => {
    const call = httpRequest(
      `${fakeHubOrigin()}/api/v1/auth/device-tokens/password`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => (response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`fake hub sign-in: HTTP ${String(response.statusCode)}`))));
      },
    );
    call.on('error', reject);
    call.end(body);
  });
  return (JSON.parse(text) as { token: string }).token;
}

type Storage = Record<string, unknown>;

async function readStorage(): Promise<Storage> {
  return browser.execute(async () => {
    const api = (globalThis as unknown as { browser?: { storage: { local: { get(keys: null): Promise<Record<string, unknown>> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    return api.storage.local.get(null);
  });
}

async function writeStorage(items: Storage): Promise<void> {
  await browser.execute(async (values: Record<string, unknown>) => {
    const api = (globalThis as unknown as { browser?: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    await api.storage.local.set(values);
  }, items);
}

export function oldSubject(options: { readonly xpi: string; readonly notes: NotesPlacement }): PerfSubject {
  let host: string | null = null;
  let version = '?';
  const page = (path: string): string => `moz-extension://${String(host)}/${path}`;
  /** The open chat's main composer has the old root right before it, with its bar shown and its first button live. */
  const atWork = (): Promise<boolean> =>
    browser.execute((composer: string) => {
      const input = document.querySelector(composer);
      const root = input?.previousElementSibling;
      if (root?.id !== 'chatgoose-root') return false;
      const bar = root.querySelector('.chatgoose-bar');
      if (bar === null || bar.classList.contains('chatgoose-hidden')) return false;
      const first = bar.querySelector<HTMLButtonElement>('button.chatgoose-toolbar-button');
      return first !== null && !first.disabled && document.querySelector('.chatgoose-notes-trigger-button') !== null;
    }, FANSLY_MAIN.composer);
  const visible = (selector: string): Promise<boolean> =>
    browser.execute((target: string) => {
      const node = document.querySelector<HTMLElement>(target);
      if (node === null) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden' && !node.classList.contains('chatgoose-hidden');
    }, selector);

  return {
    get name() {
      return `old-${version}`;
    },
    addonId: OLD_ADDON_ID,
    async prepare() {
      await browser.installAddOn(readFileSync(options.xpi).toString('base64'), true);
      host = await addonHost(OLD_ADDON_ID);
      if (host === null) throw new Error('the old extension did not install');
      // Its host permissions (the stand and the fake hub): MV3 may leave them to the person; grant them as a person would.
      await grantOptional({ origins: ['*://localhost/*', 'http://127.0.0.1/*'] }, OLD_ADDON_ID);
      for (const url of [`${new URL(fakeHubOrigin()).origin}/`, 'http://localhost/']) {
        if (!(await grantedState(url, OLD_ADDON_ID)).reaches) throw new Error(`the old extension cannot reach ${url}`);
      }
      // One of its own pages, for its storage: the prompt viewer asks nothing without a viewer token in its address.
      await browser.url(page('debug-prompt.html'));
      version = (await browser.execute(() => (globalThis as unknown as { browser: { runtime: { getManifest(): { version: string } } } }).browser.runtime.getManifest().version)) ?? '?';
      await browser.waitUntil(async () => (await readStorage())['schemaVersion'] === SCHEMA_VERSION, {
        timeout: 15_000,
        timeoutMsg: `the old extension did not lay out its storage (schema ${String(SCHEMA_VERSION)})`,
      });
      const stored = await readStorage();
      const creator = (await fakeFansly().status()).creatorId;
      const settings = stored['settings'] as Record<string, unknown>;
      await writeStorage({
        settings: { ...settings, agencyHubBaseUrl: new URL(fakeHubOrigin()).origin, messageSoundEnabled: true, followSoundEnabled: true, fanNotesView: NOTES_VIEW[options.notes], fanslyViaTab: false },
        agencyHubDeviceToken: await hubToken(),
        knownAccounts: [creator],
        accountMappings: { [creator]: PERSONA_KEY },
      });
      // Its own refresh (a token or address change) fetches the catalog from the fake hub and stamps the source.
      await browser.waitUntil(
        async () => {
          const now = await readStorage();
          const catalog = now['personaCatalog'];
          return Array.isArray(catalog) && catalog.some((item) => (item as { key?: unknown }).key === PERSONA_KEY) && typeof now['personaCatalogSource'] === 'string' && now['personaCatalogSource'] !== '';
        },
        { timeout: 20_000, timeoutMsg: 'the old extension did not fetch the persona catalog from the fake hub' },
      );
    },
    async ready(groupId: string) {
      await browser.waitUntil(atWork, { timeout: 15_000, interval: 50, timeoutMsg: `the old extension is not at work on chat ${groupId}` });
    },
    async overlay(cycle: number) {
      if (cycle % 2 === 0) {
        // «Заметки»: toggled twice — «Справа по кнопке» opens and closes, «Всегда справа» closes and opens again.
        const before = await visible('#chatgoose-notes-root');
        for (const expected of [!before, before]) {
          await $('.chatgoose-notes-trigger-button').click();
          await browser.waitUntil(async () => (await visible('#chatgoose-notes-root')) === expected, { timeout: 5000, interval: 30, timeoutMsg: `the notes panel did not turn ${expected ? 'on' : 'off'}` });
        }
      } else {
        // The cheatsheet: `?` outside a field, Escape.
        await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
        await browser.keys(['?']);
        await browser.waitUntil(() => visible('#chatgoose-cheatsheet-root .chatgoose-cheatsheet-panel'), { timeout: 5000, interval: 30, timeoutMsg: 'the cheatsheet did not open' });
        await browser.keys([Key.Escape]);
        await browser.waitUntil(async () => !(await visible('#chatgoose-cheatsheet-root .chatgoose-cheatsheet-panel')), { timeout: 5000, interval: 30, timeoutMsg: 'the cheatsheet did not close' });
      }
    },
    async describe() {
      const onPage = await browser.execute(() => ({
        root: document.querySelector('#chatgoose-root') !== null,
        notesOpen: (() => {
          const node = document.querySelector<HTMLElement>('#chatgoose-notes-root');
          return node !== null && node.getBoundingClientRect().width > 0;
        })(),
        // «Всегда справа» docks only with 280 px free right of the chat (fansly-chat placement.ts).
        layout: {
          innerWidth: window.innerWidth,
          messagesRoute: Math.round(document.querySelector('app-messages-route')?.getBoundingClientRect().width ?? -1),
          capStyle: document.querySelector('style[data-perf-stand]') !== null,
          computed: (() => {
            const route = document.querySelector('app-messages-route');
            if (route === null) return null;
            const own = getComputedStyle(route);
            const parent = route.parentElement === null ? null : getComputedStyle(route.parentElement);
            const sheet = document.querySelector<HTMLStyleElement>('style[data-perf-stand]')?.sheet;
            return { maxWidth: own.maxWidth, marginLeft: own.marginLeft, flex: own.flex, parent: route.parentElement?.className ?? null, parentDisplay: parent?.display ?? null, rules: sheet?.cssRules.length ?? -1, text: document.querySelector('style[data-perf-stand]')?.textContent ?? null };
          })(),
        },
        freeRightOfChat: Math.round(window.innerWidth - (document.querySelector('app-messages-conversation-route')?.getBoundingClientRect().right ?? window.innerWidth)),
        notesRoot: (() => {
          const node = document.querySelector<HTMLElement>('#chatgoose-notes-root');
          if (node === null) return null;
          const box = node.getBoundingClientRect();
          return { children: node.childElementCount, width: Math.round(box.width), height: Math.round(box.height), left: Math.round(box.left), hidden: node.classList.contains('chatgoose-hidden') };
        })(),
        buttons: [...document.querySelectorAll<HTMLButtonElement>('#chatgoose-root button.chatgoose-toolbar-button')].map((button) => `${button.textContent?.trim() ?? ''}${button.disabled ? ' (off)' : ''}`),
      }));
      // Whether its event page is still awake (Firefox suspends an idle one after 30 s; its sound status keeps it up).
      const backgroundState = await inChrome<string>('return WebExtensionPolicy.getByID(args[0]).extension.backgroundState;', OLD_ADDON_ID);
      return { version, notes: options.notes, fanNotesView: NOTES_VIEW[options.notes], backgroundState, ...onPage };
    },
  };
}
