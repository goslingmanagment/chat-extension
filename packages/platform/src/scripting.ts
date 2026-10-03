// Dynamic MAIN-world content script registration (§6.8 п. 10): the WS tap is
// registered by the background only while the `wsTap` flag is on, with
// persistAcrossSessions so it is there at document_start after a restart.
// Flag off → unregister for future documents (the running copy is told to
// stand down by the bridge, R09).

import { browser } from '@wxt-dev/browser';

export interface DynamicMainScriptSpec {
  readonly id: string;
  readonly js: readonly string[];
  readonly matches: readonly string[];
}

export type DynamicScriptSync = 'registered' | 'unregistered' | 'unchanged';

export async function syncDynamicMainScript(spec: DynamicMainScriptSpec, enabled: boolean): Promise<DynamicScriptSync> {
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [spec.id] });
  const current = existing[0];
  if (!enabled) {
    if (!current) return 'unchanged';
    await browser.scripting.unregisterContentScripts({ ids: [spec.id] });
    return 'unregistered';
  }
  const same =
    current !== undefined &&
    current.world === 'MAIN' &&
    current.runAt === 'document_start' &&
    sameList(current.js, spec.js) &&
    sameList(current.matches, spec.matches);
  if (same) return 'unchanged';
  if (current) await browser.scripting.unregisterContentScripts({ ids: [spec.id] });
  await browser.scripting.registerContentScripts([
    {
      id: spec.id,
      js: [...spec.js],
      matches: [...spec.matches],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
  return 'registered';
}

function sameList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const sorted = [...expected].sort();
  return [...actual].sort().every((value, index) => value === sorted[index]);
}
