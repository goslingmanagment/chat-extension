// Telegram's background module (docs/specs/2026-10-27-telegram-site.md §6.4): it brings Telegram's slice of the
// feature manifest and nothing else. The core's graph never has a file of a site's slice, so it admits a generation of
// a Telegram chat and an insert token of a Telegram tab by the slice of this running module (`features`); its row in
// the core's table is null, as Fansly's. Telegram has no services of its own in the background: no API, no requests of
// its own types, no sends — the extension talks to nothing of Telegram's.

import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { TELEGRAM_FEATURES } from '@cg/contracts/features/telegram';
import { featureSlice } from '@cg/core/domain/features';

import type { BackgroundHostHandle, BackgroundHostModule } from '../src/composition/background/host-module';

let handle: BackgroundHostHandle | null = null;

const telegram: BackgroundHostModule = {
  host: 'telegram-web',
  start() {
    handle ??= {
      features: featureSlice(FEATURES_COMMON, TELEGRAM_FEATURES),
      onTabMessage: () => Promise.resolve({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'telegram has no requests of its own' } }),
      onEvent: () => Promise.resolve(),
      facts: () => ({}),
      dispose: () => {
        handle = null;
        return Promise.resolve();
      },
    };
    return Promise.resolve(handle);
  },
};

export default telegram;
