// host-chatspace/main — code that runs in the page's own JavaScript world
// (architecture.md §2, §5.3, §6). It is a self-contained, dependency-free
// bundle: no imports outside this folder (lint + dependency-cruiser), no
// secrets, no network. The page can see and call everything here, so the
// isolated side validates every byte that comes out of it (§14).
//
// `installMainBridge` is the document_start boot; the runtime
// (`createMainRuntime`) reads and writes ChatSpace. The extension ships them
// as ONE bundle — `installMainBridge(window, { runtime: createMainRuntime })`,
// ≤ 10 KiB gzip (§11, decision X11). The other way, a later MAIN script
// (`exposeRuntimeHook` + `attachMainRuntime`), is not used: the page could
// take the hook first.

export {
  attachMainRuntime,
  installMainBridge,
  type MainBridgeHandle,
  type MainBridgeOptions,
  type MainContext,
  type MainRuntime,
  type MainRuntimeFactory,
} from './bridge';
export { createMainRuntime } from './runtime';
export { installWsTap, type WsTapHandle } from './ws-tap';
