// R20 F6b: the reads by conversation (docs/project-unite/architecture.md
// §11.1, hub HF-10) on the whole background — the composition root, the hub
// facade, the vendored SDK — against the in-process fake hub. A ChatSpace tab
// is asked the way its controllers ask: the recap status and the shared
// recaps, the dossier save (the tab's and the background's own after a full
// Recap), the archive feed (a first page and an older one), the fan's card
// and dossier. What leaves the browser for the hub is compared byte for byte
// with what main sent before F6b (support/chatspace-recorded-reads.ts): on
// ChatSpace the conversation is the fan, and the hub's reads are the same.

import { chat } from '@cg/contracts/fixtures';
import { PILOT_CAPABILITIES, callsTo } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHATSPACE_RECORDED_READS } from './support/chatspace-recorded-reads.ts';
import { admitted, bindingOf, opsOf, signInWithPersona, startReply, workingTab, type WorkingTab } from './support/tabs.ts';
import { createWorld, sleep, until, type WireRequest, type World } from './support/world.ts';

const PAGE_ID = WORLD.pages.one.pageId;
const PERSONA = WORLD.persona.definitionId;

const worlds: World[] = [];
function world(): World {
  const made = createWorld();
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

/** What a read is about: the requests that are not the sign-in's own upkeep (the bootstrap, the catalog, health, telemetry). */
const UPKEEP = /\/(client\/bootstrap|health|ingest\/observations|ai\/persona-catalog|auth\/me)$/;

/** The ids a run mints (an operation, its generation, a cursor) as names: the rest of every byte is compared as is. */
function named(requests: readonly WireRequest[], names: Readonly<Record<string, string>>): string {
  let text = JSON.stringify(requests.filter((request) => !UPKEEP.test(request.url.split('?')[0] ?? '')));
  for (const [name, value] of Object.entries(names)) if (value !== '') text = text.split(value).join(`<${name}>`);
  return text.replace(/cursor=[^&"]+/g, 'cursor=<cursor>');
}

/** The wire of one tab request: everything the background sent the hub while answering it. */
async function wireOf(w: World, ask: () => Promise<unknown>): Promise<WireRequest[]> {
  const from = w.wire.length;
  await ask();
  return w.wire.slice(from);
}

/** A full Recap of the open chat, finished; the background's own dossier save has run. */
async function fullRecap(w: World, tab: WorkingTab): Promise<{ readonly opId: string; readonly generationRef: string; readonly wire: WireRequest[] }> {
  const from = w.wire.length;
  const opId = admitted(await startReply(tab, await bindingOf(tab), chat.platformFanId, { feature: 'recap', window: 3000 }));
  await until(async () => (await opsOf(tab)).find((op) => op.opId === opId)?.state === 'done', 'the recap ended');
  const generationRef = (await opsOf(tab)).find((op) => op.opId === opId)?.generationRef ?? '';
  await until(() => w.wire.slice(from).some((request) => request.url.endsWith('/profile/from-generation')), 'the background saved the dossier');
  // Only the dossier save: the stream itself is F6a's (support/chatspace-recorded.ts in core).
  return { opId, generationRef, wire: w.wire.slice(from).filter((request) => request.url.endsWith('/profile/from-generation')) };
}

/** The hub as the pilot runs it (it serves `conversation-recaps-v1`), and a hub before HF-10. */
const HUBS = [
  ['a hub that serves conversation-recaps-v1', PILOT_CAPABILITIES],
  ['a hub before HF-10', PILOT_CAPABILITIES.filter((capability) => capability !== 'conversation-recaps-v1')],
] as const;

describe('[host:chatspace] R20 F6b: what the background sends the hub for the reads by conversation is what main sent', () => {
  it.each(HUBS)('the recap status and recaps, both dossier saves, the feed, the card and the dossier — byte for byte, on %s', async (_name, capabilities) => {
    const w = world();
    w.hub.control({ op: 'config', patch: { capabilities } });
    w.start();
    await signInWithPersona(w);
    const tab = await workingTab(w);
    const fan = chat.platformFanId;

    const recap = await fullRecap(w, tab);
    const names = { opId: recap.opId, generationRef: recap.generationRef };
    expect(named(recap.wire, names)).toBe(CHATSPACE_RECORDED_READS.backgroundSave);

    const reads: Record<string, string> = {};
    reads['recapStatus'] = named(await wireOf(w, () => tab.client.request('recap.status', { pageId: PAGE_ID, fanRef: fan, personaDefinitionId: PERSONA })), names);
    reads['recapRead'] = named(await wireOf(w, () => tab.client.request('recap.read', { pageId: PAGE_ID, fanRef: fan, personaDefinitionId: PERSONA })), names);
    reads['recapSave'] = named(await wireOf(w, () => tab.client.request('recap.save', { pageId: PAGE_ID, fanRef: fan, generationRef: recap.generationRef, opId: recap.opId })), names);
    let cursor: string | null = null;
    reads['feedFirst'] = named(
      await wireOf(w, async () => {
        const first = await tab.client.request('feed.read', { pageId: PAGE_ID, fanRef: fan, cursor: null, limit: 2, summaryWindow: 100 });
        cursor = first.ok ? first.payload.nextOlderCursor : null;
      }),
      names,
    );
    expect(cursor).not.toBeNull();
    reads['feedOlder'] = named(await wireOf(w, () => tab.client.request('feed.read', { pageId: PAGE_ID, fanRef: fan, cursor, limit: 2 })), names);
    reads['feedHead'] = named(await wireOf(w, () => tab.client.request('feed.read', { pageId: PAGE_ID, fanRef: fan, cursor: null, limit: 1 })), names);
    reads['card'] = named(await wireOf(w, () => tab.client.request('fan.card', { pageId: PAGE_ID, fanRef: fan, period: '30d' })), names);
    reads['dossier'] = named(await wireOf(w, () => tab.client.request('fan.dossier', { pageId: PAGE_ID, fanRef: fan })), names);
    expect(reads).toEqual(CHATSPACE_RECORDED_READS.reads);
  });
});

describe('[host:chatspace] R20 F6b: a ChatSpace chat whose conversation is not its fan is a request the hub refuses', () => {
  for (const [name, capabilities] of HUBS) {
    it(`on ${name}: ${capabilities.includes('conversation-recaps-v1') ? 'the hub answers it 409 conversation_fan_mismatch (CG-CONTEXT-CHANGED)' : 'it is never asked (CG-HUB-CAPABILITY)'}`, async () => {
      const w = world();
      w.hub.control({ op: 'config', patch: { capabilities } });
      w.start();
      await signInWithPersona(w);
      const tab = await workingTab(w);
      const fan = chat.platformFanId;
      const other = WORLD.otherFan;
      const answers = await Promise.all([
        tab.client.request('recap.read', { pageId: PAGE_ID, fanRef: fan, personaDefinitionId: PERSONA, conversationRef: other }),
        tab.client.request('feed.read', { pageId: PAGE_ID, fanRef: fan, cursor: null, limit: 1, conversationRef: other }),
        tab.client.request('recap.save', { pageId: PAGE_ID, fanRef: fan, generationRef: '00000000-0000-4000-8000-000000000200', conversationRef: other }),
      ]);
      const served = capabilities.includes('conversation-recaps-v1');
      const entries = w.hub.read().entries;
      if (served) {
        // The hub checks the pair before it reads anything: the save too is its 409, not «rejected».
        expect(answers.map((answer) => (answer.ok ? answer.payload : answer.error.code))).toEqual(['CG-CONTEXT-CHANGED', 'CG-CONTEXT-CHANGED', 'CG-CONTEXT-CHANGED']);
        for (const route of ['clientConversationRecaps', 'clientConversationFeed', 'clientFanProfileFromGeneration'] as const) {
          expect([route, callsTo(entries, route).map((call) => [call.status, call.error])]).toEqual([route, [[409, 'conversation_fan_mismatch']]]);
        }
      } else {
        expect(answers.map((answer) => (answer.ok ? answer.payload : answer.error.code))).toEqual(['CG-HUB-CAPABILITY', 'CG-HUB-CAPABILITY', 'CG-HUB-CAPABILITY']);
        for (const route of ['clientConversationRecaps', 'clientConversationFeed', 'clientFanProfileFromGeneration'] as const) expect([route, callsTo(entries, route)]).toEqual([route, []]);
      }
    });
  }
});
