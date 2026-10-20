import { HOST_CAPABILITIES, ChatSpaceContractReportSchema } from '@cg/contracts/host';
import { sameReport } from '@cg/host-kit/isolated/report';
import { describe, expect, it } from 'vitest';

import { buildContractReport, type ContractInput } from './contract';
import { normalizeDraftText, readStoredDraft, storedDraftAgrees } from './draft-store';

const input = (over: Partial<ContractInput> = {}): ContractInput => ({
  wire: { build: 'index-0000fake', missing: [], shape: [] },
  dom: { composerFrame: 'ok', draftKey: 'ok', theme: 'ok' },
  accountBound: true,
  adapterVersion: '0.1.0',
  checkedAt: 1,
  ...over,
});

describe('[DB-031] the host contract check (§6.2)', () => {
  it('[X8-06] the live capabilities: the tap, the flag, every anchor a condition is read from, and the receipt profile (§6.2)', () => {
    const live = { tap: true, previewSend: true, receipt: true };
    const all = ChatSpaceContractReportSchema.parse(buildContractReport(input({ live })));
    for (const name of ['incoming', 'sendObserve', 'receipt', 'previewSend'] as const) expect([name, all.capabilities[name]]).toEqual([name, { state: 'on' }]);
    expect(all.anchors.receiptProfile).toBe('ok');

    const of = (over: Partial<ContractInput>) => buildContractReport(input({ live, ...over })).capabilities;
    // The flag first: off on the server is off here, whatever the page looks like.
    expect(of({ live: { ...live, previewSend: false } }).previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
    // An approved profile is the only way in (§6.2 «Исключение — X8»); open-and-insert does not need it.
    const noProfile = of({ live: { ...live, receipt: false } });
    expect(noProfile.previewSend).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(noProfile.receipt).toEqual(noProfile.previewSend);
    expect(noProfile.insert).toEqual({ state: 'on' });
    expect(noProfile.navigate).toEqual({ state: 'on' });
    expect(noProfile.sendObserve).toEqual({ state: 'on' });
    // No tap script: no facts, no freshness, no X8.
    const noTap = of({ live: { ...live, tap: false } });
    expect(noTap.previewSend).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-OFF' });
    expect(noTap.incoming).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(noTap.sendObserve).toEqual(noTap.incoming);
    // Mimic and the translator unreadable are no hold (audit 2026-10-20, row 14): MAIN refuses only when they are on.
    for (const anchor of ['composerTranslator', 'mimic'] as const) expect([anchor, of({ wire: { build: null, missing: [anchor], shape: [] } }).previewSend]).toEqual([anchor, { state: 'on' }]);
    // A condition that cannot be read keeps X8 off (CG-SEND-HOST), one anchor at a time.
    for (const anchor of ['pendingMessages', 'userPermissions'] as const) {
      const missing = of({ wire: { build: null, missing: [anchor], shape: [] } });
      expect([anchor, missing.previewSend]).toEqual([anchor, { state: 'off', reason: anchor, code: 'CG-SEND-HOST' }]);
      const shape = of({ wire: { build: null, missing: [], shape: [anchor] } });
      expect([anchor, shape.previewSend]).toEqual([anchor, { state: 'off', reason: anchor, code: 'CG-SEND-HOST' }]);
    }
    expect(of({ wire: { build: null, missing: ['pendingMessages'], shape: [] } }).sendObserve).toEqual({ state: 'off', reason: 'pendingMessages', code: 'CG-SEND-HOST' });
    // The socket not being armed (yet) only degrades the facts: the capability does not flap with reconnects — the
    // preflight answers CG-SEND-FRESHNESS.
    const cold = of({ wire: { build: null, missing: ['wsFrames'], shape: [] } });
    expect(cold.incoming).toEqual({ state: 'degraded', reason: 'wsFrames', code: 'CG-SEND-FRESHNESS' });
    expect(cold.previewSend).toEqual({ state: 'on' });
    expect(of({ wire: { build: null, missing: [], shape: ['wsFrames'] } }).incoming).toEqual({ state: 'degraded', reason: 'wsFrames', code: 'CG-SEND-FRESHNESS' });
    // Without the host nothing of it is on.
    expect(of({ wire: null }).previewSend).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
  });

  it('[X8-06] [DB-031] a store ChatSpace has not created yet (`notYet`): no break; the translator store is no hold of X8 (audit 2026-10-20, row 14); a real break is named', () => {
    const live = { tap: true, previewSend: true, receipt: true };
    const report = ChatSpaceContractReportSchema.parse(buildContractReport(input({ live, wire: { build: null, missing: [], shape: [], notYet: ['composerTranslator'] } })));
    expect(report.anchors.composerTranslator).toBe('notYet');
    expect(report.capabilities.previewSend).toEqual({ state: 'on' });
    // Nothing else reads it: the dock, the insert, the facts of the tap are as before.
    const others = HOST_CAPABILITIES.filter((name) => report.capabilities[name].state !== 'on');
    expect(others).toEqual([]);
    // A send anchor really broken: that one is the reason.
    const both = buildContractReport(input({ live, wire: { build: null, missing: ['pendingMessages'], shape: [], notYet: ['composerTranslator'] } }));
    expect(both.capabilities.previewSend).toEqual({ state: 'off', reason: 'pendingMessages', code: 'CG-SEND-HOST' });
    expect(buildContractReport(input({ live, wire: { build: null, missing: [], shape: ['userPermissions'], notYet: ['composerTranslator'] } })).capabilities.previewSend).toEqual({ state: 'off', reason: 'userPermissions', code: 'CG-SEND-HOST' });
    // The owner's switch is said first, as before.
    expect(buildContractReport(input({ live: { ...live, previewSend: false }, wire: { build: null, missing: [], shape: [], notYet: ['composerTranslator'] } })).capabilities.previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
    // A MAIN before 1.10.0 has no such list: what is absent is missing.
    expect(buildContractReport(input({ live, wire: { build: null, missing: ['composerTranslator'], shape: [] } })).anchors.composerTranslator).toBe('missing');
  });

  it('[X8-06] decision X25: the report names the profile that let X8 in, and how', () => {
    const live = { tap: true, previewSend: true, receipt: true, receiptMatch: { profile: 'any-build', kind: 'anyBuild' as const } };
    const of = (over: Partial<ContractInput>) => buildContractReport(input({ live, ...over }));
    const on = ChatSpaceContractReportSchema.parse(of({}));
    expect(on.capabilities.previewSend).toEqual({ state: 'on' });
    expect(on.receiptMatch).toEqual({ profile: 'any-build', kind: 'anyBuild' });
    // No profile matched: no match is reported, whatever the input says.
    expect(of({ live: { ...live, receipt: false } }).receiptMatch).toBeUndefined();
    expect(of({ live: { ...live, receiptMatch: null } }).receiptMatch).toBeUndefined();
    expect(of({ live: { ...live, receiptMatch: { profile: 'chatspace-0.202.0', kind: 'exact' } } }).receiptMatch).toEqual({ profile: 'chatspace-0.202.0', kind: 'exact' });
    // Another match is another report (listeners hear of it).
    expect(sameReport(of({}), of({ live: { ...live, receiptMatch: { profile: 'chatspace-0.202.0', kind: 'exact' } } }))).toBe(false);
  });
});

describe('[NEW-06] the draft key of the target chat', () => {
  const doc = (paragraphs: unknown[]) => ({ type: 'doc', content: paragraphs });
  const p = (...content: unknown[]) => ({ type: 'paragraph', content });

  it('only the target’s own key; absent, unreadable and present are told apart', () => {
    const entries: Record<string, string> = {
      'chat-space:draft:of:1001:2002': JSON.stringify({ body: { json: doc([p({ type: 'text', text: 'Hi there ' })]) }, updatedAt: 1 }),
      'chat-space:draft:of:1001:2003': '{oops',
    };
    const storage = { getItem: (key: string) => entries[key] ?? null };
    const chat = (fan: string) => ({ host: 'chatspace' as const, hostAccountId: '1001', platformFanId: fan });
    expect(readStoredDraft(storage, chat('2002'))).toEqual({ state: 'present', text: 'Hi there ' });
    expect(readStoredDraft(storage, chat('2003'))).toEqual({ state: 'unreadable' });
    expect(readStoredDraft(storage, chat('2004'))).toEqual({ state: 'absent' });
    expect(readStoredDraft({ getItem: () => { throw new Error('blocked'); } }, chat('2002'))).toEqual({ state: 'unreadable' });
    expect(storedDraftAgrees(readStoredDraft(storage, chat('2002')), 'Hi there', 'replace')).toBe(true);
    expect(storedDraftAgrees(readStoredDraft(storage, chat('2002')), 'there', 'append')).toBe(true);
    expect(storedDraftAgrees(readStoredDraft(storage, chat('2002')), 'Hello', 'replace')).toBe(false);
    expect(storedDraftAgrees({ state: 'absent' }, 'x', 'replace')).toBeNull();
    expect(normalizeDraftText(' a \r\n b\t\tc ')).toBe('a\nb c');
  });
});
