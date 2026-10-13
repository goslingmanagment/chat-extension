// The background core and ChatSpace's chunk wired whole (docs/project-unite/architecture.md §3.3; plan.md F1): the
// probe on the real kit — the composition root on the fake browser against the fake hub, ChatSpace's own module
// (bg/chatspace.ts) loaded through the core's loader, as `bg/chatspace.js` is in the browser.
// - start: nothing pending and no ChatSpace tab — the chunk is never loaded; the first tab starts it with the core's
//   kit, whose ports reach the core's one owner of each thing; its requests answer;
// - an import error: the core goes on (sign-in, a generation), the site's own requests answer
//   CG-RUNTIME-UNREACHABLE and send nothing, the diagnostics say `failed`;
// - a restart: the next instance of the event page is a new realm — it loads the chunk again at its own address and
//   the site works; an X8 journal left by the previous instance makes the chunk start with the event page, no tab
//   needed, and its open attempt holds its fan, uncertain, through every wake.

import { STORAGE_KEYS, type DiagnosticsSnapshot, type SendJournalEntry } from '@cg/contracts';
import { journalEntry } from '@cg/contracts/fixtures';
import { createSendJournal } from '@cg/core/services/custody';
import { createKeyValueStore } from '@cg/platform';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageSender } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { chatSpaceModule } from '../bg/chatspace.ts';
import type { BackgroundKit } from '../src/composition/background/host-module.ts';
import { HOST_MODULE_SPECS } from '../src/composition/background.ts';
import { admitted, bindingOf, signInWithPersona, startReply, workingTab } from './support/tabs.ts';
import { HUB_ORIGIN, createWorld, loadChunkModule, sleep, until, type World } from './support/world.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const PAGE_ID = WORLD.pages.one.pageId;
const CHUNK = /\/bg\/chatspace\.js$/;

const worlds: World[] = [];
function world(options?: Parameters<typeof createWorld>[0]): World {
  const made = createWorld(options);
  worlds.push(made);
  return made;
}
beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const made of worlds.splice(0)) made.dispose();
  await sleep(30);
  vi.restoreAllMocks();
});

async function diagnostics(w: World): Promise<DiagnosticsSnapshot> {
  const answer = await w.page('options').request('diagnostics.get', {});
  if (!answer.ok) throw new Error(`diagnostics.get: ${answer.error.code}`);
  return answer.payload;
}

