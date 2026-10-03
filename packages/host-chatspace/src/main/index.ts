// host-chatspace/main — code that runs in the page's own JavaScript world
// (architecture.md §2, §5.3, §6). It is a self-contained, dependency-free
// bundle: no imports outside this folder (lint + dependency-cruiser), no
// secrets, no network. The page can see and call everything here, so the
// isolated side validates every byte that comes out of it (§14).

export { installMainBridge, type MainBridgeHandle } from './bridge';
export { installWsTap, type WsTapHandle } from './ws-tap';
