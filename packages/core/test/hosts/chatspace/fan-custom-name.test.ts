// The chatter's own name for the fan on ChatSpace (2026-10-30): Reply, Fix, Hi and Ping carry ChatSpace's custom name
// of the open chat's fan, with or without fresh text; the hub holds no saved name for OnlyFans, and without one Fix
// turned «Коко» into "Koko" for a fan saved as «Coco/37/France».

import { describe, expect, it } from 'vitest';

import type { HostFan, HostPort } from '@cg/contracts/host';
import type { AiProofAsk } from '@cg/contracts/ops';
import { CHATSPACE_AI } from '@cg/core/application/hosts/chatspace/ai';

const chat = { host: 'chatspace' as const, hostAccountId: '1001', platformFanId: '532021575' };

function hostWith(customName: string | null | undefined): HostPort {
  const fan = { chat, username: 'u532021575', displayName: customName ?? 'Coco', customName } as HostFan;
  return { fan: () => fan } as unknown as HostPort;
}

const ask = (feature: AiProofAsk['feature'], fresh: AiProofAsk['fresh'] = null): AiProofAsk =>
  ({ feature, surface: 'dock', identity: { chat }, fresh }) as unknown as AiProofAsk;

async function fieldsOf(host: HostPort, request: AiProofAsk) {
  return CHATSPACE_AI.fields((await CHATSPACE_AI.proof(host, request)) ?? null);
}

describe('ChatSpace’s custom name in a start', () => {
  it('rides with Reply, Fix, Hi and Ping without fresh text, trimmed', async () => {
    for (const feature of ['reply', 'fix', 'hi', 'ping'] as const) {
      expect((await fieldsOf(hostWith('  Coco/37/France '), ask(feature))).fanCustomName).toBe('Coco/37/France');
    }
  });

  it('stays home on other starts, and when none is set', async () => {
    expect(CHATSPACE_AI.proof(hostWith('Coco/37/France'), ask('coach'))).toBeNull();
    expect(CHATSPACE_AI.proof(hostWith(null), ask('reply'))).toBeNull();
    expect(CHATSPACE_AI.proof(hostWith('   '), ask('fix'))).toBeNull();
  });

  it('rides beside the fresh text', async () => {
    const host = { ...hostWith('Coco/37/France'), readVisibleTail: () => Promise.resolve(null) } as unknown as HostPort;
    const fields = await fieldsOf(host, ask('fix', { maxItems: 20, maxChars: 4000 }));
    expect([fields.fanCustomName, fields.fresh]).toEqual(['Coco/37/France', null]);
  });
});
