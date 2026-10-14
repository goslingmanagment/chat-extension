// core/domain/ops on Fansly (R20 P4b1; moved out of domain-ops.test.ts by
// F9b, the tests unchanged): the coverage proof in the request's key and the
// hub's answers to a window check read into the served context. Its own file:
// a host mark puts the whole file on its site (tools/parity/hosts.ts), and
// the rows of domain-ops.test.ts are ChatSpace's too.

import { describe, expect, it } from 'vitest';

import { narrowCoverageCheck, type CoverageProof } from '@cg/contracts';
import { INITIAL_STREAM_STATE, narrowContext, proofDigestOf, readFrame, requestIdentityOf, requestKeyOf } from '@cg/core/domain/ops';
import { contextFrame, meta } from '@cg/testing/hub';

import { FANSLY, WORLD, fanslyTarget, persona, session, startOf } from './support/world';

describe('[host:fansly] request identity: the coverage proof (R20 P4b1)', () => {
  const identity = (over: Parameters<typeof startOf>[0] = {}, archiveHead: string | null = null) =>
    requestIdentityOf({ session, start: startOf(over), persona, archiveHead });

  it('[host:fansly] R20 P4b1: the proof is in the key by its fingerprint — another window, deletion, observation or tail is another request, the moment it was taken is not', () => {
    const proof: CoverageProof = {
      kind: 'tab-snapshot',
      conversationRef: FANSLY.group,
      completeness: 'complete',
      takenAt: '2026-10-03T10:00:00.000Z',
      window: [
        { id: '7301', dir: 'fan' },
        { id: '7302', dir: 'model' },
      ],
      knownFanMessageIds: ['7301'],
      deletedIds: ['7303'],
      tail: [{ platformMessageId: '7302', direction: 'model', sentAt: '2026-10-03T09:59:00.000Z', text: 'the model said this' }],
      truncated: false,
    };
    const withProof = (p: CoverageProof) => identity({ target: fanslyTarget, proof: p });
    const base = withProof(proof);
    expect(base.proofDigest).toBe(proofDigestOf(proof));
    expect(base.proofDigest).toMatch(/^[0-9a-f]{16}$/);
    // The same observation asked again a minute later is the same request; the key carries no text of the tail.
    expect(requestKeyOf(withProof({ ...proof, takenAt: '2026-10-03T10:01:00.000Z' }))).toBe(requestKeyOf(base));
    expect(requestKeyOf(base)).not.toContain('the model said this');
    const variants = [
      withProof({ ...proof, window: [...proof.window, { id: '7304', dir: 'fan' }] }),
      withProof({ ...proof, deletedIds: [] }),
      withProof({ ...proof, knownFanMessageIds: [] }),
      withProof({ ...proof, completeness: 'unknown' }),
      withProof({ ...proof, truncated: true }),
      withProof({ ...proof, tail: [{ platformMessageId: '7302', direction: 'model', sentAt: '2026-10-03T09:59:00.000Z', text: 'the model said that' }] }),
      withProof({ ...proof, tail: undefined }),
      identity({ target: fanslyTarget }),
    ].map(requestKeyOf);
    for (const key of variants) expect(key).not.toBe(requestKeyOf(base));
    expect(new Set(variants).size).toBe(variants.length);
    // A start without a proof names none: every ChatSpace key is the one recorded on main (the test above).
    expect(identity()).not.toHaveProperty('proofDigest');
    expect(identity({ target: fanslyTarget })).not.toHaveProperty('proofDigest');
  });
});

describe('[host:fansly] the stream reader: the answers to a window check (R20 P4b1)', () => {
  const expect0 = { opId: '00000000-0000-4000-8000-000000000100', personaDefinitionId: WORLD.persona.definitionId, debug: false };
  const metaFrame = meta('fast-reply');

  it('[host:fansly] R20 P4b1: the answers to a window check reach the tab read by the shared matrix; a frame without them keeps its form', () => {
    const answer = {
      window: [
        { id: '7301', state: 'included' },
        { id: '7302', state: 'future_state' },
      ],
      deleted: [{ id: '7303', state: 'still_served' }],
    };
    const served = narrowContext(contextFrame({ coverageCheck: answer }));
    expect(served.coverageCheck).toEqual({
      window: [
        { id: '7301', state: 'included' },
        { id: '7302', state: null },
      ],
      deleted: [{ id: '7303', state: 'still_served' }],
    });
    expect(served.coverageCheck).toEqual(narrowCoverageCheck(answer));
    // An answer naming what is no id answers nothing the client asked: none reaches the tab.
    expect(narrowContext(contextFrame({ coverageCheck: { window: [{ id: 'msg-7301', state: 'included' }], deleted: [] } }))).not.toHaveProperty('coverageCheck');
    // Every ChatSpace frame: no check asked, none answered, the served context as it was.
    expect(narrowContext(contextFrame())).not.toHaveProperty('coverageCheck');
    const afterMeta = readFrame(INITIAL_STREAM_STATE, metaFrame, expect0).state;
    expect(readFrame(afterMeta, contextFrame({ coverageCheck: answer }), expect0).state.servedContext?.coverageCheck).toEqual(served.coverageCheck);
  });
});
