import { ANCHOR_IDS, HOST_CAPABILITIES, HostContractReportSchema } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { buildContractReport, sameReport, type ContractInput } from './contract';
import { normalizeDraftText, readStoredDraft, storedDraftAgrees, tiptapText } from './draft-store';

const input = (over: Partial<ContractInput> = {}): ContractInput => ({
  wire: { build: 'index-0000fake', missing: [], shape: [] },
  dom: { composerFrame: 'ok', draftKey: 'ok', theme: 'ok' },
  accountBound: true,
  adapterVersion: '0.1.0',
  checkedAt: 1,
  ...over,
});

describe('[DB-031] the host contract check (§6.2)', () => {
  it('reports every anchor and capability, valid against the contract', () => {
    const report = HostContractReportSchema.parse(buildContractReport(input()));
    expect(Object.keys(report.anchors).sort()).toEqual([...ANCHOR_IDS].sort());
    expect(Object.keys(report.capabilities).sort()).toEqual([...HOST_CAPABILITIES].sort());
    expect(report.build).toBe('index-0000fake');
    const on = HOST_CAPABILITIES.filter((name) => report.capabilities[name].state === 'on');
    expect(on.sort()).toEqual(['accounts', 'chatList', 'chatWindow', 'dockMount', 'draftRead', 'fan', 'freshText', 'identity', 'insert', 'navigate', 'route', 'theme'].sort());
    // The live side without a tap script, flags or a profile: off, each with its reason — not broken.
    expect(report.capabilities.receipt).toEqual({ state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' });
    expect(report.capabilities.previewSend).toEqual({ state: 'off', reason: 'flag', code: 'CG-SEND-OFF' });
    expect(report.capabilities.incoming).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(report.capabilities.sendObserve).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(report.anchors.receiptProfile).toBe('missing');
  });

  it('[X8-06] the live capabilities: the tap, the flag, every anchor a condition is read from, and the receipt profile (§6.2)', () => {
    const live = { tap: true, previewSend: true, receipt: true };
    const all = HostContractReportSchema.parse(buildContractReport(input({ live })));
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
    expect(noTap.previewSend).toEqual({ state: 'off', reason: 'wsTap', code: 'CG-SEND-FRESHNESS' });
    expect(noTap.incoming).toEqual(noTap.previewSend);
    expect(noTap.sendObserve).toEqual(noTap.previewSend);
    // A condition that cannot be read keeps X8 off (CG-SEND-HOST), one anchor at a time.
    for (const anchor of ['pendingMessages', 'composerTranslator', 'mimic', 'userPermissions'] as const) {
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

  it('[ER-048] [ER-049] no MAIN or no #app: CG-HOST-NOT-READY; a broken router or accounts: CG-HOST-CONTRACT', () => {
    expect(buildContractReport(input({ wire: null })).capabilities.insert).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(buildContractReport(input({ wire: { build: null, missing: ['app'], shape: [] } })).capabilities.identity).toEqual({ state: 'off', reason: 'app', code: 'CG-HOST-NOT-READY' });
    const router = buildContractReport(input({ wire: { build: null, missing: [], shape: ['router'] } }));
    expect(router.capabilities.navigate).toEqual({ state: 'contractBroken', reason: 'router', code: 'CG-HOST-CONTRACT' });
    expect(router.capabilities.insert).toEqual(router.capabilities.route);
    const accounts = buildContractReport(input({ wire: { build: null, missing: [], shape: ['accounts'] } }));
    expect(accounts.capabilities.identity).toEqual({ state: 'contractBroken', reason: 'accounts', code: 'CG-HOST-CONTRACT' });
    expect(buildContractReport(input({ accountBound: false })).capabilities.identity).toEqual({ state: 'off', reason: 'platformAccountId' });
  });

  it('[RB-008] partial breakage degrades one capability at a time', () => {
    const noBridge = buildContractReport(input({ wire: { build: null, missing: ['composerBridge'], shape: [] } })).capabilities;
    expect(noBridge.insert).toEqual({ state: 'off', reason: 'composerBridge', code: 'CG-HOST-COMPOSER-MISSING' });
    expect(noBridge.chatWindow.state).toBe('on');
    const noEditor = buildContractReport(input({ wire: { build: null, missing: [], shape: ['composerBridge'] } })).capabilities;
    expect(noEditor.insert).toEqual({ state: 'degraded', reason: 'editor' });
    expect(noEditor.draftRead).toEqual({ state: 'degraded', reason: 'editor' });
    const report = buildContractReport(input({ wire: { build: null, missing: ['fansMap', 'chatList'], shape: ['chatMessages'] }, dom: { composerFrame: 'missing', draftKey: 'missing', theme: 'missing' } }));
    expect(report.capabilities.fan).toEqual({ state: 'off', reason: 'fansMap' });
    expect(report.capabilities.chatList).toEqual({ state: 'off', reason: 'chatList' });
    expect(report.capabilities.freshText).toEqual({ state: 'off', reason: 'chatMessages' });
    expect(report.capabilities.dockMount).toEqual({ state: 'degraded', reason: 'composerFrame' });
    expect(report.capabilities.draftRead).toEqual({ state: 'degraded', reason: 'draftKey' });
    expect(report.capabilities.theme).toEqual({ state: 'degraded', reason: 'theme' });
  });

  it('a report equal but for the time is the same report', () => {
    expect(sameReport(buildContractReport(input()), buildContractReport(input({ checkedAt: 99 })))).toBe(true);
    expect(sameReport(buildContractReport(input()), buildContractReport(input({ accountBound: false })))).toBe(false);
  });
});

describe('[NEW-06] the draft key of the target chat', () => {
  const doc = (paragraphs: unknown[]) => ({ type: 'doc', content: paragraphs });
  const p = (...content: unknown[]) => ({ type: 'paragraph', content });

  it('reads Tiptap JSON like editor.getText(): hard breaks are newlines, blocks a blank line apart', () => {
    expect(tiptapText(doc([p({ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b', marks: [{ type: 'bold' }] })]))).toBe('a\nb');
    expect(tiptapText(doc([p({ type: 'text', text: 'one' }), p({ type: 'text', text: 'two' })]))).toBe('one\n\ntwo');
    expect(tiptapText(null)).toBe('');
  });

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
