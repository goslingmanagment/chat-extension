// The vault panel's gate (2026-11-04, the vault audit, item 6): the upload of a set starts only when the background
// says this tab's own traffic goes through its model's proxy — read when the panel opens, on the person's return, and
// again right before Start. The page, the album and the background are stand-ins.

import type { VaultTabRoute } from '@cg/contracts/vault-fansly';
import { describe, expect, it } from 'vitest';

import { createVaultPanel, type VaultPanelStore } from './panel';
import type { VaultAlbumApi, VaultAlbumRowRef } from './run';
import type { VaultBatchOutcome, VaultUploader, VaultView } from './upload';

const VIEW: VaultView = { route: true, hostAccountId: '100000000000000001', albumId: '200000000000000001', title: 'SXT-003', loading: false, uploader: 'ready', cards: [], names: [], settled: [] };

function stand(routes: VaultTabRoute[]) {
  const handed: string[][] = [];
  const asked: string[] = [];
  const names = new Map<string, string>();
  let rows: VaultAlbumRowRef[] = [];
  let next = 300000000000000000n;
  const uploader: VaultUploader = {
    view: () => VIEW,
    ticket: () => '1:1',
    upload: async () => ({ state: 'refused', halt: 'uploader-busy' }),
    uploadMany: async (files): Promise<VaultBatchOutcome> => {
      handed.push(files.map((file) => file.name));
      const uploads = files.map((file) => {
        const mediaId = String((next += 1n));
        names.set(mediaId, file.name);
        return { name: file.name, size: file.size, mediaId };
      });
      return { state: 'settled', path: 'data-transfer', said: null, uploads };
    },
    stats: () => ({ watching: false, watches: 0, mutations: 0 }),
    dispose: () => undefined,
  };
  const api: VaultAlbumApi = {
    album: async () => rows,
    arrange: async (_target, mediaIds) => {
      rows = [...mediaIds].reverse().map((mediaId) => ({ row: String((next += 1n)), mediaId, name: names.get(mediaId) ?? '' }));
    },
    rename: async (_target, _mediaId, name) => name,
  };
  const store: VaultPanelStore = { look: async () => ({ checkpoint: null, held: false }), load: async () => null, save: async () => true, clear: async () => true };
  const panel = createVaultPanel({
    uploader,
    store,
    api,
    account: () => ({ username: 'model', displayName: null }),
    onPage: () => () => undefined,
    newId: () => '00000000-0000-4000-8000-000000000001',
    route: async (account) => {
      asked.push(account);
      return routes.shift() ?? 'ok';
    },
  });
  return { panel, handed, asked };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const files = [new File(['photo'], 'SXT-003_01_pic01.jpg', { type: 'image/jpeg', lastModified: 1 })];

describe('the vault panel starts only through the model’s proxy', () => {
  it('a tab that is not its model’s container: Start is off and the panel says why; back with it fixed, the set goes', async () => {
    const { panel, handed, asked } = stand(['no-container', 'ok', 'ok']);
    panel.setShown(true);
    panel.dispatch({ type: 'open' });
    panel.dispatch({ type: 'pick', files });
    await settle();
    expect(panel.view()).toMatchObject({ route: 'no-container', controls: { blocked: 'proxy' } });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(handed).toEqual([]);
    // The person comes back to the panel (from the container this time): read again.
    panel.dispatch({ type: 'refresh' });
    await settle();
    expect(panel.view()).toMatchObject({ route: 'ok', controls: { blocked: null } });
    panel.dispatch({ type: 'start' });
    await settle();
    expect(handed).toEqual([['SXT-003_01_pic01.jpg']]);
    expect(asked).toEqual([VIEW.hostAccountId, VIEW.hostAccountId, VIEW.hostAccountId]);
  });

  it('asked again right before Start: a grant taken back since the panel opened keeps the set from going', async () => {
    const { panel, handed } = stand(['ok', 'no-grant']);
    panel.setShown(true);
    panel.dispatch({ type: 'open' });
    panel.dispatch({ type: 'pick', files });
    await settle();
    expect(panel.view().controls.blocked).toBeNull();
    panel.dispatch({ type: 'start' });
    await settle();
    expect(handed).toEqual([]);
    expect(panel.view()).toMatchObject({ route: 'no-grant', controls: { blocked: 'proxy' } });
  });
});
