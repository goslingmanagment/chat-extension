// Fansly's own surfaces in the chatter's log (2026-10-21, «Скачать лог»): the vault uploader as a map of what is on and
// off (core/application/journal), and its clicks as machine facts. Fansly's file: a ChatSpace bundle never reaches it.
// «Заметки» are every site's since 2026-10-28: application/notes/journal.ts.

import { type VaultPanelAction, type VaultPanelVM } from '@cg/contracts/vault-fansly';

import { AVAILABLE, Collect, off, type AvailabilityMap } from '../../journal/availability';

/** Fansly's vault uploader: the entry (admitted on this page), «Старт» and why not, a stopped run's code. */
export function vaultAvailability(vm: VaultPanelVM): AvailabilityMap {
  const out = new Collect();
  out.set('entry', vm.shown ? AVAILABLE : off('not-admitted', null, null));
  if (vm.shown && vm.mode !== 'closed') {
    const blocked = vm.controls.blocked;
    // «Старт» waits for files to be picked and for a run to end: no decision of ours.
    out.set('start', blocked === null ? AVAILABLE : blocked === 'files' || blocked === 'running' || blocked === 'done' || blocked === 'checking' ? null : off(blocked, null, null));
    out.set('run', vm.run?.code === null || vm.run === null ? AVAILABLE : off(vm.run.stop?.kind ?? vm.run.state, vm.run.code, null));
    out.set('checkpoint', vm.note === null || vm.note === 'moved' ? AVAILABLE : off(vm.note, null, null));
  }
  return out.map;
}

/** A click of the vault uploader as machine facts: the files are counted, never named. */
export function vaultActionFacts(action: VaultPanelAction<unknown>): Record<string, unknown> {
  if (action.type === 'pick') return { fileCount: action.files.length };
  if (action.type === 'order') return { choice: action.order };
  if (action.type === 'answer') return { choice: action.answer };
  return {};
}
