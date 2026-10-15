// The person's message windows as a Fansly tab hears them (R20 P8b1; settings
// Б5): the first read of the settings, then every change the background
// announces. Fansly's AI policy needs them for its proof (`checkWindowOf`,
// FS-TAIL-1): the shared controller gathers the proof before it plans the start
// and does not tell the policy the start's count. Fansly's application half
// follows them from its start (composition/tab/hosts/fansly/app.ts).

import type { SettingsState } from '@cg/contracts/settings';

import type { TabRpcPort } from '../../../ai/ports';
import type { MessageWindows } from './proof';

/** Follows the windows: `take` gets the first read and each later change, never an older state after a newer one. */
export function followWindows(rpc: Pick<TabRpcPort, 'request' | 'onEvent'>, life: { readonly aborted: boolean }, take: (windows: MessageWindows) => void): () => void {
  let revision = -1;
  let stopped = false;
  const heard = (state: SettingsState): void => {
    if (stopped || life.aborted || state.revision < revision) return;
    revision = state.revision;
    take(state.settings.generation.windows);
  };
  const off = rpc.onEvent('settings.changed', heard);
  void rpc.request('settings.get', {}).then(
    (answer) => {
      if (answer.ok) heard(answer.payload);
    },
    () => undefined,
  );
  return () => {
    stopped = true;
    off();
  };
}
