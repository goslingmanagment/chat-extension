// @cg/ui/hosts/fansly/vault — the vault panel of a Fansly tab (R20 P13b; docs/project-unite/architecture.md §7.21):
// a surface of Fansly's own, drawn from its own client (contracts vault-fansly.ts). Imported by Fansly's vault chunk
// and the galleries only; no ChatSpace bundle carries it.

import { type VaultPanelClient } from '@cg/contracts/vault-fansly';

import { type StyleSource, type SurfaceDefinition } from '../../../kit';
import { VAULT_CSS } from './styles';
import { VaultView } from './VaultPanel';

export { VaultView, sizeText } from './VaultPanel';
export { VAULT_SURFACE } from './styles';

export const VAULT_STYLES: StyleSource = { id: 'cg-fansly-vault', css: VAULT_CSS };

/** What the vault's chunk mounts into the panel layer (`mountKitSurface(VAULT_SURFACE, root, deps, surface)`). */
export function vaultSurface(client: VaultPanelClient<File>): SurfaceDefinition {
  return { view: () => <VaultView client={client} />, styles: [VAULT_STYLES] };
}
