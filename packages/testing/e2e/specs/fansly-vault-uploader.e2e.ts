// P13a engine only. P13b owns the panel and suite-fansly-vault's full product flow.
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import type { VaultUploadSnapshot } from '@cg/host-fansly/isolated/vault';
import { browser, expect } from '@wdio/globals';
import { fakeFansly, openFanslyStand } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';

const album = '807000000000000021';
const snapshot = (): Promise<VaultUploadSnapshot> => tap('vaultSnapshot');
const stopped = (): Promise<VaultUploadSnapshot> => waitForTap(snapshot, (s) => s.state === 'stopped', 'uploader stopped');

describe('Fansly vault uploader (P13a)', () => {
  useNetworkTrap();
  let since = 0;
  let harness: FanslyTapHarness;
  before(async () => { harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' }); });
  after(async () => { await harness.remove(); });
  beforeEach(async () => {
    await fakeFansly().command({ op: 'reset' });
    since = await fakeFansly().mark();
    await openFanslyStand('/creator/vault');
    await waitForFanslyTap();
    await browser.$(`[data-album-id="${album}"]`).click();
    await waitForTap(() => tap<{ albumId: string | null }>('vaultState'), (s) => s.albumId === album, 'album observed');
  });

  it('[VA-005] [VA-006] two files cross the isolated input one at a time; page POST + reload + card confirm each', async () => {
    await tap('vaultMake', ['first.jpg', 'second.jpg']);
    await tap('vaultStart');
    const done = await waitForTap(snapshot, (s) => s.state === 'complete', 'two uploads confirmed');
    expect(done.confirmed).toBe(2);
    const calls = (await fakeFansly().calls('page', since)).filter((c) => c.method !== 'OPTIONS');
    expect(calls.filter((c) => c.route === 'vault.addMedia')).toHaveLength(2);
    expect(calls.filter((c) => c.route === 'vault.reload')).toHaveLength(3);
    expect(await tap('vaultCheckpoint')).toBeNull();
    expect(await browser.$$('.vault-row .image-filename').map((e) => e.getText())).toEqual(['second.jpg', 'first.jpg']);
    expect((await fakeFansly().calls('ours', since)).filter((c) => c.method !== 'OPTIONS')).toEqual([]);
  });

  it('[VA-004] success:false stops uncertain; restored pending needs the person, then a new start', async () => {
    await fakeFansly().command({ op: 'api', rules: [{ route: 'vault.addMedia', times: 1, outcome: { kind: 'refuse', code: 400 } }] });
    await tap('vaultMake', ['uncertain.jpg']); await tap('vaultStart');
    expect((await stopped()).uncertain).toBe(true);
    const checkpoint = await tap<VaultCheckpoint>('vaultCheckpoint');
    expect(checkpoint.pending?.index).toBe(0);
    // New document, new MAIN and isolated realm, the durable checkpoint supplied again.
    await openFanslyStand('/creator/vault'); await waitForFanslyTap();
    await browser.$(`[data-album-id="${album}"]`).click();
    await waitForTap(() => tap<{ albumId: string | null }>('vaultState'), (s) => s.albumId === album, 'album observed again');
    await tap('vaultMake', ['uncertain.jpg'], checkpoint);
    expect((await snapshot()).uncertain).toBe(true);
    expect((await fakeFansly().calls('page', since)).filter((c) => c.route === 'vault.addMedia')).toHaveLength(1);
    await tap('vaultResolve', 'missing'); await tap('vaultStart');
    await waitForTap(snapshot, (s) => s.state === 'complete', 'explicit retry confirmed');
  });

  it('[AU-036] route departure while the page uploads leaves a pending file and sends no next file', async () => {
    await tap('vaultMake', ['leave.jpg', 'never.jpg']); await tap('vaultStart');
    await waitForTap(snapshot, (s) => s.pending === 0, 'file handed over');
    await browser.$('a[href="/home"]').click();
    expect(await stopped()).toMatchObject({ uncertain: true, reason: 'route-left' });
    await browser.pause(1500);
    expect((await fakeFansly().calls('page', since)).filter((c) => c.route === 'vault.addMedia')).toHaveLength(1);
    expect((await tap<VaultCheckpoint>('vaultCheckpoint')).confirmed).toBe(0);
  });
});
