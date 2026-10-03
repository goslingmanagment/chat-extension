// @cg/testing — test kit of the extension (architecture.md §12, R02). The root
// is the fake hub (also `@cg/testing/fake-hub`); the other entries:
// `@cg/testing/hub` (hub scenarios), `@cg/testing/app-client`,
// `@cg/testing/host` (FakeAppClient, FakeHostPort and their scenarios) and
// `@cg/testing/stand` (the ChatSpace-like stand). The root never imports the
// stand: it travels in the AMO sources archive, the stand does not.

export * from './fake-hub';
