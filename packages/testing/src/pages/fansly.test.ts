import { afterEach, describe, expect, it } from 'vitest';
import { generationDebug } from '@cg/core/domain/debug';
import type { CoverageProof, ServedContext } from '@cg/contracts/ops';
import { pagesWorld, settle, type PagesWorld } from './world';
import { FANSLY_PAGE_SITES, fanslyPageState } from './fansly';

let world: PagesWorld | undefined;
afterEach(() => world?.client.dispose());
async function open(profile: 'fansly' | 'mixed' | 'chatspace', debug = false) {
  const state = fanslyPageState(profile);
  if (debug) state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false } };
  world = pagesWorld({ state, sites: FANSLY_PAGE_SITES }); world.client.start(); await settle(); return world;
}
const status = (w: PagesWorld) => w.client.getSnapshot({ of: 'options', section: 'status' }).body;

describe('[host:fansly] P14b2 popup, status and debug pages', () => {
  it('[PU-005] one pill per used site; pending pre-install tabs have the actual count', async () => {
    const w = await open('mixed');
    const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.sites?.map((site) => [site.label, site.waitingReload])).toEqual([['ChatSpace', 0], ['Fansly', 2]]);
    expect(status(w)?.rows.filter((row) => row.id === 'host').map((row) => row.host)).toEqual(['chatspace', 'fansly-web']);
  });
  it('[PU-008] group and fan remain distinct, with exact copy ids and the site account label', async () => {
    const w = await open('fansly'); const vm = w.client.getSnapshot({ of: 'popup' });
    expect(vm.chat?.copyIds).toMatchObject({ hostAccountId: '70001', creatorId: '70001', conversationRef: '90001', fanId: '80001' });
    expect(vm.chat?.hostAccountLabel).toContain('Fansly');
    expect(vm.chat?.hostAccountLabel).not.toContain('OnlyMonster');
  });
  it('[ST-023] [ST-025] [ST-031] [ST-032] [FS-SET-2] status reads access, attribution, session, all anchors, MAIN and companion booleans', async () => {
    const w = await open('fansly', true);
    const row = status(w)?.rows.find((row) => row.host === 'fansly-web');
    const facts = JSON.stringify(row?.details);
    for (const text of ['main.2e6b96097a4bb73b', 'conversationRoute: ok', 'textarea: ok', 'FBuddy', 'Фильтр слов', '2 вкладки ждут перезагрузки', '70001', '@lora_test', '65 с', 'authorization', 'main.frames.lost: 2', 'Темп запросов / пауза', 'нет данных', 'без атрибуции']) expect(facts).toContain(text);
    const binding = status(w)?.rows.find((entry) => entry.id === 'binding')?.value;
    expect(typeof binding === 'object' ? w.i18n.text(binding) : binding).toBe('Fansly 70001 → Lora Test');
    const hub = status(w)?.rows.find((entry) => entry.id === 'hub')?.note;
    expect(typeof hub === 'object' && hub !== null ? w.i18n.text(hub) : hub).not.toContain('ChatSpace');
    expect(facts).toContain('3/20');
    expect(facts).toContain('1/20');
    expect(facts).toContain('сохранено на время сессии');
  });
  it('ChatSpace alone keeps its original row with no new detail section', async () => {
    const w = await open('chatspace');
    expect(w.client.getSnapshot({ of: 'popup' }).sites?.map((site) => site.label)).toEqual(['ChatSpace']);
    const rows = status(w)?.rows.filter((row) => row.id === 'host');
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.details).toBeUndefined();
  });
  it('missing observations are unknown; header names are shown only with debug enabled', async () => {
    const w = await open('fansly');
    expect(JSON.stringify(status(w)?.rows)).not.toContain('authorization');
    w.background.state.diagnostics = { ...w.background.state.diagnostics, tabs: w.background.state.diagnostics.tabs.map(({ page: _page, networkSession: _session, ...tab }) => tab) };
    await w.client.dispatch({ type: 'ReloadView', selector: { of: 'options', section: 'status' } }); await settle();
    const detail = status(w)?.rows.find((row) => row.host === 'fansly-web')?.details;
    expect(detail?.find((row) => row.label === 'FBuddy')?.value).toBe('нет данных');
    expect(detail?.find((row) => row.label === 'Сессия сайта')?.value).toBe('нет данных');
  });
  it('[DB-009] [DB-010] [DB-015] [FS-SET-3] the exact generation snapshot and per-id coverage are debug-only and removed on revoke', async () => {
    const state = fanslyPageState('fansly'); state.settings = { ...state.settings, debug: { enabled: true, renderTrace: false } };
    const proof: CoverageProof = { kind: 'tab-snapshot', conversationRef: '90001', takenAt: '2026-10-15T12:00:00Z', completeness: 'complete', window: [{ id: '10001', dir: 'fan' }], knownFanMessageIds: ['10001'], deletedIds: [], tail: [{ platformMessageId: '10001', direction: 'fan', text: 'synthetic tail', sentAt: '2026-10-15T11:59:00Z' }], truncated: false };
    const served: ServedContext = { source: 'live_union', servedHead: null, live: { status: 'served', accepted: 1, rejected: 0 }, coverageCheck: { window: [{ id: '10001', state: 'included' }], deleted: [] } };
    state.prompts['prompt-token-1'] = { ...state.prompts['prompt-token-1']!, generation: generationDebug(proof, served)! };
    const w = pagesWorld({ page: 'debug-prompt', state, sites: FANSLY_PAGE_SITES }); world = w; w.client.start();
    w.client.subscribe({ of: 'debug-prompt', token: 'prompt-token-1' }, () => undefined); await settle();
    const vm = w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' });
    expect(vm.generation?.text).toContain('synthetic tail');
    expect(vm.generation?.text).toContain('included');
    w.background.changeSettings({ debug: { enabled: false } }); await settle();
    expect(w.client.getSnapshot({ of: 'debug-prompt', token: 'prompt-token-1' }).generation).toBeUndefined();
  });
});
