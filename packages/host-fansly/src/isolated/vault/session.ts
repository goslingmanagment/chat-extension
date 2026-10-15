import type { FromMainFansly, ToMainFanslyData } from '@cg/contracts/bridge-messages-fansly';
import type { Under } from '../generation';

export type VaultEvent = Extract<FromMainFansly, { t: 'fx.vaultAdded' | 'fx.vaultReloaded' }> | null;
/** Supplied by the host port, so the uploader shares P7c's one generation. null event = stream loss. */
export interface VaultSession {
  current(): { accountId: string | null; generation: number; onRoute: boolean };
  readonly under: Under;
  inspect(): Promise<ToMainFanslyData<'fx.vaultState'>>;
  subscribe(listener: (event: VaultEvent) => void): () => void;
  onChange(listener: () => void): () => void;
}
