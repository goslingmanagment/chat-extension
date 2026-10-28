// core/domain/output — reading what the model wrote (architecture.md §7
// «Разбор и Split», D-15; AI-011, AI-052, AI-053, AI-084, AI-085, AI-135,
// AI-136, AI-137, UI-032, NEW-04): Split markers, the answer cleanup, parts
// and Hi variants, the Review frame and its blocks, Coach drafts as parts,
// Recap text and its headed blocks, and the stream preview. Pure text
// functions: the background parses on `done`, the tab previews and renders.

export * from './cleanup';
export * from './coach';
export * from './drafts';
export * from './markers';
export * from './parse';
export * from './recap';
export * from './recap-doc';
export * from './review';
export * from './sections';
