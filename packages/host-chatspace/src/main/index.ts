// host-chatspace/main — code that runs in the page's own JavaScript world
// (architecture.md §2, §5.3, §6). It is a self-contained, dependency-free
// bundle: no imports outside this folder (lint + dependency-cruiser), no
// secrets, no network. The page can see and call everything here, so the
// isolated side validates every byte that comes out of it (§14).
//
// `installMainBridge` is the document_start boot (≤ 5 KiB, §11); the runtime
// (`createMainRuntime`) reads and writes ChatSpace and is attached either in
// the same bundle (`installMainBridge(window, { runtime: createMainRuntime })`)
// or by a later MAIN script (`exposeRuntimeHook` + `attachMainRuntime`).

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
