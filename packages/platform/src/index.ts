// @cg/platform — the ONLY package that touches browser.* and IndexedDB
// (architecture.md §4, D-01). Everything else gets these capabilities as ports
// from the composition roots. R07 grows this into storage, typed RPC, alarms,
// permissions, idb, audio, clipboard, scripting, env and download.

export { extensionUrl, extensionId, isExtensionContextAlive } from './runtime';
export { connectTabPort, onTabPortConnect, type TabPortClient, type TabPortServerSide } from './messaging';
export { syncDynamicMainScript, type DynamicMainScriptSpec, type DynamicScriptSync } from './scripting';