describe('the background core and the ChatSpace chunk (R20 F1)', () => {
  it('[R20-F1] start: no tab and nothing pending — the chunk is not loaded; the first ChatSpace tab starts it with the core’s own kit, and its requests answer', async () => {
    let kit: BackgroundKit | null = null;
    const w = world({
      // The real module, its kit looked at on the way in.
      loadHostModule: (url) => {
        const real = chatSpaceModule();
        return Promise.resolve(CHUNK.test(url) ? { default: { host: 'chatspace', start: (given: BackgroundKit) => ((kit = given), real.start(given)) } } : {});
      },
    });
    w.start();
    await signInWithPersona(w);
    expect((await diagnostics(w)).hostModules).toEqual([{ host: 'chatspace', state: 'idle' }]);
    expect(w.chunkLoads).toEqual([]);

    const tab = await workingTab(w);
    expect(await tab.client.request('send.fuseState', {})).toEqual({ ok: true, payload: { fuse: null, resetAt: null } });
    expect(await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: '2002' })).toEqual({ ok: true, payload: { attempts: [], truncated: false } });
    expect(w.chunkLoads).toHaveLength(1);
    expect(w.chunkLoads[0]).toMatch(CHUNK);
    expect((await diagnostics(w)).hostModules).toEqual([{ host: 'chatspace', state: 'started' }]);

    // The kit is the core's: the sign-in, the install, the tabs, the bootstrap, and the one registrar of human sends.
    const given = kit as BackgroundKit | null;
    if (given === null) throw new Error('the module was not started with a kit');
    expect(given.hub.session()).toMatchObject({ hubOrigin: HUB_ORIGIN });
    expect(given.hub.bootstrap()?.pages.map((page) => page.pageId)).toContain(PAGE_ID);
    expect(given.install.owner()).toBe(`${HUB_ORIGIN}|${String(given.hub.session()?.userId)}`);
    expect(given.install.instanceId()).toBe(w.fake.areas.local.get('install.instanceId'));
    expect(given.router.tabs()).toEqual([tab.tabSessionId()]);
    expect(await given.hub.page(PAGE_ID, { kind: 'tab', tabSessionId: tab.tabSessionId() })).toMatchObject({ ok: true, page: { pageId: PAGE_ID } });
    expect(await given.nativeSends.register(null, { index: 0 }, '4100')).toBe('not-ours');
  });

  it('[R20-F1] an import error: the core goes on — a generation runs —, the site’s requests answer «не отвечает» and send nothing, the diagnostics say `failed`; the next instance of the event page loads it again and the site works', async () => {
    let broken = true;
    const w = world({ loadHostModule: (url) => (broken ? Promise.reject(new TypeError('error loading dynamically imported module')) : loadChunkModule(url)) });
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    await until(() => w.chunkLoads.length === 1, 'the first tab asked for the chunk');

    expect(admitted(await startReply(tab, await bindingOf(tab)))).toMatch(/^[0-9a-f-]{36}$/);
    const unreachable = { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'chatspace services' } };
    expect(await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: '2002' })).toEqual(unreachable);
    expect(await tab.client.request('newcomers.claim', { pageId: PAGE_ID, fanRef: '2002', action: 'claim' })).toEqual(unreachable);
    expect(await w.page('options').request('send.fuseState', {})).toEqual(unreachable);
    const failed = await diagnostics(w);
    expect(failed.hostModules).toEqual([{ host: 'chatspace', state: 'failed' }]);
    expect(failed.sends).toEqual({ open: 0, uncertain: 0 });
    expect(failed.session.signedIn).toBe(true);
    // Within the realm it is not asked for again at once.
    expect(w.chunkLoads).toHaveLength(1);
    expect(w.fake.areas.local.get(STORAGE_KEYS.sendJournal)).toBeUndefined();

    // The event page sleeps and wakes: a new realm loads the chunk at its own address, and the site works.
    broken = false;
    w.fake.suspendBackground();
    await until(() => w.starts() === 2 && tab.client.state() === 'ready', 'the tab registered with the new instance');
    expect(await tab.client.request('send.fuseState', {})).toEqual({ ok: true, payload: { fuse: null, resetAt: null } });
    expect(w.chunkLoads).toHaveLength(2);
    expect(w.chunkLoads[1]).toMatch(CHUNK);
    expect((await diagnostics(w)).hostModules).toEqual([{ host: 'chatspace', state: 'started' }]);
  });

  it('[R20-F1] [X8-07] a restart with an X8 journal: the chunk starts with the event page — no tab needed —, the open attempt holds its fan as uncertain, and so after every wake', async () => {
    const w = world();
    // The previous instance journaled an attempt and ChatSpace took it into its queue; then the page was gone.
    const seed = w.fake.context(pageSender(w.fake, 'debug-journal')).api;
    const journal = createSendJournal({ local: createKeyValueStore('local', { api: seed }) });
    await journal.start();
    const attempt: SendJournalEntry = { ...journalEntry, attemptId: uuid(41), createdAt: Date.now() - 4000, updatedAt: Date.now() - 4000 };
    expect(await journal.begin(attempt)).toMatchObject({ ok: true });
    expect(await journal.advance(attempt.attemptId, { state: 'nativeEnqueued', pendingId: uuid(42) })).toMatchObject({ ok: true });
    journal.dispose();
    expect(HOST_MODULE_SPECS.chatspace.pending.local).toContain(STORAGE_KEYS.sendJournal);

    w.start();
    await until(() => w.chunkLoads.length === 1, 'the chunk starts with the event page: an X8 journal is pending');
    const first = await diagnostics(w);
    expect(first.hostModules).toEqual([{ host: 'chatspace', state: 'started' }]);
    expect(first.sends).toEqual({ open: 0, uncertain: 1 });

    // Asleep and woken by a page alone: the next realm restores it again, before anything is answered.
    w.fake.suspendBackground();
    const second = await diagnostics(w);
    expect(w.starts()).toBe(2);
    expect(w.chunkLoads).toHaveLength(2);
    expect(second.hostModules).toEqual([{ host: 'chatspace', state: 'started' }]);
    expect(second.sends).toEqual({ open: 0, uncertain: 1 });

    // A tab of the person sees the fan held by it.
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const listed = await tab.client.request('send.list', { pageId: PAGE_ID, fanRef: attempt.fanRef });
    expect(listed).toMatchObject({ ok: true, payload: { attempts: [{ view: { attemptId: attempt.attemptId, state: 'uncertain' } }] } });
    expect(w.chunkLoads).toHaveLength(2);
  });
});
