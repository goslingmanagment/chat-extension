// The request registry of the tab protocol (architecture.md §5.4): the schema
// of every request, answer and event. 26 KiB of schemas the early bundle must
// not carry (§11), so the port checks its answers with it only once the
// application is loaded.

export { parseTabPayload } from '@cg/contracts/tab-messages';
