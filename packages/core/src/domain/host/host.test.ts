import { ANCHOR_IDS, HOST_CAPABILITIES, type CapabilityState, type HostContractReport } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { anchorGap, anchorsNotYet, previewSendWaitsForChat } from './index';

type Anchors = HostContractReport['anchors'];

function report(anchors: Partial<Anchors> = {}, previewSend: CapabilityState = { state: 'on' }): HostContractReport {
  return {
    build: 'index-0000test',
    adapterVersion: '0.3.0',
    checkedAt: 1,
    anchors: { ...(Object.fromEntries(ANCHOR_IDS.map((id) => [id, 'ok'])) as Anchors), ...anchors },
    capabilities: { ...(Object.fromEntries(HOST_CAPABILITIES.map((name) => [name, { state: 'on' }])) as HostContractReport['capabilities']), previewSend },
  };
}

const HOST_OFF = (reason: string): CapabilityState => ({ state: 'off', reason, code: 'CG-SEND-HOST' });

describe('[DB-031] an anchor ChatSpace creates with the page’s first chat (contracts 1.10.0)', () => {
  it('`notYet` is no gap of the contract; `missing` and `shape` are', () => {
    expect([anchorGap('ok'), anchorGap('notYet'), anchorGap('missing'), anchorGap('shape'), anchorGap(undefined)]).toEqual([false, false, true, true, false]);
    expect(anchorsNotYet(report({ composerTranslator: 'notYet', fansMap: 'missing' }))).toEqual(['composerTranslator']);
    expect(anchorsNotYet(report())).toEqual([]);
  });

  it('[X8-03] the preview send waits for a chat only when the host closed it for a `notYet` anchor alone', () => {
    expect(previewSendWaitsForChat(report({ composerTranslator: 'notYet' }, HOST_OFF('composerTranslator')))).toBe(true);
    // A real break of the store, of another send anchor named first, the owner's switch, a send that is on: no.
    expect(previewSendWaitsForChat(report({ composerTranslator: 'missing' }, HOST_OFF('composerTranslator')))).toBe(false);
    expect(previewSendWaitsForChat(report({ composerTranslator: 'notYet', mimic: 'missing' }, HOST_OFF('mimic')))).toBe(false);
    expect(previewSendWaitsForChat(report({ composerTranslator: 'notYet' }, { state: 'off', reason: 'flag', code: 'CG-SEND-OFF' }))).toBe(false);
    expect(previewSendWaitsForChat(report({ composerTranslator: 'notYet' }, { state: 'off', reason: 'receiptProfile', code: 'CG-SEND-RECEIPT' }))).toBe(false);
    expect(previewSendWaitsForChat(report())).toBe(false);
  });
});
