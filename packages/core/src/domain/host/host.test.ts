import { ANCHOR_IDS, HOST_CAPABILITIES, type CapabilityState, type ChatSpaceContractReport, type SiteContractReport } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { anchorGap, anchorsNotYet, contractBroken, expectedAnchors, previewSendWaitsForChat, receiptMatchOf, siteCapabilitiesOf } from './index';

type Anchors = ChatSpaceContractReport['anchors'];

function report(anchors: Partial<Anchors> = {}, previewSend: CapabilityState = { state: 'on' }): ChatSpaceContractReport {
  return {
    build: 'index-0000test',
    adapterVersion: '0.3.0',
    checkedAt: 1,
    anchors: { ...(Object.fromEntries(ANCHOR_IDS.map((id) => [id, 'ok'])) as Anchors), ...anchors },
    capabilities: { ...(Object.fromEntries(HOST_CAPABILITIES.map((name) => [name, { state: 'on' }])) as ChatSpaceContractReport['capabilities']), previewSend },
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

describe('[R20 F7] a report is read by its site', () => {
  const site: SiteContractReport = {
    host: 'fansly-web',
    build: 'main.2e6b96097a4bb73b',
    adapterVersion: '0.1.0',
    checkedAt: 1,
    capabilities: report().capabilities,
    extensions: { 'fansly-web': { anchors: { conversationRoute: 'ok', textarea: 'shape', vaultUpload: 'notYet' }, capabilities: { vault: { state: 'off' } } } },
  };

  it('the expected anchors of the site are read, in its order: one the report does not name is missing; without the set — the anchors it names', () => {
    const shape = { anchors: ['textarea', 'socket', 'conversationRoute', 'vaultUpload'] };
    expect(expectedAnchors(site, shape)).toEqual([
      ['textarea', 'shape'],
      ['socket', 'missing'],
      ['conversationRoute', 'ok'],
      ['vaultUpload', 'notYet'],
    ]);
    expect(expectedAnchors(site, null).map(([anchor]) => anchor)).toEqual(['conversationRoute', 'textarea', 'vaultUpload']);
    expect(anchorsNotYet(site, shape)).toEqual(['vaultUpload']);
    // ChatSpace's report names every anchor of its own set: nothing is added, nothing lost.
    expect(expectedAnchors(report({ fansMap: 'missing' }), { anchors: ANCHOR_IDS }).filter(([, state]) => state !== 'ok')).toEqual([['fansMap', 'missing']]);
  });

  it('a broken contract, a site\'s own capabilities and the receipt profile — each where its site keeps it', () => {
    expect([contractBroken(report()), contractBroken(report({ composerTranslator: 'notYet' })), contractBroken(report({ mimic: 'shape' })), contractBroken(site)]).toEqual([false, false, true, true]);
    expect(siteCapabilitiesOf(site)).toEqual({ vault: { state: 'off' } });
    expect(siteCapabilitiesOf(report())).toEqual({});
    expect(receiptMatchOf({ ...report(), receiptMatch: { profile: 'any-build', kind: 'anyBuild' } })).toEqual({ profile: 'any-build', kind: 'anyBuild' });
    expect([receiptMatchOf(report()), receiptMatchOf(site)]).toEqual([null, null]);
    // X8 waits for the first chat only where the site keeps that anchor.
    expect(previewSendWaitsForChat(site)).toBe(false);
  });
});
