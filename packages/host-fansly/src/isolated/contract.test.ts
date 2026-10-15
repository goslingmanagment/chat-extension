// What the early bundle repeats of the contracts' schema modules, pinned to them (R20 P7c; architecture.md §3.1,
// §7.12): the anchors and capabilities of Fansly's report, the functions that may carry page text; and the refused
// batch, which comes on as its number alone so the isolated side can acknowledge it (§6, validate.ts).

import { FANSLY_ANCHOR_IDS, FANSLY_CAPABILITIES, FANSLY_NETWORK_ANCHORS } from '@cg/contracts/fansly';
import { FANSLY_CONTRACT } from '@cg/contracts/fansly-host';
import { FRESH_TEXT_FEATURES as CONTRACT_FRESH_TEXT } from '@cg/contracts/features';
import { HOST_CAPABILITIES } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { DOM_ANCHORS, DOM_ANCHORS_NOT_YET } from './anchors';
import { NETWORK_ANCHORS, buildFanslyReport } from './contract';
import { FRESH_TEXT_FEATURES } from './freshness';
import { parseEvent } from './validate';

describe('[host:fansly] the early bundle’s copies of the contracts', () => {
  it('[FS-CTR-1] the report names every anchor of FANSLY_ANCHOR_IDS — the DOM’s here, the network’s MAIN’s — and every shared and own capability', () => {
    expect([...DOM_ANCHORS, ...NETWORK_ANCHORS].sort()).toEqual([...FANSLY_ANCHOR_IDS].sort());
    expect([...NETWORK_ANCHORS]).toEqual([...FANSLY_NETWORK_ANCHORS]);
    expect([...FANSLY_CONTRACT.anchors].sort()).toEqual([...FANSLY_ANCHOR_IDS].sort());
    const report = buildFanslyReport({ bridge: false, wire: null, creator: false, observation: 'unknown', dom: DOM_ANCHORS_NOT_YET, build: null, adapterVersion: '0.1.0', checkedAt: 1 });
    expect(Object.keys(report.capabilities).sort()).toEqual([...HOST_CAPABILITIES].sort());
    expect(Object.keys(report.extensions['fansly-web'].capabilities).sort()).toEqual([...FANSLY_CAPABILITIES].sort());
    // What Fansly has off by design (§7.7) is off in every report.
    for (const capability of FANSLY_CONTRACT.switchedCapabilities) expect(report.capabilities[capability].state).toBe('off');
  });

  it('[FS-PLC-7] [R20-P8d] the theme is the page’s own once Fansly’s theme class is on <html>; before it, degraded — the scheme dark by default, the palette fansly.com’s values', () => {
    const report = (themeClass: 'ok' | 'notYet') => buildFanslyReport({ bridge: true, wire: null, creator: false, observation: 'unknown', dom: { ...DOM_ANCHORS_NOT_YET, themeClass }, build: null, adapterVersion: '0.1.0', checkedAt: 1 });
    expect(report('ok').capabilities.theme).toEqual({ state: 'on' });
    expect(report('notYet').capabilities.theme).toEqual({ state: 'degraded', reason: 'themeClass' });
  });

  it('[FS-SEND-2] the person’s send is observed with MAIN, its creator, the field and the chat; the echo’s frames broken — broken', () => {
    const base = { bridge: true, creator: true, observation: 'ready', dom: { ...DOM_ANCHORS_NOT_YET, container: 'ok', composer: 'ok', textarea: 'ok' }, build: null, adapterVersion: '0.1.0', checkedAt: 1 } as const;
    const wire = { anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok', xhr: 'ok' }, tap: 'ok' } as const;
    const of = (over: Partial<Parameters<typeof buildFanslyReport>[0]>) => buildFanslyReport({ ...base, wire, ...over }).capabilities.sendObserve;
    expect(of({})).toEqual({ state: 'on' });
    expect(of({ bridge: false })).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(of({ dom: { ...base.dom, textarea: 'missing' } })).toEqual({ state: 'off', reason: 'textarea', code: 'CG-HOST-COMPOSER-MISSING' });
    expect(of({ wire: { ...wire, anchors: { ...wire.anchors, frames: 'shape' } } })).toEqual({ state: 'contractBroken', reason: 'frames', code: 'CG-HOST-CONTRACT' });
    expect(of({ creator: false })).toEqual({ state: 'off', reason: 'accountMe', code: 'CG-HOST-NOT-READY' });
    expect(of({ observation: 'unknown' })).toEqual({ state: 'off', reason: 'focus', code: 'CG-HOST-NOT-READY' });
  });

  it('[FS-VLT-1] [R20-P13b] the vault is on with MAIN’s observer of the page’s requests — its facts confirm every file; without MAIN, before its word or with that observer broken, it is not', () => {
    const report = (bridge: boolean, xhr: 'ok' | 'missing' | 'shape' | 'notYet' | null) =>
      buildFanslyReport({ bridge, wire: xhr === null ? null : { anchors: { accountMe: 'ok', socket: 'ok', frames: 'ok', xhr }, tap: 'ok' }, creator: true, observation: 'ready', dom: DOM_ANCHORS_NOT_YET, build: null, adapterVersion: '0.1.0', checkedAt: 1 }).extensions['fansly-web'].capabilities.vault;
    expect(report(true, 'ok')).toEqual({ state: 'on' });
    expect(report(false, null)).toEqual({ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' });
    expect(report(true, null)).toEqual({ state: 'off', reason: 'xhr', code: 'CG-HOST-NOT-READY' });
    expect(report(true, 'missing')).toEqual({ state: 'off', reason: 'xhr', code: 'CG-HOST-NOT-READY' });
    expect(report(true, 'shape')).toEqual({ state: 'contractBroken', reason: 'xhr', code: 'CG-HOST-CONTRACT' });
    // The upload input is there only with «Upload to Vault» open: an anchor the owner's switch and the page decide, never the capability.
    expect(FANSLY_CONTRACT.switchedAnchors).toContain('vaultUpload');
  });

  it('[SN-001] [SN-012] [R20-P14a] the sound’s facts come by the page’s socket: new messages with its frames under a known creator, subscribers with its frames; without MAIN, before its word or with the frames broken, they do not', () => {
    const report = (bridge: boolean, frames: 'ok' | 'missing' | 'shape' | null, creator = true) => {
      const built = buildFanslyReport({ bridge, wire: frames === null ? null : { anchors: { accountMe: 'ok', socket: 'ok', frames, xhr: 'ok' }, tap: 'ok' }, creator, observation: 'ready', dom: DOM_ANCHORS_NOT_YET, build: null, adapterVersion: '0.1.0', checkedAt: 1 });
      return [built.capabilities.incoming, built.extensions['fansly-web'].capabilities.follows];
    };
    expect(report(true, 'ok')).toEqual([{ state: 'on' }, { state: 'on' }]);
    expect(report(true, 'ok', false)).toEqual([{ state: 'off', reason: 'accountMe', code: 'CG-HOST-NOT-READY' }, { state: 'on' }]);
    expect(report(false, null)).toEqual([{ state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' }, { state: 'off', reason: 'bridge', code: 'CG-HOST-NOT-READY' }]);
    expect(report(true, 'missing')).toEqual([{ state: 'degraded', reason: 'socket' }, { state: 'degraded', reason: 'socket' }]);
    expect(report(true, 'shape')).toEqual([{ state: 'contractBroken', reason: 'frames', code: 'CG-HOST-CONTRACT' }, { state: 'contractBroken', reason: 'frames', code: 'CG-HOST-CONTRACT' }]);
  });

  it('page text only for the draft functions (D-14): the same list as the contracts’', () => {
    expect([...FRESH_TEXT_FEATURES]).toEqual([...CONTRACT_FRESH_TEXT]);
  });

  it('a batch its schemas refuse comes on as its number alone — never as events — and one without a number is dropped', () => {
    const bad = { n: 7, events: [{ t: 'fx.incoming', p: { groupId: 'x' } }] };
    expect(parseEvent('fx.batch', bad)).toEqual({ n: 7, events: [] });
    expect(parseEvent('fx.batch', { n: 0, events: [] })).toBeNull();
    expect(parseEvent('fx.batch', { events: [] })).toBeNull();
    expect(parseEvent('fx.batch', null)).toBeNull();
    expect(parseEvent('fx.gap', { reason: 'tired', n: 3 })).toBeNull();
    expect(parseEvent('fx.batch', { n: 8, events: [{ t: 'fx.vaultAdded', p: { seq: 1 } }] })).toEqual({ n: 8, events: [{ t: 'fx.vaultAdded', p: { seq: 1 } }] });
  });
});
