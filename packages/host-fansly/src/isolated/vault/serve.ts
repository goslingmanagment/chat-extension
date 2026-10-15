// `FanslyPagePort.uploadToVault` (contracts fansly.ts; docs/project-unite/architecture.md §7.11, §7.21; R20 P13b):
// one file into the album open on the page, through the vault panel's uploader — the member the early port serves
// while the panel's module is up (host-port.ts `vault.serve`). One step, no checkpoint of its own: a run of the panel
// writes one before each file (run.ts); this member is the contract's single file, for a caller that keeps its own.

import type { FanslyHandoffReceipt, FanslyPagePort } from '@cg/contracts/fansly';

import { vaultTargetOf, type VaultHalt, type VaultUploader } from './upload';

const REFUSAL: Partial<Record<VaultHalt, 'identity' | 'busy'>> = { 'account-changed': 'identity', 'uploader-busy': 'busy' };

export function vaultUploadOf(win: Window, uploader: VaultUploader): FanslyPagePort['uploadToVault'] {
  return async (file): Promise<FanslyHandoffReceipt> => {
    // The album open on the page as the uploader binds it, and its creator: no album, no account — nothing is handed over.
    const target = vaultTargetOf(uploader.view());
    if (target === null) return { state: 'refused', reason: 'anchor-missing' };
    const outcome = await uploader.upload(new (win as Window & typeof globalThis).File([file.bytes], file.name, { type: file.type }), target);
    switch (outcome.state) {
      case 'done':
        return { state: 'done', path: outcome.path };
      case 'refused':
        return { state: 'refused', reason: REFUSAL[outcome.halt] ?? 'anchor-missing' };
      // Handed over: Fansly gave it up, or what it did is not seen. Never handed again by itself.
      case 'failed':
        return { state: 'unknown', path: outcome.path };
      case 'unknown':
        // A dispatch that threw names no path: the first one is the path tried (handoff.ts).
        return { state: 'unknown', path: outcome.path ?? 'data-transfer' };
    }
  };
}
