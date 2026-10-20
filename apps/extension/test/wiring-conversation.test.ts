// R20 F6b: the reads by conversation (docs/project-unite/architecture.md
// §11.1, hub HF-10) on the whole background — the composition root, the hub
// facade, the vendored SDK — against the in-process fake hub: a ChatSpace chat
// whose conversation is not its fan is never read as that fan's.

import { chat } from '@cg/contracts/fixtures';
import { PILOT_CAPABILITIES, callsTo } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signInWithPersona, workingTab } from './support/tabs.ts';
import { createWorld, sleep, type World } from './support/world.ts';

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

/** The hub as the pilot runs it (it serves `conversation-recaps-v1`), and a hub before HF-10. */
const HUBS = [
  ['a hub that serves conversation-recaps-v1', PILOT_CAPABILITIES],
  ['a hub before HF-10', PILOT_CAPABILITIES.filter((capability) => capability !== 'conversation-recaps-v1')],
] as const;

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
