// Entry of the MAIN prototype bundle: the host-kit boot (the ChatSpace bridge, byte for byte, as P5 moves it)
// with the Fansly runtime attached at once, so both Proxies stand before the first page script.

import { installMainBridge } from '../../../host-chatspace/src/main/bridge';
import { createFanslyRuntime } from './runtime';

declare const __SPIKE__: boolean;

const t0 = performance.now();
try {
  const handle = installMainBridge(window, { runtime: createFanslyRuntime });
  if (__SPIKE__) Object.defineProperty(window, '__cgSpikeInstall', { value: { ms: performance.now() - t0, boot: handle.installMs, readyState: document.readyState }, configurable: true });
} catch {
  // no bridge in this document
}
